# diffroll

**AI 코딩 에이전트가 바꾼 것을 한 단계씩 되감아 읽는 도구.**
기점을 찍고, 어떤 에이전트(또는 본인)든 편집하게 둔 뒤, 단계마다 diff와 해설을 로컬 웹 화면에서 다시 봅니다. 아무것도 내 컴퓨터 밖으로 나가지 않습니다.

[English](README.md)

<!-- 데모 GIF: 별도 녹화 후 docs/demo.gif 에 추가 -->
![diffroll demo](docs/demo.gif)

## 왜 필요한가

에이전트에게 변경을 시키면 파일 일곱 개가 한꺼번에 바뀌고, 나중에 긴 diff를 훑어보게 됩니다. diffroll 은 단계마다 작업 트리를 스냅샷해 두므로, 변경을 일어난 순서대로, 그 변경을 부른 프롬프트와 함께 읽을 수 있습니다.

가까운 도구와의 차이(2026-10-29 기준, 각 공개 README·문서 기준):

| 도구 | 무엇인가 | diffroll 과의 차이 |
|---|---|---|
| [Hunk](https://github.com/modem-dev/hunk) | 지금 상태의 diff 뷰어 | 타임라인과 사용자가 찍는 기점이 없음. diffroll 은 고른 기점부터 단계 열을 재생 |
| [Entire CLI](https://github.com/entireio/cli) | 커밋에 묶인 체크포인트를 원격으로 push 되는 ref 에 저장(기억·공유용) | diffroll 은 로컬 ref 에만 두고 push 하지 않음. 목적이 공유가 아니라 읽기 |
| Claude Code 체크포인트/rewind | 프롬프트 단위 되돌리기, Claude 전용, 해설 없음 | diffroll 은 파일을 건드리지 않는 읽기 전용이고, 어떤 에이전트·사람에게도 쓰이며, 해설이 있음 |
| [learning-opportunities](https://github.com/DrCatHicks/learning-opportunities) | 작업 뒤 퀴즈를 내는 스킬 | diffroll 은 diff 자체를 단계별로 보여 줌 |

## 설치

Node 20 이상과 git 이 필요합니다.

```sh
npm install -g diffroll
# 설치 없이 한 번만
npx diffroll --help
```

## 사용법

```sh
cd 내-저장소
diffroll start                         # 기점(0단계) 찍기
# ... 본인 또는 에이전트가 파일 편집 ...
diffroll step -m "검증 추가"            # 작업 트리를 다음 단계로 스냅샷
# ... 더 편집 ...
diffroll step -m "테스트 추가"
diffroll end                           # 마지막 스냅샷, 세션 종료

diffroll replay                        # 로컬 웹 화면 열기 (127.0.0.1)
diffroll list                          # 이 저장소의 세션 목록
diffroll rm <id>                       # 세션의 스냅샷 삭제
```

직전 단계와 달라진 것이 없으면 단계를 만들지 않습니다. 커밋하지 않은 변경과 추적되지 않는 새 파일도 포함합니다(`.gitignore`·`.git/info/exclude`·전역 제외 목록에 걸린 파일은 제외). 스냅샷은 `refs/diffroll/` 아래 숨은 ref 이며, 브랜치·HEAD·index·작업 파일은 건드리지 않습니다.

웹 화면에서는 `j` / `k` 로 단계를 이동하고, 「vs previous」(직전과 비교)와 「vs baseline」(기점부터 누적), unified 와 split 을 전환할 수 있습니다.

### 해설(선택 · 기본은 꺼짐)

```sh
git config diffroll.provider claude     # 또는 codex
git config diffroll.lang ko             # 기본값 en
diffroll explain                        # 최근 단계 (--step N · --all)
```

해설은 이미 설치된 `claude` 또는 `codex` CLI 를 쓰며, 도구를 끄거나(claude) 빈 디렉토리의 읽기 전용 샌드박스(codex)에서 실행합니다. 버튼을 누르거나 `diffroll explain` 을 실행할 때만 생성되고, `.git/diffroll/explain/` 에 캐시되며, 생성된 뒤에는 단계를 고르는 즉시 보입니다.

### Claude Code 훅

`diffroll hook claude` 가 `~/.claude/settings.json`(또는 프로젝트의 `.claude/settings.json`)에 붙일 스니펫을 출력합니다.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "diffroll hook claude-prompt" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "diffroll hook claude-stop" }] }
    ]
  }
}
```

에이전트의 한 턴이 끝날 때마다 한 단계가 쌓이고, 그 턴의 프롬프트가 맥락으로 저장됩니다. 활성 세션이 없는 저장소에서는 아무것도 하지 않고 출력도 없으므로 전역 설치해도 조용합니다. diffroll 이 설정 파일을 대신 고치지는 않습니다.

## 개인정보

provider 를 설정하기 전에는 아무것도 컴퓨터 밖으로 나가지 않습니다.

- 스냅샷·메모·프롬프트 맥락은 저장소의 `.git` 안에만 있습니다.
- 웹 서버는 `127.0.0.1` 에만 바인드하고, 외부 자원을 불러오지 않으며, 다른 출처의 요청을 거부합니다.
- provider 를 설정하면 해당 단계의 diff(최대 60 KB)와 프롬프트 맥락이 그 CLI 뒤의 공급자에게 전송됩니다. 설정 전에는 전송되지 않습니다.
- 주의: `git push --mirror`, `git clone --mirror` 는 `refs/diffroll/*` 를 포함한 모든 ref 를 복사하며 그 안에 프롬프트가 들어 있습니다. 먼저 `diffroll rm <id>` 를 하거나 브랜치를 명시해 push 하세요. 일반 `git push` / `git clone` 은 이 ref 를 옮기지 않습니다.

## 개발

```sh
pnpm install --ignore-scripts
pnpm build && pnpm test
scripts/demo-fixture.sh        # 3단계 세션이 든 임시 저장소 생성
```

`scripts/demo-fixture.sh` 는 JSON 파일의 고정 문구를 돌려주는 데모 전용 `fixture` provider 를 씁니다. AI 호출이 없고 실사용용이 아닙니다. 제품 이름은 `src/name.ts` 한 곳에 있습니다.

## 라이선스

MIT
