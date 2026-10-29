#!/bin/sh
# Builds a throwaway git repo with a 3-step flickbook session, for recording the demo GIF.
#   usage: scripts/demo-fixture.sh      (always builds in a fresh mktemp dir; takes no arguments)
# Then:  cd <printed dir> && node <path-to>/dist/cli.js replay
#
# The explanations come from the DEMO-ONLY "fixture" provider (canned text from a JSON file).
# It makes no AI call and sends nothing anywhere. It is not meant for real use.
set -eu

HERE=$(cd "$(dirname "$0")/.." && pwd)
CLI="node $HERE/dist/cli.js"
# the product name (git config namespace) comes from src/name.ts
NAME=$(sed -n "s/^export const NAME = '\(.*\)';/\1/p" "$HERE/src/name.ts")
[ -f "$HERE/dist/cli.js" ] || { echo "run 'pnpm build' first" >&2; exit 1; }

# never write into an existing directory: it could be a real repository
[ $# -eq 0 ] || { echo "usage: $0   (takes no arguments; it always creates a fresh temp dir)" >&2; exit 2; }
DIR=$(mktemp -d "${TMPDIR:-/tmp}/demo.XXXXXX")
[ -z "$(ls -A "$DIR")" ] || { echo "refusing: $DIR is not empty" >&2; exit 1; }
cd "$DIR"
# prompt files live outside the repo so they never show up in a snapshot
PROMPTS=$(mktemp -d "${TMPDIR:-/tmp}/demo-prompts.XXXXXX")
trap 'rm -rf "$PROMPTS"' EXIT
git init -q -b main
git config user.name "demo"
git config user.email "demo@example.invalid"

cat > cart.js <<'JS'
export function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.qty;
  }
  return sum;
}
JS
cat > cart.test.js <<'JS'
import { total } from './cart.js';

console.assert(total([{ price: 10, qty: 2 }]) === 20, 'basic total');
JS
git add -A
git commit -qm "initial cart"

$CLI start --name cart-discount -m "baseline: cart without discounts"

# ---- step 1: the agent adds a discount parameter
printf '%s' "Add an optional percentage discount to total()" > "$PROMPTS/p1"
cat > cart.js <<'JS'
export function total(items, discountPercent = 0) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.qty;
  }
  return sum * (1 - discountPercent / 100);
}
JS
$CLI step -m "add discount parameter" --source claude-code --context-file "$PROMPTS/p1"

# ---- step 2: validation (new behaviour) + a new file
printf '%s' "Reject discounts outside 0-100 and move the check into its own helper" > "$PROMPTS/p2"
cat > validate.js <<'JS'
export function assertPercent(value) {
  if (typeof value !== 'number' || value < 0 || value > 100) {
    throw new RangeError(`discount must be between 0 and 100, got ${value}`);
  }
}
JS
cat > cart.js <<'JS'
import { assertPercent } from './validate.js';

export function total(items, discountPercent = 0) {
  assertPercent(discountPercent);
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.qty;
  }
  return sum * (1 - discountPercent / 100);
}
JS
$CLI step -m "validate discount range" --source claude-code --context-file "$PROMPTS/p2"

# ---- step 3: tests for the new behaviour
printf '%s' "Add tests for the discount and the validation" > "$PROMPTS/p3"
cat > cart.test.js <<'JS'
import { total } from './cart.js';

console.assert(total([{ price: 10, qty: 2 }]) === 20, 'basic total');
console.assert(total([{ price: 10, qty: 2 }], 50) === 10, '50% discount');

let threw = false;
try {
  total([{ price: 10, qty: 1 }], 150);
} catch (e) {
  threw = e instanceof RangeError;
}
console.assert(threw, 'discount above 100 is rejected');
JS
$CLI step -m "test discount and validation" --source claude-code --context-file "$PROMPTS/p3"

$CLI end -m "done"

# ---- canned explanations (demo provider "fixture": no AI call, nothing leaves this machine)
cat > "$(git rev-parse --absolute-git-dir)/demo-explanations.json" <<'JSON'
{
  "add discount parameter": "- total() now takes an optional discountPercent (default 0), so existing callers keep working.\n- The subtotal is scaled by (1 - discountPercent / 100) at the end instead of changing the loop.\n- Nothing checks the range yet: a discount of 150 would produce a negative total.",
  "validate discount range": "- Adds validate.js with assertPercent(), which throws a RangeError unless the value is a number from 0 to 100.\n- total() calls it first, closing the gap left by the previous step.\n- The check lives in its own module so other pricing code can reuse it.",
  "test discount and validation": "- cart.test.js now covers a 50% discount (expects 10 for a 20 subtotal).\n- It also asserts that a 150% discount throws a RangeError.\n- Only tests changed in this step; behaviour is the same as the previous step."
}
JSON
git config $NAME.provider fixture
git config $NAME.fixtureFile "$(git rev-parse --absolute-git-dir)/demo-explanations.json"
$CLI explain --all >/dev/null

echo
echo "Demo repo ready: $DIR"
echo "Launch the UI:   cd '$DIR' && node '$HERE/dist/cli.js' replay"
