import { describe, it, expect } from 'vitest';
import {
  isCategory,
  launchableWindows,
  defaultLaunchWindow,
  resolveComponentKey,
  resolveTitle,
  appChrome,
} from '../apps/appWindowChrome';

describe('appWindowChrome', () => {
  describe('isCategory', () => {
    it('matches singular/plural manifest category spellings', () => {
      expect(isCategory({ category: 'Service' }, 'service')).toBe(true);
      expect(isCategory({ category: 'Services' }, 'service')).toBe(true);
      expect(isCategory({ category: 'Tool' }, 'tool')).toBe(true);
      expect(isCategory({ category: 'Platform' }, 'tool')).toBe(false);
      expect(isCategory({}, 'tool')).toBe(false);
    });
  });

  describe('launchableWindows / defaultLaunchWindow', () => {
    const contributions = {
      windows: [
        { app: 'plaud', id: 'plaud.main', title: 'Plaud' },
        { app: 'plaud', id: 'plaud.settings', title: 'Plaud Settings' },
        { app: 'proxy', id: 'proxy.logs', title: 'Proxy Logs' },
        { app: 'proxy', id: 'proxy.main', title: 'Proxy' },
      ],
    };

    it('excludes windows that only back a settings panel (manifest.py:125-126)', () => {
      const installedApp = { slug: 'plaud', settings_panels: [{ window: 'plaud.settings' }] };
      const windows = launchableWindows(installedApp, contributions);
      expect(windows.map((w) => w.id)).toEqual(['plaud.main']);
    });

    it('keeps every window when no settings panel claims one', () => {
      const installedApp = { slug: 'proxy', settings_panels: [] };
      const windows = launchableWindows(installedApp, contributions);
      expect(windows.map((w) => w.id)).toEqual(['proxy.logs', 'proxy.main']);
    });

    it('defaultLaunchWindow picks the FIRST launchable window, not necessarily .main', () => {
      const installedApp = { slug: 'proxy', settings_panels: [] };
      expect(defaultLaunchWindow(installedApp, contributions).id).toBe('proxy.logs');
    });

    it('returns null when the app has no launchable window', () => {
      const installedApp = { slug: 'ghost', settings_panels: [] };
      expect(defaultLaunchWindow(installedApp, contributions)).toBeNull();
    });

    it('tolerates missing contributions (not yet fetched)', () => {
      const installedApp = { slug: 'proxy', settings_panels: [] };
      expect(launchableWindows(installedApp, null)).toEqual([]);
      expect(defaultLaunchWindow(installedApp, null)).toBeNull();
    });
  });

  describe('resolveComponentKey', () => {
    it('prefers body.component when present in componentMap', () => {
      const key = resolveComponentKey({
        appId: 'browser',
        body: { component: 'service:proxy:proxy-server' },
        windowSpec: { component: 'docker:aw-browser' },
        legacyApp: { component: 'docker:browser' },
        componentMap: { 'service:proxy:proxy-server': {} },
      });
      expect(key).toBe('service:proxy:proxy-server');
    });

    it('falls through the ladder to docker:aw-<appId>', () => {
      const key = resolveComponentKey({
        appId: 'browser',
        body: {},
        windowSpec: {},
        legacyApp: {},
        componentMap: { 'docker:aw-browser': {} },
      });
      expect(key).toBe('docker:aw-browser');
    });

    it('falls through to docker:<appId> (the Browser-specific convention)', () => {
      const key = resolveComponentKey({
        appId: 'browser',
        body: {},
        windowSpec: {},
        legacyApp: {},
        componentMap: { 'docker:browser': {} },
      });
      expect(key).toBe('docker:browser');
    });

    it('lands on the bare key for a multi-component app (crispal) — no prefix matching', () => {
      const key = resolveComponentKey({
        appId: 'crispal',
        body: {},
        windowSpec: {},
        legacyApp: {},
        componentMap: {
          'docker:aw-crispal': {},
          'docker:aw-crispal:db': {},
          'docker:aw-crispal:wordpress': {},
        },
      });
      expect(key).toBe('docker:aw-crispal');
    });

    it('returns null when nothing candidates and nothing is in componentMap', () => {
      const key = resolveComponentKey({
        appId: 'ghost', body: {}, windowSpec: {}, legacyApp: {}, componentMap: {},
      });
      expect(key).toBeNull();
    });
  });

  describe('resolveTitle', () => {
    it('prefers windowSpec.title', () => {
      expect(resolveTitle({ windowSpec: { title: 'Browser' }, appId: 'browser' })).toBe('Browser');
    });

    it('falls back to legacyApp.label, then legacyApp.name, then installedApp.name, then appId', () => {
      expect(resolveTitle({ windowSpec: {}, legacyApp: { label: 'Legacy Label' }, appId: 'x' })).toBe('Legacy Label');
      expect(resolveTitle({ windowSpec: {}, legacyApp: { name: 'Legacy Name' }, appId: 'x' })).toBe('Legacy Name');
      expect(resolveTitle({ windowSpec: {}, installedApp: { name: 'Installed Name' }, appId: 'x' })).toBe('Installed Name');
      expect(resolveTitle({ windowSpec: {}, appId: 'x' })).toBe('x');
    });
  });

  describe('appChrome', () => {
    it('gates canControlContainer on standalone_app !== false (service:proxy:proxy-server)', () => {
      const chrome = appChrome({
        appId: 'proxy',
        windowSpec: { title: 'AW Proxy', body: { type: 'managed_app', component: 'service:proxy:proxy-server' } },
        componentMap: { 'service:proxy:proxy-server': { status: 'running', standalone_app: false } },
      });
      expect(chrome.component).toBe('service:proxy:proxy-server');
      expect(chrome.canControlContainer).toBe(false);
      expect(chrome.canViewLogs).toBe(true);
    });

    it('canControlContainer true when standalone_app is unset (back-compat default)', () => {
      const chrome = appChrome({
        appId: 'browser',
        windowSpec: { title: 'Browser', body: { type: 'managed_app', kind: 'browser' } },
        componentMap: { 'docker:aw-browser': { status: 'running' } },
      });
      expect(chrome.canControlContainer).toBe(true);
      expect(chrome.canReloadFrame).toBe(true);
    });

    it('canReloadFrame is false for a non-managed_app body', () => {
      const chrome = appChrome({
        appId: 'kb',
        windowSpec: { title: 'Knowledge Base', body: { type: 'component' } },
        componentMap: {},
      });
      expect(chrome.canReloadFrame).toBe(false);
      expect(chrome.component).toBeNull();
      expect(chrome.canControlContainer).toBe(false);
    });

    it('builds the url from body.path against the {appId}.app.{apex} convention when body.url is absent', () => {
      const chrome = appChrome({
        appId: 'browser',
        windowSpec: { title: 'Browser', body: { type: 'managed_app', path: '/vnc.html?autoconnect=true' } },
        componentMap: {},
      });
      expect(chrome.url).toContain('browser.app.');
      expect(chrome.url).toContain('/vnc.html?autoconnect=true');
    });
  });
});
