/**
 * Global "suppress on-screen keyboard" toggle.
 *
 * On iPhone/iPad with an external hardware keyboard, the soft keyboard
 * eats screen real estate every time focus enters an xterm textarea.
 * This module flips `inputmode="none"` on every xterm helper textarea
 * (current and future), which tells iOS "I have my own input UI" —
 * Safari then suppresses the soft keyboard while still delivering
 * hardware keystrokes.
 *
 * State lives in localStorage so it persists across reloads.  A
 * MutationObserver catches xterm helper textareas mounted *after* the
 * user toggles, so newly opened terminals pick up the current setting
 * without any per-component wiring.
 *
 * The companion UI lives in App.jsx (top-bar toggle button).
 */

const KEY = 'aw_suppress_kbd';
const EVT = 'aw-suppress-kbd-change';

export function getSuppressKbd() {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setSuppressKbd(on) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent(EVT, { detail: { on: !!on } }));
  } catch {}
}

export function onSuppressKbdChange(cb) {
  const h = (e) => cb(!!(e.detail && e.detail.on));
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
}

function applyOne(ta, on) {
  if (!ta) return;
  if (on) {
    ta.setAttribute('inputmode', 'none');
    ta.dataset.awKbdSuppressed = '1';
  } else if (ta.dataset.awKbdSuppressed === '1') {
    // Only clear if WE set it — leave alone if some other code (e.g.
    // the iPad-desktop-mode workaround in TerminalWindow.jsx) also
    // wants inputmode=none for its own reasons.
    ta.removeAttribute('inputmode');
    delete ta.dataset.awKbdSuppressed;
  }
}

function applyToAll() {
  const on = getSuppressKbd();
  document.querySelectorAll('.xterm-helper-textarea').forEach((ta) => applyOne(ta, on));
}

let installed = false;

export function installKbdModeSweep() {
  if (installed) return;
  installed = true;

  const run = () => {
    applyToAll();
    onSuppressKbdChange(applyToAll);

    // Newly mounted terminals (open a new tab / restore a layout)
    // bring their own helper textarea — apply the current state when
    // they appear.
    const obs = new MutationObserver((mutations) => {
      const on = getSuppressKbd();
      if (!on) return; // nothing to do — defaults are fine
      for (const m of mutations) {
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (n.classList && n.classList.contains('xterm-helper-textarea')) {
            applyOne(n, on);
          }
          const inside = n.querySelectorAll ? n.querySelectorAll('.xterm-helper-textarea') : [];
          inside.forEach((ta) => applyOne(ta, on));
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run, { once: true });
  } else {
    run();
  }
}
