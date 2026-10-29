# flickbook

**AI 코딩 에이전트가 바꾼 것을 한 단계씩 되감아 읽는 도구.**
기점을 찍고, 어떤 에이전트(또는 본인)든 편집하게 둔 뒤, 단계마다 diff와 해설을 로컬 웹 화면에서 다시 봅니다. 아무것도 내 컴퓨터 밖으로 나가지 않습니다.

[English](README.md)

![flickbook demo](docs/demo.gif)

## 왜 필요한가

에이전트에게 변경을 시키면 파일 일곱 개가 한꺼번에 바뀌고, 나중에 긴 diff를 훑어보게 됩니다. flickbook 은 단계마다 작업 트리를 스냅샷해 두므로, 변경을 일어난 순서대로, 그 변경을 부른 프롬프트와 함께 읽을 수 있습니다.

가까운 도구와의 차이(2026-10-29 기준, 각 공개 README·문서 기준):

| 도구 | 무엇인가 | flickbook 과의 차이 |
|---|---|---|
| [Hunk](https://github.com/modem-dev/hunk) | 지금 상태의 diff 뷰어 | 타임라인과 사용자가 찍는 기점이 없음. flickbook 은 고른 기점부터 단계 열을 재생 |
| [Entire CLI](https://github.com/entireio/cli) | 커밋에 묶인 체크포인트를 원격으로 push 되는 ref 에 저장(기억·공유용) | flickbook 은 로컬 ref 에만 두고 push 하지 않음. 목적이 공유가 아니라 읽기 |
| Claude Code 체크포인트/rewind | 프롬프트 단위 되돌리기, Claude 전용, 해설 없음 | flickbook 은 파일을 건드리지 않는 읽기 전용이고, 어떤 에이전트·사람에게도 쓰이며, 해설이 있음 |
| [learning-opportunities](https://github.com/DrCatHicks/learning-opportunities) | 작업 뒤 퀴즈를 내는 스킬 | flickbook 은 diff 자체를 단계별로 보여 줌 |

## 설치

Node 20 이상과 git 이 필요합니다.

```sh
npm install -g flickbook
# 설치 없이 한 번만
npx flickbook --help
```

## 사용법

```sh
cd 내-저장소
flickbook start                         # 기점(0단계) 찍기
# ... 본인 또는 에이전트가 파일 편집 ...
flickbook step -m "검증 추가"            # 작업 트리를 다음 단계로 스냅샷
# ... 더 편집 ...
flickbook step -m "테스트 추가"
flickbook end                           # 마지막 스냅샷, 세션 종료

flickbook replay                        # 로컬 웹 화면 열기 (127.0.0.1)
flickbook list                          # 이 저장소의 세션 목록
flickbook rm <id>                       # 세션의 스냅샷 삭제
```

직전 단계와 달라진 것이 없으면 단계를 만들지 않습니다. 커밋하지 않은 변경과 추적되지 않는 새 파일도 포함합니다(`.gitignore`·`.git/info/exclude`·전역 제외 목록에 걸린 파일은 제외). 스냅샷은 `refs/flickbook/` 아래 숨은 ref 이며, 브랜치·HEAD·index·작업 파일은 건드리지 않습니다.

웹 화면에서는 `j` / `k` 로 단계를 이동하고, 「vs previous」(직전과 비교)와 「vs baseline」(기점부터 누적), unified 와 split 을 전환할 수 있습니다.

### 해설(선택 · 기본은 꺼짐)

```sh
git config flickbook.provider claude     # 또는 codex
git config flickbook.lang ko             # 기본값 en
flickbook explain                        # 최근 단계 (--step N · --all)
```

`git config flickbook.lang ko` 로 해설과 웹 화면을 모두 한국어로 바꿀 수 있습니다(기본값 `en`, 알 수 없는 값은 영어). CLI 메시지와 서버가 돌려주는 오류 문구는 영어로 남습니다.

해설은 이미 설치된 `claude` 또는 `codex` CLI 를 쓰며, 빈 임시 디렉토리에서, 사용자 자신의 에이전트 설정과 떨어뜨려 실행합니다: `claude` 는 도구 없이 `--safe-mode`(CLAUDE.md·스킬·플러그인·훅·MCP 서버 없음)·`--strict-mcp-config`·`--disable-slash-commands` 로, `codex` 는 읽기 전용 샌드박스에서 `--ignore-user-config`·`--ignore-rules` 와 MCP 서버 없이 실행합니다. 버튼을 누르거나 `flickbook explain` 을 실행할 때만 생성되고, `.git/flickbook/explain/` 에 캐시되며, 생성된 뒤에는 단계를 고르는 즉시 보입니다.

### Claude Code 훅

`flickbook hook claude` 가 `~/.claude/settings.json`(또는 프로젝트의 `.claude/settings.json`)에 붙일 스니펫을 출력합니다.

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "flickbook hook claude-prompt" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "flickbook hook claude-stop" }] }
    ]
  }
}
```

에이전트의 한 턴이 끝날 때마다 한 단계가 쌓이고, 그 턴의 프롬프트가 맥락으로 저장됩니다. 활성 세션이 없는 저장소에서는 아무것도 하지 않고 출력도 없으므로 전역 설치해도 조용합니다. flickbook 이 설정 파일을 대신 고치지는 않습니다.

## 개인정보

provider 를 설정하기 전에는 아무것도 컴퓨터 밖으로 나가지 않습니다.

- 스냅샷·메모·프롬프트 맥락은 저장소의 `.git` 안에만 있습니다.
- 웹 서버는 `127.0.0.1` 에만 바인드하고, 외부 자원을 불러오지 않으며, 다른 출처의 요청을 거부합니다.
- provider 를 설정하면 해당 단계의 diff(최대 60 KB)와 프롬프트 맥락이 그 CLI 뒤의 공급자에게 전송됩니다. 설정 전에는 전송되지 않습니다.
- 스냅샷에는 무시되지 않은 추적 안 되는 파일도 들어가므로, 큰 파일이나 무시 목록에 없는 `.env` 같은 비밀도 저장되고 provider 를 설정했다면 그 diff 가 전송됩니다. 그런 파일은 `.gitignore` 나 `.git/info/exclude` 에 넣으세요.
- `codex exec` 에는 Codex 홈의 `AGENTS.md` 같은 전역 지침 파일을 건너뛰는 옵션이 없어, 그 내용이 모델에 들어갈 수 있습니다.
- 한 저장소의 연결된 worktree 들은 세션 목록(ref)을 공유합니다. 활성 세션은 worktree 마다 따로입니다.
- 한 저장소에서 Claude Code 세션을 동시에 여럿 돌리면 대기 중인 프롬프트 맥락 하나를 공유하므로, 한 단계에 다른 세션의 프롬프트가 붙을 수 있습니다.
- 주의: `git push --mirror`, `git clone --mirror` 는 `refs/flickbook/*` 를 포함한 모든 ref 를 복사하며 그 안에 프롬프트가 들어 있습니다. 먼저 `flickbook rm <id>` 를 하거나 브랜치를 명시해 push 하세요. 일반 `git push` / `git clone` 은 이 ref 를 옮기지 않습니다.

## 개발

```sh
pnpm install --ignore-scripts
pnpm build && pnpm test
scripts/demo-fixture.sh        # 3단계 세션이 든 임시 저장소 생성
```

`scripts/demo-fixture.sh` 는 JSON 파일의 고정 문구를 돌려주는 데모 전용 `fixture` provider 를 씁니다. AI 호출이 없고 실사용용이 아닙니다. 제품 이름은 `src/name.ts` 한 곳에 있습니다.

## 라이선스

MIT
