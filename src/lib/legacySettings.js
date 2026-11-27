// Pure helpers for the Legacy settings editors (two fixed whole-document JSON
// editors for /api/settings/mcp and /api/settings/aw).
//
// The same UI build is served against two different backends behind the SAME
// URLs, so a GET body is classified by shape:
//   * workspace store (aw-workspace core generic KV): exactly {key, value} with
//     key === the requested key; value is the document, null = row absent.
//   * aw-backend document: any other JSON object; the body IS the document.
export const LEGACY_PATHS = Object.freeze({
  mcp: '/api/settings/mcp',
  aw: '/api/settings/aw',
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

export function classifyGet(key, status, body) {
  if (status !== 200) return { kind: 'error', status };
  if (!isObject(body)) return { kind: 'error', status };
  const fields = Object.keys(body).sort();
  if (fields.length === 2 && fields[0] === 'key' && fields[1] === 'value' && body.key === key) {
    if (body.value === null) return { kind: 'workspace', exists: false, document: null };
    if (isObject(body.value)) return { kind: 'workspace', exists: true, document: body.value };
    return { kind: 'error', status };
  }
  return { kind: 'backend', exists: true, document: body };
}

// Key-sorted JSON so "different from loaded" ignores key order.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

// Text -> {ok, value} | {ok:false, error}. Only a JSON object is accepted.
export function parseDraft(text) {
  let value;
  try { value = JSON.parse(text); } catch { return { ok: false, error: 'Not valid JSON.' }; }
  if (!isObject(value)) return { ok: false, error: 'Must be a JSON object.' };
  return { ok: true, value };
}

// Extra guard for the aw-backend mcp.json document.
export function validateDocument(kind, key, doc) {
  if (kind === 'backend' && key === 'mcp') {
    if (!isObject(doc.mcpServers)) return 'mcpServers must be an object.';
    for (const v of Object.values(doc.mcpServers)) {
      if (!isObject(v)) return 'Every mcpServers entry must be an object.';
    }
  }
  return null;
}

// The PUT body is the document itself on both backends.
export const buildPutBody = (doc) => doc;

// core's PUT reply has no success field; aw-backend's does.
export function putSucceeded(kind, ok, body) {
  if (!ok) return false;
  if (kind === 'backend') return isObject(body) && body.success === true;
  return true;
}

// What is on the server, as a comparable token (null row = 'unset').
export const snapshotOf = (cls) => (cls.exists ? canonical(cls.document) : 'unset');

export function describeState(kind, key, cls) {
  if (kind === 'workspace') {
    if (!cls.exists) return 'Not set';
    return Object.keys(cls.document).length === 0 ? 'Empty object' : `Set (${Object.keys(cls.document).length} top-level keys)`;
  }
  if (key === 'mcp') {
    const n = isObject(cls.document.mcpServers) ? Object.keys(cls.document.mcpServers).length : 0;
    return `${n} servers`;
  }
  return 'Set';
}
