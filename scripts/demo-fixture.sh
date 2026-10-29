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
  "할인 매개변수 추가": "요청한 것: total() 에 선택적 퍼센트 할인을 추가해 달라는 요청입니다.\n실제로 한 것:\n- total() 이 선택적 인자 discountPercent(기본값 0)를 받아, 기존 호출 코드는 그대로 동작합니다.\n- 합계에 (1 - discountPercent / 100) 을 곱하는 식으로 할인을 적용합니다.\n차이: 요청한 기능은 모두 들어갔고, 요청하지 않은 변경은 없습니다. 다만 할인율의 범위 검사는 없습니다.\n직접 확인할 곳:\n- cart.js 의 total(): 할인율 150 이나 -10 을 넣으면 합계가 음수이거나 원래보다 커집니다. diff 만으로는 호출하는 쪽이 항상 올바른 값을 넘기는지 알 수 없습니다.\n쓰인 개념:\n- 하위 호환성(backward compatibility) — 기본값 discountPercent = 0 덕분에 기존의 total(items) 호출이 바뀌지 않고 그대로 동작합니다.\n- 입력 검증(input validation) — 값을 쓰기 전에 허용되는 값인지 확인하는 것으로, 지금은 150 이나 -10 같은 할인율을 막는 곳이 없습니다.",
  "할인율 범위 검증": "요청한 것: 할인율이 0~100 범위를 벗어나면 거부하고, 검사는 별도 함수로 분리해 달라는 요청입니다.\n실제로 한 것:\n- validate.js 를 새로 만들고 assertPercent() 를 추가했습니다. 0 이상 100 이하의 숫자가 아니면 RangeError 를 던집니다.\n- total() 이 맨 처음에 이 함수를 호출합니다.\n차이: 없음.\n직접 확인할 곳:\n- validate.js 의 assertPercent(): NaN 과 경계값(0, 100)을 어떻게 다루는지 직접 확인하세요.\n- cart.js 의 total(): 검사가 계산보다 먼저 실행되는지 보세요.\n쓰인 개념:\n- 빠른 실패(fail fast) · 보호절(guard clause) — total() 이 계산을 시작하기 전에 맨 앞에서 잘못된 할인율을 거부해, 틀린 숫자를 돌려주지 않습니다.\n- 경계값(boundary values) — 허용 범위의 끝(0, 100)과 그 바로 바깥(-1, 101)으로, 부등호를 하나 잘못 쓰는 실수가 숨는 곳입니다.",
  "할인 및 검증 테스트": "요청한 것: 할인과 검증에 대한 테스트를 추가해 달라는 요청입니다.\n실제로 한 것:\n- cart.test.js 에 50% 할인 테스트를 추가했습니다(합계 20 → 기대값 10).\n- 150% 할인이 RangeError 를 던지는지도 확인합니다.\n차이: 요청한 테스트는 들어갔지만, 경계값(0%, 100%)과 음수 할인율은 테스트하지 않습니다. 요청하지 않은 변경은 없습니다.\n직접 확인할 곳:\n- cart.test.js 의 console.assert 호출: 실패해도 프로세스가 오류로 끝나지 않을 수 있으니, 테스트가 실제로 실패를 알리는지 확인하세요.\n쓰인 개념:\n- 경계값 테스트(boundary value testing) — 한계값과 그 바로 바깥(0, 100, 101)을 테스트하는 것으로, 여기서는 50 과 150 만 테스트합니다.\n- 실패할 수 있는 테스트(a test that can fail) — 결과가 틀렸을 때 실패를 알려야 쓸모 있는 테스트인데, console.assert 는 메시지만 찍고 실행을 멈추지 않습니다."
}
JSON
else
cat > "$FIXTURE" <<'JSON'
{
  "add discount parameter": "Requested: an optional percentage discount for total().\nDone:\n- total() now takes an optional discountPercent (default 0), so existing callers keep working.\n- The result is multiplied by (1 - discountPercent / 100) to apply the discount.\nGap: the requested feature is all there and nothing unrequested changed, but there is no range validation on the percentage.\nCheck yourself:\n- cart.js, total(): a discount of 150 or -10 gives a negative or larger-than-original total. The diff cannot show whether callers always pass sane values.\nConcepts:\n- Backward compatibility — the default value discountPercent = 0 keeps every existing total(items) call working unchanged.\n- Input validation — checking that a value is allowed before using it; here nothing stops a discount of 150 or -10.",
  "validate discount range": "Requested: reject discounts outside 0-100 and move the check into its own helper.\nDone:\n- Adds validate.js with assertPercent(), which throws a RangeError unless the value is a number from 0 to 100.\n- total() calls it first.\nGap: None.\nCheck yourself:\n- validate.js, assertPercent(): check how NaN and the boundary values 0 and 100 are handled.\n- cart.js, total(): confirm the check runs before any calculation.\nConcepts:\n- Fail fast (guard clause) — total() rejects a bad discount at the very top, before doing any work, instead of returning a wrong number.\n- Boundary values — the edges of the allowed range (0 and 100) and just outside it (-1 and 101), where off-by-one mistakes hide.",
  "test discount and validation": "Requested: tests for the discount and the validation.\nDone:\n- cart.test.js now covers a 50% discount (expects 10 for a 20 subtotal).\n- It also asserts that a 150% discount throws a RangeError.\nGap: the requested tests are there, but the boundaries (0% and 100%) and negative discounts are not tested. Nothing unrequested changed.\nCheck yourself:\n- cart.test.js, the console.assert calls: a failed assert may not make the process exit with an error, so confirm these tests can actually fail.\nConcepts:\n- Boundary value testing — testing exactly at and just past the limits (0, 100 and 101); here only 50 and 150 are tested.\n- A test that can fail — a test is only useful if a wrong result makes it report failure; console.assert only prints a message and does not stop the run."
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
