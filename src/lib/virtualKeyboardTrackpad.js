import { isKbdFocusProxy } from './hardwareKeyboardBridge';

const ROOT_ID = 'aw-virtual-keyboard-trackpad';
const SUPPRESS_EVENT = 'aw-suppress-kbd-change';
let previousSuppressValue = null;

const ROW_LETTERS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const ROW_SYMBOLS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['-', '/', ':', ';', '(', ')', '$', '&', '@', '"'],
  ['.', ',', '?', '!', "'", '`', '*', '#'],
];

/**
 * This keyboard speaks terminal escape sequences (see the special row below).
 * A focus proxy is not a terminal — it wants DOM key names, which its owner
 * turns into application state. Anything not in this table that is still a
 * control sequence is dropped rather than typed, so a key with no DOM
 * equivalent can't land in a text field as literal "\x1b[5~".
 */
const PROXY_KEY_FROM_TEXT = {
  '\r': 'Enter',
  '\n': 'Enter',
  '\t': 'Tab',
  '\x1b': 'Escape',
  '\x1b[A': 'ArrowUp',
  '\x1b[B': 'ArrowDown',
  '\x1b[C': 'ArrowRight',
  '\x1b[D': 'ArrowLeft',
};

const SHIFT_MAP = {
  '1': '!', '2': '@', '3': '#', '4': '$', '5': '%',
  '6': '^', '7': '&', '8': '*', '9': '(', '0': ')',
  '-': '_', '=': '+', '[': '{', ']': '}', '\\': '|',
  ';': ':', "'": '"', ',': '<', '.': '>', '/': '?', '`': '~',
};

export function isVirtualKeyboardTrackpadOpen() {
  return !!document.getElementById(ROOT_ID);
}

export function toggleVirtualKeyboardTrackpad() {
  if (isVirtualKeyboardTrackpadOpen()) {
    closeVirtualKeyboardTrackpad();
    return false;
  }
  openVirtualKeyboardTrackpad();
  return true;
}

function restoreSuppress() {
  try {
    if (previousSuppressValue === '1') localStorage.setItem('aw_suppress_kbd', '1');
    else localStorage.removeItem('aw_suppress_kbd');
    window.dispatchEvent(new CustomEvent(SUPPRESS_EVENT, { detail: { on: previousSuppressValue === '1' } }));
  } catch { /* ignore */ }
  previousSuppressValue = null;
}

export function closeVirtualKeyboardTrackpad() {
  const root = document.getElementById(ROOT_ID);
  if (root) {
    try { root._awCleanup?.(); } catch { /* ignore */ }
    root.remove();
    restoreSuppress();
  }
  window.dispatchEvent(new CustomEvent('aw-virtual-keyboard-trackpad-state', { detail: { open: false } }));
}

export function openVirtualKeyboardTrackpad() {
  closeVirtualKeyboardTrackpad();

  try {
    previousSuppressValue = localStorage.getItem('aw_suppress_kbd');
    localStorage.setItem('aw_suppress_kbd', '1');
    window.dispatchEvent(new CustomEvent(SUPPRESS_EVENT, { detail: { on: true } }));
  } catch { /* ignore */ }

  let layer = 'letters';
  let shiftOn = false;
  let shiftLocked = false;
  let ctrlOn = false;
  let ctrlLocked = false;
  let altOn = false;
  let altLocked = false;
  let micRecognition = null;
  let cachedTerminalSid = null;
  let cursorX = window.innerWidth * 0.5;
  let cursorY = window.innerHeight * 0.35;
  let trackpadActive = false;
  let dragActive = false;
  let dragSource = null;
  let dragHoldTimer = null;
  let lastTpX = 0;
  let lastTpY = 0;
  let movedSq = 0;
  let lastClickAt = 0;
  let lastClickX = -9999;
  let lastClickY = -9999;
  let previousUserSelect = '';
  let previousBodyUserSelect = '';
  let xtermFocusGuard = null;
  let selectionGuard = null;
  let touchGestureGuard = null;
  let gestureGuard = null;
  let nativeCalloutGuard = null;
  let longPressTimer = null;
  let previousTouchAction = '';
  let previousBodyTouchAction = '';
  let lastNativeTouchEnd = 0;

  const root = document.createElement('div');
  root.id = ROOT_ID;
  root.style.cssText = [
    'position:fixed',
    'inset:0',
    'width:100vw',
    'height:100dvh',
    'z-index:2147483646',
    'display:flex',
    'flex-direction:column',
    'pointer-events:none',
    'font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif',
    '-webkit-tap-highlight-color:transparent',
    'background:transparent',
  ].join(';');

  const suppressLegacyKeyboardStyle = document.createElement('style');
  suppressLegacyKeyboardStyle.textContent = `
    button[title="Open keyboard"],
    .fixed.bottom-0.left-0.right-0.z-40.select-none.pointer-events-none {
      display: none !important;
    }
    .xterm-helper-textarea {
      caret-color: transparent !important;
      -webkit-touch-callout: none !important;
      -webkit-user-select: none !important;
      user-select: none !important;
    }
    .xterm,
    .xterm *,
    .terminal-window,
    .terminal-window *,
    body,
    body * {
      -webkit-touch-callout: none !important;
      -webkit-user-select: none !important;
      user-select: none !important;
      -webkit-tap-highlight-color: transparent !important;
    }
  `;
  root.appendChild(suppressLegacyKeyboardStyle);

  const pass = document.createElement('div');
  pass.style.cssText = 'flex:1 1 auto;min-height:0;pointer-events:none;background:transparent';

  const strip = document.createElement('div');
  strip.style.cssText = [
    'flex-shrink:0',
    'display:flex',
    'flex-direction:row',
    'align-items:stretch',
    'gap:0',
    'min-height:min(46dvh, 360px)',
    'max-height:min(56dvh, 430px)',
    'padding:0 0 max(8px, env(safe-area-inset-bottom)) 0',
    'background:transparent',
    'pointer-events:none',
    'box-sizing:border-box',
    '--vk-kh:clamp(34px, 10vmin, 56px)',
    '--vk-fs:clamp(13px, 3.8vmin, 19px)',
    'font-size:var(--vk-fs)',
  ].join(';');

  const keyBorder = '1px solid rgba(255,255,255,0.26)';
  const keyColor = 'rgba(255,255,255,0.9)';

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'x';
  dismiss.setAttribute('aria-label', 'Close virtual keyboard');
  dismiss.style.cssText = [
    'position:fixed',
    'top:max(8px, env(safe-area-inset-top))',
    'right:max(8px, env(safe-area-inset-right))',
    'z-index:2147483647',
    'width:40px',
    'height:40px',
    'padding:0',
    'border:1px solid rgba(255,255,255,0.275)',
    'border-radius:10px',
    'background:transparent',
    'color:rgba(255,255,255,0.85)',
    'font-size:22px',
    'line-height:1',
    'font-weight:300',
    'pointer-events:auto',
    'touch-action:manipulation',
    'text-shadow:0 0 6px rgba(0,0,0,0.6)',
  ].join(';');
  dismiss.onclick = (e) => {
    e.stopPropagation();
    closeVirtualKeyboardTrackpad();
  };

  function activeElementDeep(doc = document) {
    let el = doc.activeElement;
    try {
      while (el) {
        if (el.shadowRoot?.activeElement) {
          el = el.shadowRoot.activeElement;
          continue;
        }
        if (el.tagName === 'IFRAME' && el.contentDocument?.activeElement) {
          el = el.contentDocument.activeElement;
          continue;
        }
        break;
      }
    } catch { /* cross-origin frame */ }
    return el;
  }

  function resolveTerminalSessionId() {
    const el = activeElementDeep();
    if (el?.classList?.contains('xterm-helper-textarea')) {
      const win = el.closest('[data-aw-session-id]');
      if (win?.getAttribute) {
        cachedTerminalSid = win.getAttribute('data-aw-session-id');
        return cachedTerminalSid;
      }
    }
    if (cachedTerminalSid) return cachedTerminalSid;
    // Pick the frontmost terminal window (highest z-index) rather than first in DOM order.
    let bestWin = null;
    let bestZ = -Infinity;
    document.querySelectorAll('.xterm-helper-textarea').forEach((ta) => {
      const w = ta.closest('[data-aw-session-id]');
      if (!w) return;
      const z = parseInt(w.style.zIndex || getComputedStyle(w).zIndex, 10) || 0;
      if (z > bestZ) { bestZ = z; bestWin = w; }
    });
    if (bestWin) {
      cachedTerminalSid = bestWin.getAttribute('data-aw-session-id');
      return cachedTerminalSid;
    }
    return null;
  }

  function hardenXtermTextareas() {
    document.querySelectorAll('.xterm-helper-textarea').forEach((ta) => {
      ta.setAttribute('inputmode', 'none');
      ta.setAttribute('autocapitalize', 'off');
      ta.setAttribute('autocomplete', 'off');
      ta.setAttribute('autocorrect', 'off');
      ta.setAttribute('spellcheck', 'false');
      ta.setAttribute('aria-hidden', 'true');
      ta.setAttribute('readonly', 'readonly');
      ta.setAttribute('tabindex', '-1');
      ta.dataset.awVkSuppressed = '1';
      ta.style.webkitTouchCallout = 'none';
      ta.style.webkitUserSelect = 'none';
      ta.style.userSelect = 'none';
      try { ta.blur(); } catch { /* ignore */ }
    });
  }

  function writeTerminal(sessionId, text) {
    if (!sessionId || !text) return;
    fetch(`/api/terminals/${encodeURIComponent(sessionId)}/write`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    }).catch(() => {});
  }

  function isWritableField(el) {
    if (!el || el.disabled) return false;
    if (el.classList?.contains('xterm-helper-textarea')) return true;
    if (el.tagName === 'TEXTAREA') return !el.readOnly;
    if (el.tagName === 'INPUT') {
      const ty = (el.type || '').toLowerCase();
      return !el.readOnly && ['text', 'search', 'email', 'password', 'url', 'tel', 'number'].includes(ty);
    }
    return !!el.isContentEditable;
  }

  /**
   * A focus proxy that is NOT inside a terminal window — i.e. a suppressed
   * text input like the App Launcher's search field (lib/suppressedTextInput.js),
   * which holds focus on a non-editable div so iOS never raises its keyboard.
   * There is no `.value` to inject into; keys go as a plain keydown and the
   * proxy's owner turns them into state.
   *
   * Terminal proxies are deliberately excluded, so the hardware-keyboard
   * bridge keeps the existing write-by-session-id path — that one works and
   * was expensive to get right.
   */
  function nonTerminalFocusProxy() {
    const el = activeElementDeep();
    if (!isKbdFocusProxy(el)) return null;
    return el.closest?.('[data-aw-session-id]') ? null : el;
  }

  function fireKey(el, type, key) {
    const keyCode = key === 'Backspace' ? 8 : key === 'Enter' ? 13 : key.length === 1 ? key.charCodeAt(0) : 0;
    try {
      el.dispatchEvent(new KeyboardEvent(type, {
        bubbles: true,
        cancelable: true,
        key,
        keyCode,
        which: keyCode,
        charCode: type === 'keypress' && key.length === 1 ? keyCode : 0,
      }));
    } catch { /* ignore */ }
  }

  function injectStandard(el, ch) {
    if (el.isContentEditable) {
      document.execCommand('insertText', false, ch);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
      return;
    }
    const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
    const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
    try {
      const before = new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: ch });
      if (!el.dispatchEvent(before)) return;
    } catch { /* ignore */ }
    if (typeof el.setRangeText === 'function') el.setRangeText(ch, start, end, 'end');
    else el.value = el.value.slice(0, start) + ch + el.value.slice(end);
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    fireKey(el, 'keydown', ch);
    fireKey(el, 'keyup', ch);
  }

  function ctrlChar(ch) {
    const c = ch.toLowerCase().charCodeAt(0);
    if (c >= 97 && c <= 122) return String.fromCharCode(c - 96);
    if (ch === '[') return '\x1b';
    if (ch === '\\') return '\x1c';
    if (ch === ']') return '\x1d';
    if (ch === ' ') return '\x00';
    return ch;
  }

  function clearOneShotMods() {
    let rebuild = false;
    if (ctrlOn && !ctrlLocked) { ctrlOn = false; rebuild = true; }
    if (shiftOn && !shiftLocked) { shiftOn = false; rebuild = true; }
    if (altOn && !altLocked) { altOn = false; rebuild = true; }
    if (rebuild) rebuildKeyboard();
  }

  function routeChar(rawCh) {
    let out = ctrlOn ? ctrlChar(rawCh) : (shiftOn ? shifted(rawCh) : rawCh);
    if (altOn) out = '\x1b' + out;
    routeText(out);
    clearOneShotMods();
  }

  function tapMod(getOn, setOn, getLocked, setLocked) {
    if (getLocked()) { setOn(false); setLocked(false); }
    else if (getOn()) { setLocked(true); }
    else { setOn(true); }
    rebuildKeyboard();
  }

  function routeText(text) {
    // Checked BEFORE the terminal fallback on purpose: resolveTerminalSessionId
    // below falls back to the frontmost terminal window even when nothing
    // terminal-ish has focus, so without this a keystroke aimed at the App
    // Launcher's search box would be POSTed into whatever shell happens to be
    // open behind it.
    const proxy = nonTerminalFocusProxy();
    if (proxy) {
      const mapped = PROXY_KEY_FROM_TEXT[text];
      if (mapped) { fireKey(proxy, 'keydown', mapped); return; }
      for (const ch of text) {
        const c = ch.charCodeAt(0);
        if (c < 0x20 || c === 0x7f) continue;
        fireKey(proxy, 'keydown', ch);
      }
      return;
    }
    const sid = resolveTerminalSessionId();
    if (sid) {
      writeTerminal(sid, text);
      return;
    }
    const el = activeElementDeep();
    if (!isWritableField(el)) return;
    for (const ch of text) injectStandard(el, ch);
  }

  function routeBackspace() {
    const proxy = nonTerminalFocusProxy();
    if (proxy) { fireKey(proxy, 'keydown', 'Backspace'); return; }
    const sid = resolveTerminalSessionId();
    if (sid) {
      writeTerminal(sid, '\x7f');
      return;
    }
    const el = activeElementDeep();
    if (!isWritableField(el)) return;
    fireKey(el, 'keydown', 'Backspace');
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? start;
      if (start !== end) el.value = el.value.slice(0, start) + el.value.slice(end);
      else if (start > 0) el.value = el.value.slice(0, start - 1) + el.value.slice(start);
      const pos = start !== end ? start : Math.max(0, start - 1);
      try { el.setSelectionRange(pos, pos); } catch { /* ignore */ }
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    }
    fireKey(el, 'keyup', 'Backspace');
  }

  function shifted(ch) {
    if (!shiftOn) return ch;
    if (SHIFT_MAP[ch] !== undefined) return SHIFT_MAP[ch];
    return /^[a-z]$/.test(ch) ? ch.toUpperCase() : ch;
  }

  const kbd = document.createElement('div');
  kbd.style.cssText = [
    'flex:0 0 65vw',
    'width:65vw',
    'min-width:65vw',
    'display:flex',
    'flex-direction:column',
    'gap:0',
    'min-width:0',
    'justify-content:flex-end',
    'border-top:' + keyBorder,
    'pointer-events:none',
  ].join(';');

  function makeKey(label, onTap, flexGrow = 1, extraCss = '') {
    const key = document.createElement('button');
    key.type = 'button';
    key.textContent = label;
    key.style.cssText = [
      `flex:${flexGrow} 1 0`,
      'min-width:0',
      'height:var(--vk-kh)',
      'min-height:var(--vk-kh)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font-weight:600',
      'letter-spacing:0',
      'color:' + keyColor,
      'text-shadow:0 0 8px rgba(0,0,0,0.75),0 0 1px rgba(0,0,0,1)',
      'background:transparent',
      'border:' + keyBorder,
      'border-radius:0',
      'box-shadow:none',
      'outline:none',
      'user-select:none',
      'touch-action:manipulation',
      'pointer-events:auto',
      'margin:0',
      extraCss,
    ].join(';');
    key.onpointerdown = (e) => {
      e.preventDefault();
      key.style.opacity = '0.65';
    };
    key.onpointerup = (e) => {
      e.preventDefault();
      key.style.opacity = '1';
      onTap();
    };
    key.onpointercancel = () => { key.style.opacity = '1'; };
    return key;
  }

  function makeModKey(label, onTap, isActive, isLocked, flexGrow = 0.85) {
    const key = makeKey(label, onTap, flexGrow);
    key.style.position = 'relative';
    if (isLocked) {
      key.style.background = 'rgba(96,165,250,0.28)';
      key.style.color = 'rgba(96,165,250,1)';
      key.style.borderColor = 'rgba(96,165,250,0.55)';
      const dot = document.createElement('span');
      dot.style.cssText = 'position:absolute;top:3px;right:3px;width:5px;height:5px;border-radius:50%;background:rgba(96,165,250,0.95);pointer-events:none';
      key.appendChild(dot);
    } else if (isActive) {
      key.style.background = 'rgba(96,165,250,0.14)';
      key.style.color = 'rgba(96,165,250,0.9)';
      key.style.borderColor = 'rgba(96,165,250,0.38)';
    }
    return key;
  }

  function makeMicKey(flexGrow = 0.75) {
    const key = document.createElement('button');
    key.type = 'button';
    key.textContent = 'mic';
    key.style.cssText = [
      `flex:${flexGrow} 1 0`,
      'min-width:0',
      'height:var(--vk-kh)',
      'min-height:var(--vk-kh)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font-weight:600',
      'color:' + keyColor,
      'text-shadow:0 0 8px rgba(0,0,0,0.75),0 0 1px rgba(0,0,0,1)',
      'background:transparent',
      'border:' + keyBorder,
      'border-radius:0',
      'outline:none',
      'user-select:none',
      'touch-action:manipulation',
      'pointer-events:auto',
      'margin:0',
      'font-size:var(--vk-fs)',
    ].join(';');
    const startMic = () => {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) return;
      const r = new SR();
      r.lang = 'en-US'; r.continuous = true; r.interimResults = false;
      r.onstart = () => { key.style.color = 'rgba(239,68,68,0.95)'; key.style.borderColor = 'rgba(239,68,68,0.5)'; };
      r.onend = () => { key.style.color = keyColor; key.style.borderColor = ''; micRecognition = null; };
      r.onerror = () => { key.style.color = keyColor; key.style.borderColor = ''; micRecognition = null; };
      r.onresult = (e) => {
        let text = '';
        for (let i = e.resultIndex; i < e.results.length; i++) {
          if (e.results[i].isFinal) text += e.results[i][0].transcript;
        }
        if (text.trim()) routeText(text.trim());
      };
      micRecognition = r;
      try { r.start(); } catch { /* ignore */ }
    };
    const stopMic = () => { if (micRecognition) { try { micRecognition.stop(); } catch { /* ignore */ } } };
    key.onpointerdown = (e) => { e.preventDefault(); startMic(); };
    key.onpointerup = (e) => { e.preventDefault(); stopMic(); };
    key.onpointercancel = () => { stopMic(); };
    return key;
  }

  function makePasteKey(flexGrow = 0.75) {
    const key = makeKey('paste', async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) routeText(text);
      } catch { /* clipboard unavailable */ }
    }, flexGrow);
    return key;
  }

  function makeAttachKey(flexGrow = 0.75) {
    const wrap = document.createElement('label');
    wrap.title = 'Attach file';
    wrap.style.cssText = [
      `flex:${flexGrow} 1 0`,
      'min-width:0',
      'height:var(--vk-kh)',
      'min-height:var(--vk-kh)',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font-weight:600',
      'color:' + keyColor,
      'text-shadow:0 0 8px rgba(0,0,0,0.75)',
      'background:transparent',
      'border:' + keyBorder,
      'border-radius:0',
      'outline:none',
      'user-select:none',
      'touch-action:manipulation',
      'pointer-events:auto',
      'cursor:pointer',
      'margin:0',
      'font-size:var(--vk-fs)',
    ].join(';');
    wrap.textContent = '📎';
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.cssText = 'display:none';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const sid = resolveTerminalSessionId();
      const formData = new FormData();
      formData.append('file', file);
      try {
        const res = await fetch('/api/terminals/upload', { method: 'POST', credentials: 'include', body: formData });
        const data = await res.json();
        if (data.path) writeTerminal(sid, data.path + ' ');
      } catch { /* ignore */ }
      input.value = '';
    });
    wrap.appendChild(input);
    return wrap;
  }

  function rebuildKeyboard() {
    kbd.innerHTML = '';
    const rows = layer === 'letters' ? ROW_LETTERS : ROW_SYMBOLS;

    // Special row: Esc, Tab, Ctrl, Alt, ←, ↑, ↓, →
    const special = document.createElement('div');
    special.style.cssText = 'display:flex;width:100%;pointer-events:none;border-bottom:' + keyBorder;
    special.appendChild(makeKey('Esc', () => routeText('\x1b'), 0.85));
    special.appendChild(makeKey('Tab', () => routeText('\t'), 0.85));
    special.appendChild(makeModKey('Ctrl', () => tapMod(() => ctrlOn, (v) => { ctrlOn = v; }, () => ctrlLocked, (v) => { ctrlLocked = v; }), ctrlOn, ctrlLocked, 0.85));
    special.appendChild(makeModKey('Alt', () => tapMod(() => altOn, (v) => { altOn = v; }, () => altLocked, (v) => { altLocked = v; }), altOn, altLocked, 0.85));
    special.appendChild(makeKey('←', () => routeText('\x1b[D'), 0.65));
    special.appendChild(makeKey('↑', () => routeText('\x1b[A'), 0.65));
    special.appendChild(makeKey('↓', () => routeText('\x1b[B'), 0.65));
    special.appendChild(makeKey('→', () => routeText('\x1b[C'), 0.65));
    const closeBtn = makeKey('⌄', closeVirtualKeyboardTrackpad, 0.65);
    closeBtn.style.color = 'rgba(239,68,68,0.9)';
    closeBtn.style.borderColor = 'rgba(239,68,68,0.35)';
    special.appendChild(closeBtn);
    kbd.appendChild(special);

    // Letter / symbol rows — pass raw char to routeChar so modifiers apply
    const rowKeys = (chars, inset = false) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;width:100%;pointer-events:none' + (inset ? ';padding-left:5%;box-sizing:border-box' : '');
      chars.forEach((ch) => row.appendChild(makeKey(shifted(ch), () => routeChar(ch))));
      return row;
    };
    kbd.appendChild(rowKeys(rows[0]));
    kbd.appendChild(rowKeys(rows[1], layer === 'letters'));

    const row3 = document.createElement('div');
    row3.style.cssText = 'display:flex;width:100%;pointer-events:none';
    if (layer === 'letters') {
      row3.appendChild(makeModKey('⇧', () => tapMod(() => shiftOn, (v) => { shiftOn = v; }, () => shiftLocked, (v) => { shiftLocked = v; }), shiftOn, shiftLocked, 1.15));
    } else {
      row3.appendChild(makeKey('abc', () => { layer = 'letters'; shiftOn = false; rebuildKeyboard(); }, 1.15));
    }
    rows[2].forEach((ch) => row3.appendChild(makeKey(shifted(ch), () => routeChar(ch))));
    row3.appendChild(makeKey('⌫', routeBackspace, 1.15));
    kbd.appendChild(row3);

    // Bottom row: 123/abc, mic, space, paste, Enter
    const bottom = document.createElement('div');
    bottom.style.cssText = 'display:flex;width:100%;pointer-events:none;border-top:' + keyBorder;
    bottom.appendChild(makeKey(layer === 'letters' ? '123' : 'abc', () => {
      layer = layer === 'letters' ? 'symbols' : 'letters';
      shiftOn = false;
      rebuildKeyboard();
    }, 0.9));
    bottom.appendChild(makeMicKey(0.75));
    bottom.appendChild(makeKey('space', () => routeChar(' '), 3));
    bottom.appendChild(makePasteKey(0.75));
    bottom.appendChild(makeAttachKey(0.75));
    bottom.appendChild(makeKey('↵', () => routeText('\r'), 1.2));
    kbd.appendChild(bottom);
  }

  const trackpad = document.createElement('div');
  trackpad.style.cssText = [
    'flex:0 0 20vw',
    'width:20vw',
    'min-width:20vw',
    'display:flex',
    'flex-direction:column',
    'border-left:' + keyBorder,
    'border-top:' + keyBorder,
    'background:transparent',
    'pointer-events:none',
  ].join(';');

  const trackpadMark = document.createElement('div');
  trackpadMark.textContent = 'track';
  trackpadMark.style.cssText = [
    'height:var(--vk-kh)',
    'min-height:var(--vk-kh)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'border-bottom:' + keyBorder,
    'color:rgba(255,255,255,0.5)',
    'font-size:clamp(9px,2.5vmin,12px)',
    'letter-spacing:0',
    'text-shadow:0 0 6px rgba(0,0,0,0.7)',
    'pointer-events:none',
  ].join(';');

  const pad = document.createElement('div');
  pad.style.cssText = 'flex:1;min-height:0;touch-action:none;background:transparent;pointer-events:auto';

  const cursor = document.createElement('button');
  cursor.type = 'button';
  cursor.setAttribute('aria-label', 'Click at cursor');
  cursor.style.cssText = [
    'position:fixed',
    'left:0',
    'top:0',
    'width:44px',
    'height:44px',
    'margin:-22px 0 0 -22px',
    'padding:0',
    'border:none',
    'background:transparent',
    'z-index:2147483647',
    'pointer-events:auto',
    'touch-action:manipulation',
    `transform:translate(${cursorX}px,${cursorY}px)`,
    'will-change:transform',
  ].join(';');

  const ring = document.createElement('span');
  ring.style.cssText = [
    'display:block',
    'width:20px',
    'height:20px',
    'margin:12px auto 0',
    'border-radius:50%',
    'box-sizing:border-box',
    'border:2px solid rgba(96,165,250,0.95)',
    'background:transparent',
    'pointer-events:none',
    'box-shadow:0 0 0 1px rgba(255,255,255,0.35),0 0 10px rgba(0,0,0,0.5)',
  ].join(';');
  cursor.appendChild(ring);

  function placeCursor() {
    cursorX = Math.max(22, Math.min(window.innerWidth - 22, cursorX));
    cursorY = Math.max(22, Math.min(window.innerHeight - 22, cursorY));
    cursor.style.transform = `translate(${cursorX}px,${cursorY}px)`;
  }

  function withOverlayHidden(fn) {
    const tp = pad.style.pointerEvents;
    const sw = strip.style.pointerEvents;
    const sv = strip.style.visibility;
    const dw = dismiss.style.pointerEvents;
    const cv = cursor.style.visibility;
    const cp = cursor.style.pointerEvents;
    pad.style.pointerEvents = 'none';
    strip.style.pointerEvents = 'none';
    strip.style.visibility = 'hidden';
    dismiss.style.pointerEvents = 'none';
    cursor.style.visibility = 'hidden';
    cursor.style.pointerEvents = 'none';
    try { return fn(); }
    finally {
      pad.style.pointerEvents = tp || 'auto';
      strip.style.pointerEvents = sw || 'none';
      strip.style.visibility = sv || '';
      dismiss.style.pointerEvents = dw || 'auto';
      cursor.style.visibility = cv || '';
      cursor.style.pointerEvents = cp || 'auto';
    }
  }

  function deepElementFromPoint(x, y) {
    return withOverlayHidden(() => {
      let doc = document;
      let localX = x;
      let localY = y;
      let target = doc.elementFromPoint(localX, localY);
      for (let i = 0; i < 5; i += 1) {
        if (!target || target.tagName !== 'IFRAME') break;
        try {
          const rect = target.getBoundingClientRect();
          const childDoc = target.contentDocument;
          if (!childDoc) break;
          localX -= rect.left;
          localY -= rect.top;
          doc = childDoc;
          target = doc.elementFromPoint(localX, localY) || target;
        } catch { break; }
      }
      return { target, x: localX, y: localY };
    });
  }

  function dispatchPointerMouse(target, type, x, y, opts = {}) {
    if (!target) return false;
    const doc = target.ownerDocument || document;
    const win = doc.defaultView || window;
    try {
      if (win.PointerEvent && type.startsWith('pointer')) {
        target.dispatchEvent(new win.PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          screenX: x,
          screenY: y,
          detail: opts.detail || 0,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: opts.button || 0,
          buttons: opts.buttons || 0,
        }));
        return true;
      }
      target.dispatchEvent(new win.MouseEvent(type, {
        bubbles: true,
        cancelable: true,
      view: win,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y,
      detail: opts.detail || 0,
      button: opts.button || 0,
      buttons: opts.buttons || 0,
      }));
      return true;
    } catch { return false; }
  }

  function setDraggingVisual(on) {
    ring.style.borderColor = on ? 'rgba(250,204,21,0.98)' : 'rgba(96,165,250,0.95)';
    ring.style.boxShadow = on
      ? '0 0 0 1px rgba(255,255,255,0.35),0 0 16px rgba(250,204,21,0.65)'
      : '0 0 0 1px rgba(255,255,255,0.35),0 0 10px rgba(0,0,0,0.5)';
  }

  function setSelectionSuppressed(on) {
    if (on) {
      previousUserSelect = document.documentElement.style.userSelect || '';
      previousBodyUserSelect = document.body.style.userSelect || '';
      previousTouchAction = document.documentElement.style.touchAction || '';
      previousBodyTouchAction = document.body.style.touchAction || '';
      document.documentElement.style.userSelect = 'none';
      document.documentElement.style.webkitUserSelect = 'none';
      document.documentElement.style.touchAction = 'none';
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      document.body.style.touchAction = 'none';
      try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    } else {
      document.documentElement.style.userSelect = previousUserSelect;
      document.documentElement.style.webkitUserSelect = previousUserSelect;
      document.documentElement.style.touchAction = previousTouchAction;
      document.body.style.userSelect = previousBodyUserSelect;
      document.body.style.webkitUserSelect = previousBodyUserSelect;
      document.body.style.touchAction = previousBodyTouchAction;
    }
  }

  function isWindowChromeTarget(target) {
    return !!target?.closest?.('.drag-handle, .no-drag');
  }

  function updateTerminalSidFromHit(target) {
    const win = target?.closest?.('[data-aw-session-id]');
    if (win) cachedTerminalSid = win.getAttribute('data-aw-session-id');
  }

  function clickAtCursor() {
    const hit = deepElementFromPoint(cursorX, cursorY);
    if (!hit?.target || hit.target === cursor || cursor.contains(hit.target)) return;
    const now = Date.now();
    const nearLast = Math.hypot(cursorX - lastClickX, cursorY - lastClickY) < 28;
    const detail = now - lastClickAt < 450 && nearLast ? 2 : 1;
    lastClickAt = now;
    lastClickX = cursorX;
    lastClickY = cursorY;
    updateTerminalSidFromHit(hit.target);
    if (!hit.target.classList?.contains('xterm-helper-textarea')) {
      try { hit.target.focus?.({ preventScroll: true }); } catch { /* ignore */ }
    }
    dispatchPointerMouse(hit.target, 'pointerdown', hit.x, hit.y, { buttons: 1, detail });
    dispatchPointerMouse(hit.target, 'mousedown', hit.x, hit.y, { buttons: 1, detail });
    dispatchPointerMouse(hit.target, 'pointerup', hit.x, hit.y, { buttons: 0, detail });
    dispatchPointerMouse(hit.target, 'mouseup', hit.x, hit.y, { buttons: 0, detail });
    if (!dispatchPointerMouse(hit.target, 'click', hit.x, hit.y, { detail })) {
      try { hit.target.click(); } catch { /* ignore */ }
    }
  }

  function beginDragAtCursor() {
    if (!trackpadActive || dragActive) return;
    const hit = deepElementFromPoint(cursorX, cursorY);
    if (!hit?.target || hit.target === cursor || cursor.contains(hit.target)) return;
    if (isWindowChromeTarget(hit.target)) return;
    dragActive = true;
    dragSource = hit;
    setDraggingVisual(true);
    if (!hit.target.classList?.contains('xterm-helper-textarea')) {
      try { hit.target.focus?.({ preventScroll: true }); } catch { /* ignore */ }
    }
    dispatchPointerMouse(hit.target, 'pointerdown', hit.x, hit.y, { buttons: 1 });
    dispatchPointerMouse(hit.target, 'mousedown', hit.x, hit.y, { buttons: 1 });
  }

  function moveAtCursor(buttons = 0) {
    const hit = deepElementFromPoint(cursorX, cursorY);
    if (!hit?.target || hit.target === cursor || cursor.contains(hit.target)) return;
    dispatchPointerMouse(hit.target, 'pointermove', hit.x, hit.y, { buttons });
    dispatchPointerMouse(hit.target, 'mousemove', hit.x, hit.y, { buttons });
    if (buttons && dragSource?.target && dragSource.target !== hit.target) {
      dispatchPointerMouse(dragSource.target, 'pointermove', cursorX, cursorY, { buttons });
      dispatchPointerMouse(dragSource.target, 'mousemove', cursorX, cursorY, { buttons });
    }
  }

  function endDragAtCursor() {
    const hit = deepElementFromPoint(cursorX, cursorY);
    const target = hit?.target || dragSource?.target;
    const x = hit?.target ? hit.x : dragSource?.x;
    const y = hit?.target ? hit.y : dragSource?.y;
    if (target) {
      dispatchPointerMouse(target, 'pointerup', x, y, { buttons: 0 });
      dispatchPointerMouse(target, 'mouseup', x, y, { buttons: 0 });
    }
    dragActive = false;
    dragSource = null;
    setDraggingVisual(false);
  }

  cursor.addEventListener('pointerup', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clickAtCursor();
  });

  pad.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    trackpadActive = true;
    setSelectionSuppressed(true);
    dragActive = false;
    dragSource = null;
    movedSq = 0;
    lastTpX = e.clientX;
    lastTpY = e.clientY;
    if (dragHoldTimer) clearTimeout(dragHoldTimer);
    dragHoldTimer = setTimeout(beginDragAtCursor, 96);
    try { pad.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  pad.addEventListener('pointermove', (e) => {
    if (!trackpadActive) return;
    e.preventDefault();
    const dx = e.clientX - lastTpX;
    const dy = e.clientY - lastTpY;
    lastTpX = e.clientX;
    lastTpY = e.clientY;
    movedSq += dx * dx + dy * dy;
    if (!dragActive && movedSq > 64 && dragHoldTimer) {
      clearTimeout(dragHoldTimer);
      dragHoldTimer = null;
    }
    cursorX += dx * 1.7;
    cursorY += dy * 1.7;
    placeCursor();
    moveAtCursor(dragActive ? 1 : 0);
  });
  pad.addEventListener('pointerup', (e) => {
    if (!trackpadActive) return;
    e.preventDefault();
    trackpadActive = false;
    if (dragHoldTimer) {
      clearTimeout(dragHoldTimer);
      dragHoldTimer = null;
    }
    try { pad.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (dragActive) endDragAtCursor();
    else if (movedSq < 100) clickAtCursor();
  });
  pad.addEventListener('pointercancel', () => {
    trackpadActive = false;
    if (dragHoldTimer) clearTimeout(dragHoldTimer);
    dragHoldTimer = null;
    if (dragActive) endDragAtCursor();
  });

  rebuildKeyboard();
  setSelectionSuppressed(true);
  hardenXtermTextareas();
  xtermFocusGuard = (event) => {
    if (event.target?.classList?.contains('xterm-helper-textarea')) {
      hardenXtermTextareas();
      setTimeout(hardenXtermTextareas, 0);
    }
  };
  selectionGuard = () => {
    try {
      const sel = window.getSelection?.();
      if (sel && sel.rangeCount && !document.activeElement?.matches?.('input, textarea, [contenteditable="true"]')) {
        sel.removeAllRanges();
      }
    } catch { /* ignore */ }
  };
  touchGestureGuard = (event) => {
    const now = Date.now();
    const isFastDoubleTap = event.type === 'touchend' && now - lastNativeTouchEnd < 450;
    if (event.type === 'touchend') lastNativeTouchEnd = now;
    if (event.touches?.length > 1 || event.changedTouches?.length > 1 || isFastDoubleTap) {
      event.preventDefault();
    }
    if (event.type === 'touchstart') {
      clearTimeout(longPressTimer);
      longPressTimer = setTimeout(() => {
        try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
      }, 260);
    } else if (event.type === 'touchend' || event.type === 'touchcancel') {
      clearTimeout(longPressTimer);
    }
  };
  gestureGuard = (event) => event.preventDefault();
  nativeCalloutGuard = (event) => {
    event.preventDefault();
    try { window.getSelection()?.removeAllRanges(); } catch { /* ignore */ }
    return false;
  };
  document.addEventListener('focusin', xtermFocusGuard, true);
  document.addEventListener('selectionchange', selectionGuard, true);
  document.addEventListener('touchstart', touchGestureGuard, { capture: true, passive: false });
  document.addEventListener('touchend', touchGestureGuard, { capture: true, passive: false });
  document.addEventListener('touchcancel', touchGestureGuard, { capture: true, passive: false });
  document.addEventListener('gesturestart', gestureGuard, { capture: true, passive: false });
  document.addEventListener('contextmenu', nativeCalloutGuard, { capture: true, passive: false });
  document.addEventListener('selectstart', nativeCalloutGuard, { capture: true, passive: false });
  document.addEventListener('dragstart', nativeCalloutGuard, { capture: true, passive: false });
  selectionGuard();
  root._awCleanup = () => {
    if (xtermFocusGuard) document.removeEventListener('focusin', xtermFocusGuard, true);
    if (selectionGuard) document.removeEventListener('selectionchange', selectionGuard, true);
    if (touchGestureGuard) {
      document.removeEventListener('touchstart', touchGestureGuard, true);
      document.removeEventListener('touchend', touchGestureGuard, true);
      document.removeEventListener('touchcancel', touchGestureGuard, true);
    }
    if (gestureGuard) document.removeEventListener('gesturestart', gestureGuard, true);
    if (nativeCalloutGuard) {
      document.removeEventListener('contextmenu', nativeCalloutGuard, true);
      document.removeEventListener('selectstart', nativeCalloutGuard, true);
      document.removeEventListener('dragstart', nativeCalloutGuard, true);
    }
    clearTimeout(longPressTimer);
    xtermFocusGuard = null;
    selectionGuard = null;
    touchGestureGuard = null;
    gestureGuard = null;
    nativeCalloutGuard = null;
    setSelectionSuppressed(false);
  };
  const leftSpace = document.createElement('div');
  leftSpace.style.cssText = [
    'flex:0 0 15vw',
    'width:15vw',
    'min-width:15vw',
    'border-top:' + keyBorder,
    'background:transparent',
    'pointer-events:none',
  ].join(';');
  trackpad.appendChild(trackpadMark);
  trackpad.appendChild(pad);
  strip.appendChild(leftSpace);
  strip.appendChild(kbd);
  strip.appendChild(trackpad);
  root.appendChild(pass);
  root.appendChild(strip);
  root.appendChild(dismiss);
  root.appendChild(cursor);
  document.body.appendChild(root);
  placeCursor();
  window.dispatchEvent(new CustomEvent('aw-virtual-keyboard-trackpad-state', { detail: { open: true } }));
}
