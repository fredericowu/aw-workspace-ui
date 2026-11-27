import { describe, it, expect } from 'vitest';
import { classifyGet, canonical, parseDraft, validateDocument, putSucceeded, snapshotOf } from '../lib/legacySettings';

describe('classifyGet', () => {
  it('envelope with an object value is the workspace store', () => {
    const c = classifyGet('mcp', 200, { key: 'mcp', value: { a: 1 } });
    expect(c).toEqual({ kind: 'workspace', exists: true, document: { a: 1 } });
  });
  it('envelope with null is Not set', () => {
    expect(classifyGet('aw', 200, { key: 'aw', value: null })).toEqual({ kind: 'workspace', exists: false, document: null });
  });
  it('envelope with an empty object is distinct from Not set', () => {
    const c = classifyGet('aw', 200, { key: 'aw', value: {} });
    expect(c.exists).toBe(true);
    expect(snapshotOf(c)).not.toBe(snapshotOf({ exists: false }));
  });
  it('aw-backend mcp and aw documents are the body', () => {
    expect(classifyGet('mcp', 200, { mcpServers: { x: { command: 'a' } } }).kind).toBe('backend');
    expect(classifyGet('aw', 200, { feed_subscriber: { cards: [] }, theme: 'x' }).kind).toBe('backend');
  });
  it('a backend body that contains a field named value is not an envelope', () => {
    expect(classifyGet('aw', 200, { key: 'aw', value: 1, extra: true }).kind).toBe('backend');
    expect(classifyGet('aw', 200, { value: { a: 1 } }).kind).toBe('backend');
  });
  it('wrong key in the envelope is not the workspace store', () => {
    expect(classifyGet('mcp', 200, { key: 'aw', value: null }).kind).toBe('backend');
  });
  it('array, scalar and non-200 are errors', () => {
    expect(classifyGet('mcp', 200, []).kind).toBe('error');
    expect(classifyGet('mcp', 200, null).kind).toBe('error');
    expect(classifyGet('mcp', 401, { key: 'mcp', value: null })).toEqual({ kind: 'error', status: 401 });
    expect(classifyGet('mcp', 200, { key: 'mcp', value: [1] }).kind).toBe('error');
  });
});

describe('draft handling', () => {
  it('refuses invalid JSON, arrays and scalars', () => {
    expect(parseDraft('{').ok).toBe(false);
    expect(parseDraft('[]').ok).toBe(false);
    expect(parseDraft('3').ok).toBe(false);
    expect(parseDraft('null').ok).toBe(false);
    expect(parseDraft('{"a":1}').ok).toBe(true);
  });
  it('canonical ignores key order', () => {
    expect(canonical({ b: 1, a: { d: 1, c: 2 } })).toBe(canonical({ a: { c: 2, d: 1 }, b: 1 }));
  });
  it('mcp backend guard', () => {
    expect(validateDocument('backend', 'mcp', { mcpServers: { a: {} } })).toBeNull();
    expect(validateDocument('backend', 'mcp', {})).toMatch(/mcpServers/);
    expect(validateDocument('backend', 'mcp', { mcpServers: { a: 1 } })).toMatch(/entry/);
    expect(validateDocument('workspace', 'mcp', {})).toBeNull();
  });
  it('judges each PUT by its own contract', () => {
    expect(putSucceeded('workspace', true, { ok: 1 })).toBe(true);
    expect(putSucceeded('backend', true, { ok: 1 })).toBe(false);
    expect(putSucceeded('backend', true, { success: true })).toBe(true);
    expect(putSucceeded('workspace', false, {})).toBe(false);
  });
});
