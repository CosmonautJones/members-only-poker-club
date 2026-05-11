// Fixture: lint-PASS. `new Date(<arg>)` with ≥1 argument is a
// deterministic constructor, NOT a wall-clock-now reference — the AST
// selector
//   NewExpression[callee.name='Date'][arguments.length=0]
// only matches the zero-argument form. AC4 sub-case 4: an
// arg-bearing `new Date(...)` is permitted anywhere.
export function getEpochAnchor(): Date {
  const d = new Date('2026-01-15T00:00:00Z');
  return d;
}
