// Marketplace sources — the list of marketplaces the app catalog is merged
// from, including private ones. Backed by /api/marketplace/sources
// (src/api/marketplace.py), persisted in this workspace's Postgres schema.
//
// The credential is write-only by design: the API never returns a stored
// token, only `has_credential`. So an edit that doesn't set `credential`
// leaves the existing one in place — see clearCredential() to remove it.
import { apiFetch } from '../auth';

async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.detail || body?.error || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return body;
}

export function listSources() {
  return apiFetch('/api/marketplace/sources').then(json);
}

export function createSource(source) {
  return apiFetch('/api/marketplace/sources', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source),
  }).then(json);
}

export function updateSource(id, source) {
  return apiFetch(`/api/marketplace/sources/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source),
  }).then(json);
}

export function deleteSource(id) {
  return apiFetch(`/api/marketplace/sources/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  }).then(json);
}

export function clearCredential(id) {
  return apiFetch(`/api/marketplace/sources/${encodeURIComponent(id)}/credential`, {
    method: 'DELETE',
  }).then(json);
}

// Fetch one source right now and report what came back — a wrong or expired
// token otherwise looks exactly like an empty catalog.
export function testSource(id) {
  return apiFetch(`/api/marketplace/sources/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  }).then(json);
}
