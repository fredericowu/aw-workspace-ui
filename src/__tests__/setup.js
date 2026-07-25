import '@testing-library/jest-dom';
class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
    setTimeout(() => this.onopen?.(), 0);
  }
  send() {}
  close() { this.readyState = 3; this.onclose?.(); }
}
global.WebSocket = MockWebSocket;
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve([]),
    text: () => Promise.resolve(''),
  })
);
const store = {};
global.localStorage = {
  getItem: (key) => store[key] || null,
  setItem: (key, val) => { store[key] = String(val); },
  removeItem: (key) => { delete store[key]; },
  clear: () => { Object.keys(store).forEach(k => delete store[k]); },
};
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
