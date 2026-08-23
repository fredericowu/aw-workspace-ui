import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// Isolated from AppWindow.test.jsx so mocking apiUrl here can't change what
// the iframe-focus-overlay tests over there see `apiUrl(widget.src)` resolve
// to. See AppWindow.jsx's renderMarkdown() doc comment: a markdown link is a
// real browser navigation, never routed through the global fetch shim that
// rewrites every other same-origin `/api/*` call site — so it needs its own
// rewrite, mirroring what the `iframe` widget already does for `src`.
vi.mock('../apiBase', () => ({
  apiUrl: (path) =>
    path.startsWith('/api/') ? `https://api.testws.workspace.example.com${path}` : path,
  appSubdomainUrl: () => null,
}));

// eslint-disable-next-line import/first
import AppWindow from '../components/AppWindow';

describe('AppWindow markdown widget — same-origin /api/* link rewriting', () => {
  it('rewrites a same-origin /api/* markdown link to the workspace API origin', () => {
    const spec = {
      regions: [{
        id: 'oauth',
        widgets: [{ type: 'markdown', value: '[Connect](/api/apps/plaud/oauth/start)' }],
      }],
    };
    const { container } = render(<AppWindow spec={spec} />);
    const link = container.querySelector('a');
    expect(link.getAttribute('href')).toBe('https://api.testws.workspace.example.com/api/apps/plaud/oauth/start');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('leaves an external link untouched other than forcing target=_blank', () => {
    const spec = {
      regions: [{
        id: 'docs',
        widgets: [{ type: 'markdown', value: '[Docs](https://example.com/docs)' }],
      }],
    };
    const { container } = render(<AppWindow spec={spec} />);
    const link = container.querySelector('a');
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
  });
});
