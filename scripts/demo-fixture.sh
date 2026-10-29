#!/bin/sh
# Builds a throwaway git repo with a 3-step flickbook session, for recording the demo GIF.
#   usage: scripts/demo-fixture.sh      (always builds in a fresh mktemp dir; takes no arguments)
#   Korean UI + Korean canned explanations:  FLICKBOOK_DEMO_LANG=ko scripts/demo-fixture.sh
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

LANG_CODE=${FLICKBOOK_DEMO_LANG:-en}
case "$LANG_CODE" in en|ko) ;; *) echo "FLICKBOOK_DEMO_LANG must be en or ko" >&2; exit 2;; esac
if [ "$LANG_CODE" = ko ]; then
  BASE_MSG="기점: 할인 없는 장바구니"
  P1="total() 에 선택적 퍼센트 할인을 추가해줘"; N1="할인 매개변수 추가"
  P2="할인율이 0~100 범위를 벗어나면 거부하고, 검사는 별도 함수로 분리해줘"; N2="할인율 범위 검증"
  P3="할인과 검증에 대한 테스트를 추가해줘"; N3="할인 및 검증 테스트"
  END_MSG="완료"
else
  BASE_MSG="baseline: cart without discounts"
  P1="Add an optional percentage discount to total()"; N1="add discount parameter"
  P2="Reject discounts outside 0-100 and move the check into its own helper"; N2="validate discount range"
  P3="Add tests for the discount and the validation"; N3="test discount and validation"
  END_MSG="done"
fi

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

$CLI start --name cart-discount -m "$BASE_MSG"

# ---- step 1: the agent adds a discount parameter
printf '%s' "$P1" > "$PROMPTS/p1"
cat > cart.js <<'JS'
export function total(items, discountPercent = 0) {
  let sum = 0;
  for (const item of items) {
    sum += item.price * item.qty;
  }
  return sum * (1 - discountPercent / 100);
}
JS
$CLI step -m "$N1" --source claude-code --context-file "$PROMPTS/p1"

# ---- step 2: validation (new behaviour) + a new file
printf '%s' "$P2" > "$PROMPTS/p2"
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
$CLI step -m "$N2" --source claude-code --context-file "$PROMPTS/p2"

# ---- step 3: tests for the new behaviour
printf '%s' "$P3" > "$PROMPTS/p3"
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
$CLI step -m "$N3" --source claude-code --context-file "$PROMPTS/p3"

$CLI end -m "$END_MSG"

# ---- canned explanations (demo provider "fixture": no AI call, nothing leaves this machine)
FIXTURE="$(git rev-parse --absolute-git-dir)/demo-explanations.json"
if [ "$LANG_CODE" = ko ]; then
cat > "$FIXTURE" <<'JSON'
{
  "할인 매개변수 추가": "- total() 이 선택적 인자 discountPercent(기본값 0)를 받게 되어, 기존 호출 코드는 그대로 동작합니다.\n- 반복문은 건드리지 않고, 마지막에 합계에 (1 - discountPercent / 100) 을 곱해 할인을 적용합니다.\n- 아직 범위 검사가 없어서 할인율 150 을 넣으면 합계가 음수가 됩니다.",
  "할인율 범위 검증": "- validate.js 를 새로 만들고 assertPercent() 를 추가했습니다. 값이 0 이상 100 이하의 숫자가 아니면 RangeError 를 던집니다.\n- total() 이 맨 처음에 이 함수를 호출해, 앞 단계에서 남았던 빈틈(범위 밖 할인율)을 막습니다.\n- 검사를 별도 모듈로 분리했으므로 다른 가격 계산 코드에서도 재사용할 수 있습니다.",
  "할인 및 검증 테스트": "- cart.test.js 에 50% 할인 테스트를 추가했습니다(합계 20 → 기대값 10).\n- 150% 할인은 RangeError 가 발생하는지도 확인합니다.\n- 이 단계에서는 테스트만 바뀌었고, 동작은 이전 단계와 같습니다."
}
JSON
else
cat > "$FIXTURE" <<'JSON'
{
  "add discount parameter": "- total() now takes an optional discountPercent (default 0), so existing callers keep working.\n- The subtotal is scaled by (1 - discountPercent / 100) at the end instead of changing the loop.\n- Nothing checks the range yet: a discount of 150 would produce a negative total.",
  "validate discount range": "- Adds validate.js with assertPercent(), which throws a RangeError unless the value is a number from 0 to 100.\n- total() calls it first, closing the gap left by the previous step.\n- The check lives in its own module so other pricing code can reuse it.",
  "test discount and validation": "- cart.test.js now covers a 50% discount (expects 10 for a 20 subtotal).\n- It also asserts that a 150% discount throws a RangeError.\n- Only tests changed in this step; behaviour is the same as the previous step."
}
JSON
fi
git config $NAME.provider fixture
git config $NAME.fixtureFile "$FIXTURE"
git config $NAME.lang "$LANG_CODE"
$CLI explain --all >/dev/null

echo
echo "Demo repo ready: $DIR"
echo "Launch the UI:   cd '$DIR' && node '$HERE/dist/cli.js' replay"
