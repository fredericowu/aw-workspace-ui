// Apex used to build `<appId>.app.<apex>` window URLs.
//
// Real workspace hosts: the page hostname (port dropped, as before).
// Loopback (aw-desktop local workspace served on http://127.0.0.1:<port>):
// `localhost:<port>`. `<app>.app.127.0.0.1` is not a resolvable name, while
// Chromium resolves `*.localhost` to loopback; the port MUST be kept because
// the desktop front server only answers `<app>.app.localhost:<uiPort>`.
export function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

export function appApex(loc = window.location) {
  if (isLoopbackHostname(loc.hostname)) {
    return loc.port ? `localhost:${loc.port}` : 'localhost';
  }
  return loc.hostname.replace(/^www\./, '');
}

/** `<protocol>//<appId>.app.<apex>` for the current page location. */
export function appOrigin(appId, loc = window.location) {
  return `${loc.protocol}//${appId}.app.${appApex(loc)}`;
}
