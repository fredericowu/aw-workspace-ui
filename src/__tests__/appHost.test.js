import { describe, it, expect } from 'vitest';
import { appApex, appOrigin } from '../appHost';
import { appChrome } from '../apps/appWindowChrome';

const loc = (hostname, port = '', protocol = 'http:') => ({ hostname, port, protocol });

describe('appHost', () => {
  it('loopback 127.0.0.1 keeps the port and uses localhost', () => {
    expect(appOrigin('kali-linux', loc('127.0.0.1', '9031'))).toBe('http://kali-linux.app.localhost:9031');
  });
  it('loopback localhost keeps the port', () => {
    expect(appOrigin('code-server', loc('localhost', '9031'))).toBe('http://code-server.app.localhost:9031');
  });
  it('real workspace hosts are unchanged (port dropped, www stripped)', () => {
    expect(appOrigin('kali-linux', loc('dev.tekflox.com', '8443', 'https:'))).toBe('https://kali-linux.app.dev.tekflox.com');
    expect(appApex(loc('www.example.com'))).toBe('example.com');
    expect(appApex(loc('127.0.0.1.evil.com', '9031'))).toBe('127.0.0.1.evil.com');
  });
  it('appChrome builds the window url from the loopback origin', () => {
    window.history.pushState({}, '', '/');
    const c = appChrome({ appId: 'kali-linux', windowSpec: { body: { path: '/vnc' } }, installedApp: {}, legacyApp: null, componentMap: {} });
    expect(c.url).toBe(`${window.location.protocol}//kali-linux.app.${appApex()}/vnc`);
  });
});
