// windowStore — position/size/z-order state for all WindowShell instances,
// persisted to localStorage under the SAME keys production uses
// (src/app/src/components/WindowManager.jsx: STORAGE_KEY/ZORDER_KEY), so
// this prototype's persistence model is a direct preview of production's.
//
// Per the Architect's composition decision (run 2fa7f8d5,
// aw-microfrontend-architecture): WindowShell + windowStore + WindowFrame
// is the shared chrome layer every window type composes with instead of
// reimplementing drag/resize/focus/persistence itself.

const STORAGE_KEY = 'aw-window-states';
const ZORDER_KEY = 'aw-window-zorder';

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export const windowStore = {
  states: loadJSON(STORAGE_KEY, {}),
  zOrder: loadJSON(ZORDER_KEY, []),
  maximizedKey: null,

  // Returns the persisted geometry for `key`, seeding it (and cascading the
  // default position a bit per open window) the first time it's asked for.
  getGeometry(key, defaults) {
    if (!this.states[key]) {
      const openCount = Object.keys(this.states).length;
      const cascade = (openCount % 8) * 24;
      this.states[key] = {
        x: (defaults.x ?? 60) + cascade,
        y: (defaults.y ?? 60) + cascade,
        width: defaults.width ?? 480,
        height: defaults.height ?? 380,
      };
      this._persistStates();
    }
    return this.states[key];
  },

  setGeometry(key, partial) {
    this.states[key] = { ...this.states[key], ...partial };
    this._persistStates();
  },

  bringToFront(key) {
    this.zOrder = this.zOrder.filter((k) => k !== key);
    this.zOrder.push(key);
    this._persistZOrder();
  },

  remove(key) {
    delete this.states[key];
    this.zOrder = this.zOrder.filter((k) => k !== key);
    if (this.maximizedKey === key) this.maximizedKey = null;
    this._persistStates();
    this._persistZOrder();
  },

  getZIndex(key) {
    if (this.maximizedKey === key) return 9000;
    const idx = this.zOrder.indexOf(key);
    return idx === -1 ? 1 : idx + 1;
  },

  isMaximized(key) {
    return this.maximizedKey === key;
  },

  // Mirrors production: entering maximize snapshots the current geometry so
  // it can be restored; leaving maximize just drops the maximized flag (the
  // snapshot underneath was never overwritten while maximized).
  toggleMaximize(key) {
    this.maximizedKey = this.maximizedKey === key ? null : key;
    this.bringToFront(key);
  },

  _persistStates() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.states));
  },
  _persistZOrder() {
    localStorage.setItem(ZORDER_KEY, JSON.stringify(this.zOrder));
  },
};
