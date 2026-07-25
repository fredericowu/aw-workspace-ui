// Logo — "wordmark + prompt chevron". Ported from the prototype's
// index.html inline SVG (lines 14-18): an amber `❯` chevron followed by the
// "aw" wordmark in Inter bold.

export default function Logo() {
  return (
    <div className="logo">
      <svg width="76" height="22" viewBox="0 0 240 70" role="img" aria-label="aw">
        <text x="0" y="50" fontFamily="ui-monospace, Menlo, monospace" fontSize="46" fontWeight="700" fill="#f5a623">
          {"❯"}
        </text>
        <text x="44" y="50" fontFamily="Inter" fontSize="46" fontWeight="800" fill="#e6edf3" letterSpacing="-1">
          aw
        </text>
      </svg>
    </div>
  );
}
