import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../auth';

const API_BASE = '';

/*
 * TerminalKeyboard
 *
 * A custom on-screen keyboard purpose-built for terminal sessions.
 *
 * Why custom (vs. native iOS/Android keyboard):
 *   - Terminals need Tab, Esc, Ctrl, Alt, arrow keys, function keys —
 *     none of which the OS keyboard provides cleanly.
 *   - iOS autocorrect/smart-quote substitution mangles shell input
 *     even with autoCorrect="off" set.
 *   - Symbols heavy in shell usage (| ~ / $ - ` * etc.) are buried
 *     2–3 taps deep on the OS keyboard.
 *
 * Design:
 *   - Floating-action-button (FAB) when collapsed; tapping expands the
 *     keyboard panel docked to the bottom of the viewport.
 *   - Semi-transparent (HUD-style) so the terminal output is partially
 *     visible behind the keys — user can keep watching output while
 *     typing.
 *   - Sticky modifiers: tap Ctrl, the next key becomes Ctrl+X.
 *     Double-tap to lock.  Auto-clear after one keypress otherwise.
 *   - Two layers: letters / symbols.  Toggle via "123"/"abc" key.
 *   - Mic and attach buttons live inline with the keyboard so they
 *     follow it open/closed.
 *
 * Works for ANY terminal type — pass `sessionId` and the component
 * POSTs every keystroke to /api/terminals/{id}/write.  The Claude-
 * specific session picker / insecure toggle live in MobileApp's top
 * bar, not here.
 */

// Convert a printable letter into its Ctrl-modified control code.
// Ctrl+A → \x01, Ctrl+C → \x03, Ctrl+D → \x04, etc.
function ctrlChar(ch) {
  const c = ch.toLowerCase().charCodeAt(0);
  if (c >= 97 && c <= 122) return String.fromCharCode(c - 96);
  // Ctrl+[ = ESC, Ctrl+\ = FS, Ctrl+] = GS — common terminal codes
  if (ch === '[') return '\x1b';
  if (ch === '\\') return '\x1c';
  if (ch === ']') return '\x1d';
  if (ch === ' ') return '\x00';
  return ch;
}

const ROW_LETTERS = [
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['z','x','c','v','b','n','m'],
];

const ROW_SYMBOLS = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['-','/',':',';','(',')','$','&','@','"'],
  ['.',',','?','!','\'','`','*','#'],
];

const SHIFT_MAP = {
  '1':'!','2':'@','3':'#','4':'$','5':'%','6':'^','7':'&','8':'*','9':'(','0':')',
  '-':'_','=':'+','[':'{',']':'}','\\':'|',';':':','\'':'"',',':'<','.':'>','/':'?','`':'~',
};

export default function TerminalKeyboard({ sessionId, onHeightChange, cameraActive, onCameraToggle }) {
  const [open, setOpen] = useState(false);
  const [layer, setLayer] = useState('letters'); // 'letters' | 'symbols'
  const [shift, setShift] = useState(false);
  const [shiftLocked, setShiftLocked] = useState(false);
  const [ctrl, setCtrl] = useState(false);
  const [ctrlLocked, setCtrlLocked] = useState(false);
  const [alt, setAlt] = useState(false);
  const [altLocked, setAltLocked] = useState(false);

  // Ref on the expanded keyboard panel so we can report its rendered
  // height up to MobileApp.  The parent uses that height as
  // padding-bottom on the terminal area, so the terminal shrinks to
  // make room for the keyboard rather than being overlapped by it.
  const panelRef = useRef(null);
  useEffect(() => {
    if (!open) {
      onHeightChange?.(0);
      return;
    }
    if (!panelRef.current) return;
    const report = () => {
      if (panelRef.current) onHeightChange?.(panelRef.current.getBoundingClientRect().height);
    };
    report();
    // Layout changes (layer toggle, orientation rotation) re-measure.
    const ro = new ResizeObserver(report);
    ro.observe(panelRef.current);
    return () => {
      ro.disconnect();
      onHeightChange?.(0);
    };
  }, [open, onHeightChange]);

  // Speech recognition (mic) — kept inside the keyboard so the lifecycle
  // matches the keyboard's mounting and there's a single source of truth
  // for "what session does the mic write into".
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);

  // ─── Decoupled input pipeline ──────────────────────────────────
  // Every keypress goes into a local buffer FIRST.  A separate drain
  // loop reads from the buffer and dispatches to the network.  This
  // is the central invariant of the keyboard:
  //
  //     A registered tap can NEVER be lost to a network condition.
  //
  // Why this matters:
  //   - The touch handler returns in microseconds — no awaits, no
  //     fetches, no readyState checks that could swallow the input.
  //   - Keys pressed 1ms apart all enter the buffer cleanly.  The
  //     drain loop catches them up at network speed.
  //   - WebSocket flapping, slow HTTP fallback, momentary offline —
  //     none of these can drop a key.  At worst, the user sees a
  //     delay before keys appear in the PTY; the order and count
  //     are preserved.
  //
  // The buffer is an array of strings; we join() on each drain so
  // rapid bursts coalesce into a single network frame instead of N
  // frames.  Order is preserved by array ordering.
  const bufferRef = useRef([]);
  const sendingRef = useRef(false);

  const drain = useCallback(() => {
    if (bufferRef.current.length === 0) {
      sendingRef.current = false;
      return;
    }
    sendingRef.current = true;

    // Drain everything currently queued into one transmission.
    // If new keys arrive during the in-flight send, they'll be
    // picked up by the next drain (queued below).
    const text = bufferRef.current.join('');
    bufferRef.current = [];

    const fastSend = typeof window !== 'undefined' ? window.__awTermSend?.[sessionId] : null;
    if (fastSend && fastSend(text)) {
      // WebSocket send is synchronous + FIFO-ordered by the TCP
      // layer.  Microtask the next drain so we yield to any
      // pending React work but don't add real latency.
      queueMicrotask(drain);
      return;
    }

    // No WS — fall back to HTTP.  Critically, on failure we put
    // the text back at the FRONT of the buffer so order survives
    // a retry, and any new keys typed during the backoff land
    // AFTER the failed batch.
    apiFetch(`${API_BASE}/api/terminals/${sessionId}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      queueMicrotask(drain);
    }).catch(() => {
      bufferRef.current.unshift(text);
      // 500ms backoff before retry.  Crude but adequate — a
      // smarter version could listen to `navigator.onLine` or
      // the `online` event to retry sooner on recovery.
      setTimeout(drain, 500);
    });
  }, [sessionId]);

  // Public write — this is what every key handler calls.  It must
  // remain trivially cheap: push to array, kick the drain if idle.
  // No network state checks, no awaits.
  const write = useCallback((text) => {
    if (!sessionId || !text) return;
    bufferRef.current.push(text);
    if (!sendingRef.current) drain();
  }, [sessionId, drain]);

  const clearOneShotMods = useCallback(() => {
    if (ctrl && !ctrlLocked) setCtrl(false);
    if (shift && !shiftLocked) setShift(false);
    if (alt && !altLocked) setAlt(false);
  }, [ctrl, ctrlLocked, shift, shiftLocked, alt, altLocked]);

  // Send a printable character — applies the active modifiers.
  const sendChar = useCallback((ch) => {
    let out = ch;
    if (ctrl) {
      out = ctrlChar(ch);
    } else {
      if (shift) out = (SHIFT_MAP[ch] !== undefined) ? SHIFT_MAP[ch] : ch.toUpperCase();
      if (alt) out = '\x1b' + out; // Meta/Alt prefix in xterm
    }
    write(out);
    clearOneShotMods();
  }, [ctrl, shift, alt, write, clearOneShotMods]);

  // Send a raw byte sequence (e.g. arrow keys, Esc, Tab) — modifiers
  // are not auto-applied to these; we handle the special cases inline
  // (e.g. Ctrl+arrow → word jump).
  const sendRaw = useCallback((seq) => {
    write(seq);
    clearOneShotMods();
  }, [write, clearOneShotMods]);

  // Speech recognition setup.  We start/stop on press-and-hold and write
  // the final transcript into the active session as a single line.
  useEffect(() => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    const recognition = new SR();
    recognition.lang = 'en-US';
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);
    recognition.onresult = (event) => {
      let text = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) text += event.results[i][0].transcript;
      }
      if (text.trim()) write(text.trim());
    };
    recognition.onerror = () => setIsListening(false);
    recognitionRef.current = recognition;
    return () => { try { recognition.abort(); } catch { /* ignore */ } };
  }, [write]);

  const startListening = useCallback(() => { try { recognitionRef.current?.start(); } catch { /* ignore */ } }, []);
  const stopListening = useCallback(() => { try { recognitionRef.current?.stop(); } catch { /* ignore */ } }, []);

  // Paste from system clipboard into the terminal.
  // Requires a secure context (HTTPS / localhost) — over HTTP from a
  // non-localhost host the read will reject with NotAllowedError, in
  // which case we keep the brief flash UI honest and don't write
  // anything.
  const [pasted, setPasted] = useState(false);
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        write(text);
        setPasted(true);
        setTimeout(() => setPasted(false), 800);
      }
    } catch { /* permission denied or insecure context — ignore */ }
  }, [write]);

  // Handle file attach — uploads the file then writes its server-side
  // path into the terminal so the agent can read it.
  const handleAttach = useCallback(async (file) => {
    if (!file || !sessionId) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const res = await apiFetch(`${API_BASE}/api/terminals/upload`, { method: 'POST', body: formData });
      const data = await res.json();
      if (data.path) write(data.path + ' ');
    } catch { /* upload failures swallowed — UI shows nothing on the
                  attach path; user retries.  Could add a toast here. */ }
  }, [sessionId, write]);

  // Modifier toggle handler — single tap toggles, double tap locks.
  const tapModifier = useCallback((cur, setVal, locked, setLocked) => {
    if (locked) { setLocked(false); setVal(false); return; }
    if (cur) { setLocked(true); return; } // second tap locks
    setVal(true);
  }, []);

  // The visible letter/number rows depend on the active layer.
  const rows = layer === 'letters' ? ROW_LETTERS : ROW_SYMBOLS;
  const letterDisplay = (ch) => (layer === 'letters' && shift) ? ch.toUpperCase() : ch;

  if (!open) {
    // Collapsed state: keyboard FAB at bottom-right + optional camera FAB above it.
    return (
      <div className="fixed bottom-4 right-4 z-40 flex flex-col items-center gap-2">
        {/* Camera FAB — shown whenever the parent passes onCameraToggle */}
        {onCameraToggle && (
          <button
            onClick={onCameraToggle}
            title={cameraActive ? 'Stop camera stream' : 'Stream webcam to server'}
            className={`w-10 h-10 rounded-full backdrop-blur-md border shadow-lg shadow-black/40 active:scale-95 transition-all flex items-center justify-center ${
              cameraActive
                ? 'bg-[var(--color-status-running)]/35 border-[var(--color-status-running)]/60 text-[var(--color-status-running)] animate-pulse'
                : 'bg-white/15 border-white/25 text-white/70'
            }`}
          >
            <CameraIcon size={18} active={cameraActive} />
          </button>
        )}
        {/* Keyboard FAB */}
        <button
          onClick={() => setOpen(true)}
          className="w-14 h-14 rounded-full bg-[var(--color-accent)]/30 backdrop-blur-md border border-[var(--color-accent)]/50 text-[var(--color-accent)] shadow-lg shadow-black/40 active:scale-95 transition-transform flex items-center justify-center"
          title="Open keyboard"
        >
          <KeyboardIcon size={26} />
        </button>
      </div>
    );
  }

  // Expanded state: full keyboard panel.
  //
  // Layout:
  //   - Top extras strip — terminal/utility keys NOT present on iOS
  //     (Esc, Tab, Ctrl, Alt, arrows, mic, paste, attach, close).
  //     Deliberately smaller (~32px tall, 12px font) so they take
  //     less vertical space than the iOS-proportioned rows below.
  //   - Four rows below mimic the native iOS portrait keyboard:
  //       row 1 (qwertyuiop)         — 10 keys, full width
  //       row 2 (asdfghjkl)          —  9 keys, ~4.5% side inset
  //       row 3 (⇧ zxcvbnm ⌫)        — shift + 7 keys + backspace
  //       row 4 (123 / space / ⏎)    — bottom row, iOS-pure (no mic/paste/attach)
  //     6px horizontal gaps, ~7px vertical gaps, ~46px tall keys,
  //     17px letter font — proportions match iOS portrait.
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 select-none pointer-events-none">
      <div ref={panelRef} className="pointer-events-auto bg-black/45 backdrop-blur-md border-t border-white/10 px-1 pt-1 pb-[max(env(safe-area-inset-bottom),4px)]">
        {/* ── Top extras strip ───────────────────────────────────────
            Compact row of non-iOS keys above the main keyboard. Half
            the height and a smaller font than the iOS rows so this
            "tools" strip visually reads as a header for the keyboard,
            not part of the regular grid. */}
        <div className="flex gap-1 mb-1.5">
          <KbdExtra onClick={() => sendRaw('\x1b')}>Esc</KbdExtra>
          <KbdExtra onClick={() => sendRaw('\t')}>Tab</KbdExtra>
          <KbdExtraMod active={ctrl} locked={ctrlLocked}
            onClick={() => tapModifier(ctrl, setCtrl, ctrlLocked, setCtrlLocked)}>Ctrl</KbdExtraMod>
          <KbdExtraMod active={alt} locked={altLocked}
            onClick={() => tapModifier(alt, setAlt, altLocked, setAltLocked)}>Alt</KbdExtraMod>
          <KbdExtra onClick={() => sendRaw('\x1b[D')}><span aria-label="Left">←</span></KbdExtra>
          <KbdExtra onClick={() => sendRaw('\x1b[A')}><span aria-label="Up">↑</span></KbdExtra>
          <KbdExtra onClick={() => sendRaw('\x1b[B')}><span aria-label="Down">↓</span></KbdExtra>
          <KbdExtra onClick={() => sendRaw('\x1b[C')}><span aria-label="Right">→</span></KbdExtra>

          {/* Mic — press and hold for voice. Lives here (not bottom
              row) so iOS row 4 stays pure (123 / space / return). */}
          <button
            onTouchStart={(e) => { e.preventDefault(); startListening(); }}
            onTouchEnd={(e) => { e.preventDefault(); stopListening(); }}
            onMouseDown={startListening}
            onMouseUp={stopListening}
            style={KEY_STYLE}
            className={`relative flex-1 min-w-0 py-1.5 rounded-md border text-[12px] font-medium transition-colors duration-75 flex items-center justify-center before:content-[''] before:absolute before:-inset-[3px] before:rounded-md ${
              isListening
                ? 'bg-[var(--color-danger)]/25 border-[var(--color-danger)]/50 text-[var(--color-danger)]'
                : 'bg-white/10 border-white/20 text-white/85 active:bg-white/30'
            }`}
            title={isListening ? 'Listening…' : 'Hold to speak'}
          >
            <MicIcon size={14} />
          </button>

          {/* Camera — stream browser webcam to server's /dev/video10 */}
          {onCameraToggle && (
            <button
              onClick={onCameraToggle}
              style={KEY_STYLE}
              className={`relative flex-1 min-w-0 py-1.5 rounded-md border text-[12px] font-medium transition-colors duration-75 flex items-center justify-center before:content-[''] before:absolute before:-inset-[3px] before:rounded-md ${
                cameraActive
                  ? 'bg-[var(--color-status-running)]/25 border-[var(--color-status-running)]/50 text-[var(--color-status-running)]'
                  : 'bg-white/10 border-white/20 text-white/85 active:bg-white/30'
              }`}
              title={cameraActive ? 'Stop camera stream' : 'Stream webcam to server'}
            >
              <CameraIcon size={14} active={cameraActive} />
            </button>
          )}

          {/* Paste from clipboard */}
          <button
            onClick={handlePaste}
            title="Paste from clipboard"
            style={KEY_STYLE}
            className={`relative flex-1 min-w-0 py-1.5 rounded-md border text-[12px] font-medium transition-colors duration-75 flex items-center justify-center before:content-[''] before:absolute before:-inset-[3px] before:rounded-md ${
              pasted
                ? 'bg-[var(--color-status-running)]/30 border-[var(--color-status-running)]/50 text-[var(--color-status-running)]'
                : 'bg-white/10 border-white/20 text-white/85 active:bg-white/30'
            }`}
          >
            <PasteIcon size={14} />
          </button>

          {/* Attach (camera/photo library) */}
          <label
            style={KEY_STYLE}
            className="relative flex-1 min-w-0 py-1.5 rounded-md bg-white/10 border border-white/20 text-white/85 active:bg-white/30 cursor-pointer flex items-center justify-center transition-colors duration-75 before:content-[''] before:absolute before:-inset-[3px] before:rounded-md"
            title="Attach file"
          >
            <PaperclipIcon size={14} />
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                await handleAttach(f);
                e.target.value = '';
              }}
            />
          </label>

          {/* Close-keyboard — warm/danger tone for "dismiss" affordance */}
          <button
            onPointerDown={pressHandler(() => setOpen(false))}
            title="Close keyboard"
            style={KEY_STYLE}
            className="relative flex-1 min-w-0 py-1.5 rounded-md bg-[var(--color-danger)]/20 border border-[var(--color-danger)]/40 text-[var(--color-danger)] text-[12px] font-medium active:bg-[var(--color-danger)]/45 transition-colors duration-75 flex items-center justify-center before:content-[''] before:absolute before:-inset-[3px] before:rounded-md"
          >
            <ChevronDown />
          </button>
        </div>

        {/* ── iOS-proportioned regular keyboard ──────────────────────
            6px horizontal gap, ~7px vertical row gap, ~46px tall keys.
            Hit-area extensions widened to ::before -inset-[3px] so the
            larger seams between keys are still fully covered (adjacent
            extensions overlap by 0.5px each side, eliminating dead
            pixels along the gap). */}
        <div className="space-y-[7px]">
          {/* Row 1 — 10 keys, full width */}
          <div className="flex gap-1.5">
            {rows[0].map(ch => (
              <KbdKey key={ch} onClick={() => sendChar(ch)} flex>{letterDisplay(ch)}</KbdKey>
            ))}
          </div>
          {/* Row 2 — 9 keys, slight side inset like iOS so the row
              reads as visually narrower than row 1.  4.5% on each side
              ≈ one half-key-width, the iOS-faithful proportion. */}
          <div className="flex gap-1.5 px-[4.5%]">
            {rows[1].map(ch => (
              <KbdKey key={ch} onClick={() => sendChar(ch)} flex>{letterDisplay(ch)}</KbdKey>
            ))}
          </div>
          {/* Row 3 — shift on left, 7 letters, backspace on right.
              Shift and backspace are ~13% wide (iOS proportion). */}
          <div className="flex gap-1.5">
            {layer === 'letters' ? (
              <KbdMod active={shift} locked={shiftLocked} wide
                onClick={() => tapModifier(shift, setShift, shiftLocked, setShiftLocked)}>
                <ShiftIcon />
              </KbdMod>
            ) : (
              <KbdKey onClick={() => setLayer('letters')} wide>abc</KbdKey>
            )}
            {rows[2].map(ch => (
              <KbdKey key={ch} onClick={() => sendChar(ch)} flex>{letterDisplay(ch)}</KbdKey>
            ))}
            <KbdKey onClick={() => sendRaw('\x7f')} wide title="Backspace">
              <BackspaceIcon />
            </KbdKey>
          </div>
          {/* Row 4 — iOS-pure: 123 (left) · space (flex) · return (right).
              No mic/paste/attach here — those live in the top extras
              strip so this row matches the native iOS layout. */}
          <div className="flex gap-1.5">
            {layer === 'letters' ? (
              <KbdKey onClick={() => setLayer('symbols')} wide>123</KbdKey>
            ) : (
              <KbdKey onClick={() => setLayer('letters')} wide>abc</KbdKey>
            )}
            <button
              onPointerDown={pressHandler(() => sendChar(' '))}
              onContextMenu={(e) => e.preventDefault()}
              style={KEY_STYLE}
              className="relative flex-1 py-3 rounded-md bg-white/10 border border-white/20 text-white/75 text-[13px] active:bg-white/40 transition-colors duration-75 before:content-[''] before:absolute before:-inset-[3px] before:rounded-md"
            >space</button>
            <button
              onPointerDown={pressHandler(() => sendRaw('\r'))}
              onContextMenu={(e) => e.preventDefault()}
              style={KEY_STYLE}
              className="relative basis-[17%] shrink-0 py-3 rounded-md bg-[var(--color-accent)]/25 border border-[var(--color-accent)]/40 text-[var(--color-accent)] text-[13px] font-medium active:bg-[var(--color-accent)]/55 transition-colors duration-75 flex items-center justify-center before:content-[''] before:absolute before:-inset-[3px] before:rounded-md"
              title="Enter"
            >
              <ReturnIcon />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Reusable key components ──────────────────────────────────────────────
//
// Why pointerdown instead of click:
//   On mobile, onClick fires on touchend AND requires that touchstart and
//   touchend land within ~10px of each other.  If the finger drifts at all
//   (very easy with cramped keys), the synthetic click is cancelled and the
//   keystroke is silently dropped — which feels exactly like "I typed but
//   nothing happened".  Firing on pointerdown means the key registers the
//   instant the finger lands, even if the user then slides off.
//
//   We also call preventDefault on the pointer event to:
//     - stop iOS from stealing focus / scrolling the viewport
//     - suppress the synthetic mouse events that would otherwise fire
//     - avoid the 300ms double-tap-zoom wait (belt-and-braces with the
//       `touch-action: manipulation` style)
//
//   navigator.vibrate(3) gives a 3ms tactile pulse on Android.  iOS Safari
//   ignores it (Apple gates haptics behind the Haptics API which is
//   PWA-only), but it's harmless there.

function pressHandler(onPress) {
  return (e) => {
    e.preventDefault();
    try { navigator.vibrate?.(3); } catch { /* ignore */ }
    onPress();
  };
}

// Hit-area extension utility classes used by every key.
//
// Why a ::before pseudo-element with negative inset:
//   The visual gap between keys is 3px, but a finger tip on a phone
//   is ~10mm wide.  Landing exactly on a 3px seam was a real source
//   of dropped taps — the pointer event hit no element at all.
//   Extending an invisible ::before 2px in each direction means
//   adjacent keys' hit areas meet (with 1px of overlap to absorb
//   sub-pixel rounding).  When two ::before's overlap, the later
//   element in DOM order wins — for horizontal rows, the right
//   neighbour; for vertical rows, the lower row.  Either way, the
//   tap goes somewhere instead of nowhere.
//
// Why no `active:scale`:
//   Scaling the button down 6% on press meant that on a fast
//   repeat (tap-tap-tap on the same key), the second tap landed
//   slightly OUTSIDE the briefly-shrunken visible target.  Color
//   change alone is enough feedback, doesn't move the hit target.
// Base style for the iOS-proportioned regular-keyboard keys. Height
// (~46px) and font size (17px) match the native iOS portrait keyboard.
// Hit area extends 3px in every direction so adjacent keys' invisible
// targets overlap across the 6px gap (no dead pixels on the seam).
const KEY_BASE =
  "relative py-3 rounded-md border text-[17px] font-medium " +
  "before:content-[''] before:absolute before:-inset-[3px] before:rounded-md " +
  "transition-colors duration-75";
const KEY_STYLE = { touchAction: 'manipulation', WebkitUserSelect: 'none', userSelect: 'none', WebkitTouchCallout: 'none' };

// Regular-keyboard letter key (used by rows 1–3 and the 123/abc/space
// row 4). Wide keys (shift, backspace, 123, return) get ~13% basis to
// match iOS proportions; flex keys (letters) share the remaining space
// equally.
function KbdKey({ children, onClick, flex, wide, title }) {
  const sizing = flex
    ? 'flex-1 min-w-0'
    : wide
      ? 'basis-[13%] shrink-0 flex items-center justify-center'
      : 'px-3';
  return (
    <button
      onPointerDown={pressHandler(onClick)}
      onContextMenu={(e) => e.preventDefault()}
      title={title}
      style={KEY_STYLE}
      className={`${sizing} ${KEY_BASE} bg-white/10 border-white/20 text-white/95 active:bg-white/40 active:border-white/40`}
    >{children}</button>
  );
}

// Regular-keyboard modifier key (Shift) — sits on row 3 left at the
// same height as the letter keys. Accent-tinted when active/locked.
function KbdMod({ children, onClick, active, locked, flex, wide }) {
  const sizing = flex
    ? 'flex-1 min-w-0'
    : wide
      ? 'basis-[13%] shrink-0 flex items-center justify-center'
      : 'px-3';
  const visual = locked
    ? 'bg-[var(--color-accent)]/40 border-[var(--color-accent)]/60 text-[var(--color-accent)]'
    : active
      ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)]/40 text-[var(--color-accent)]'
      : 'bg-white/10 border-white/20 text-white/95';
  return (
    <button
      onPointerDown={pressHandler(onClick)}
      onContextMenu={(e) => e.preventDefault()}
      style={KEY_STYLE}
      className={`${sizing} ${KEY_BASE} ${visual} active:bg-[var(--color-accent)]/45`}
    >
      {children}
      {locked && (
        <span className="absolute top-0.5 right-1 w-1 h-1 rounded-full bg-[var(--color-accent)] z-10" />
      )}
    </button>
  );
}

// ── Top extras strip (smaller than iOS rows) ────────────────────────
// Compact key used by the top strip above the iOS keyboard. Shorter
// (py-1.5 ≈ 32px tall) and smaller font (12px) than KbdKey so the
// strip visually reads as a tools-header rather than a 5th main row.
// All extras share `flex-1 min-w-0` so they distribute evenly across
// the row regardless of screen width.
const EXTRA_BASE =
  "relative flex-1 min-w-0 py-1.5 rounded-md border text-[12px] font-medium " +
  "before:content-[''] before:absolute before:-inset-[3px] before:rounded-md " +
  "flex items-center justify-center transition-colors duration-75";

function KbdExtra({ children, onClick, title }) {
  return (
    <button
      onPointerDown={pressHandler(onClick)}
      onContextMenu={(e) => e.preventDefault()}
      title={title}
      style={KEY_STYLE}
      className={`${EXTRA_BASE} bg-white/10 border-white/20 text-white/90 active:bg-white/40 active:border-white/40`}
    >{children}</button>
  );
}

function KbdExtraMod({ children, onClick, active, locked }) {
  const visual = locked
    ? 'bg-[var(--color-accent)]/40 border-[var(--color-accent)]/60 text-[var(--color-accent)]'
    : active
      ? 'bg-[var(--color-accent)]/20 border-[var(--color-accent)]/40 text-[var(--color-accent)]'
      : 'bg-white/10 border-white/20 text-white/90';
  return (
    <button
      onPointerDown={pressHandler(onClick)}
      onContextMenu={(e) => e.preventDefault()}
      style={KEY_STYLE}
      className={`${EXTRA_BASE} ${visual} active:bg-[var(--color-accent)]/45`}
    >
      {children}
      {locked && (
        <span className="absolute top-0.5 right-1 w-1 h-1 rounded-full bg-[var(--color-accent)] z-10" />
      )}
    </button>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────

function KeyboardIcon({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <rect x="2" y="4" width="20" height="16" rx="2"/>
      <line x1="6" y1="8" x2="6.01" y2="8"/><line x1="10" y1="8" x2="10.01" y2="8"/>
      <line x1="14" y1="8" x2="14.01" y2="8"/><line x1="18" y1="8" x2="18.01" y2="8"/>
      <line x1="6" y1="12" x2="6.01" y2="12"/><line x1="10" y1="12" x2="10.01" y2="12"/>
      <line x1="14" y1="12" x2="14.01" y2="12"/><line x1="18" y1="12" x2="18.01" y2="12"/>
      <line x1="8" y1="16" x2="16" y2="16"/>
    </svg>
  );
}

function ShiftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 3l9 9h-5v8H8v-8H3l9-9z"/>
    </svg>
  );
}

function BackspaceIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21 5H8l-7 7 7 7h13a2 2 0 002-2V7a2 2 0 00-2-2z"/>
      <line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>
    </svg>
  );
}

function MicIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
      <path d="M19 10v2a7 7 0 01-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="23"/>
      <line x1="8" y1="23" x2="16" y2="23"/>
    </svg>
  );
}

function PasteIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/>
      <rect x="8" y="2" width="8" height="4" rx="1"/>
    </svg>
  );
}

function PaperclipIcon({ size = 18 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66L9.41 17.41a2 2 0 01-2.83-2.83l8.49-8.49"/>
    </svg>
  );
}

function ReturnIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M9 10l-5 5 5 5"/>
      <path d="M20 4v7a4 4 0 01-4 4H4"/>
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
      <path d="M6 9l6 6 6-6"/>
    </svg>
  );
}

function CameraIcon({ size = 18, active }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
      <circle cx="12" cy="13" r="4"/>
      {active && <circle cx="12" cy="13" r="2" fill="currentColor"/>}
    </svg>
  );
}
