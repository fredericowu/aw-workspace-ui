// Shared search-match helpers for the two log viewers that need Cmd/Ctrl+F
// style in-place search (LogWindow — the standalone Workspace > Components
// window — and LogStream's embedded chrome used inside AppProxyWindow's
// "logs" view). Extracted so both call sites share exactly one
// implementation of the match-finding + highlight math instead of drifting.

/** All matches of `query` across `lines`, as `{lineIdx, startIdx}` tuples in
 * document order. */
export function computeMatches(lines, query) {
  if (!query) return [];
  const q = query.toLowerCase();
  const result = [];
  lines.forEach((line, lineIdx) => {
    const lower = line.toLowerCase();
    let pos = 0;
    while ((pos = lower.indexOf(q, pos)) !== -1) {
      result.push({ lineIdx, startIdx: pos });
      pos += q.length;
    }
  });
  return result;
}

/** Split `text` into React nodes with every `query` occurrence wrapped in a
 * `<mark>` (the active occurrence also gets `search-hit-active`).
 * `matchOffset` is the running count of matches already emitted on earlier
 * spans/lines so the global active-match index lines up with
 * `computeMatches`' order. `matchRefs` is a mutable array the caller scrolls
 * the active match into view from. */
export function highlightSearch(text, query, lineIdx, matchOffset, activeMatchIdx, matchRefs) {
  const parts = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let lastIdx = 0;
  let idx = lower.indexOf(q);
  let localMatch = 0;

  while (idx !== -1) {
    if (idx > lastIdx) parts.push(text.slice(lastIdx, idx));
    const globalIdx = matchOffset + localMatch;
    const isActive = globalIdx === activeMatchIdx;
    parts.push(
      <mark
        key={`${lineIdx}-${idx}`}
        ref={(el) => { if (el) matchRefs.current[globalIdx] = el; }}
        className={isActive ? 'search-hit search-hit-active' : 'search-hit'}
      >
        {text.slice(idx, idx + query.length)}
      </mark>
    );
    localMatch++;
    lastIdx = idx + query.length;
    idx = lower.indexOf(q, lastIdx);
  }
  if (lastIdx < text.length) parts.push(text.slice(lastIdx));
  return parts;
}

/** Count occurrences of `query` in a single `text` span — used to advance
 * the running global match offset while rendering ANSI-parsed spans. */
export function countMatches(text, query) {
  if (!query) return 0;
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  let count = 0;
  let pos = 0;
  while ((pos = lower.indexOf(q, pos)) !== -1) { count++; pos += q.length; }
  return count;
}
