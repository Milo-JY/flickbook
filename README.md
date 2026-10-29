# flickbook

**Rewind and read what your AI coding agent changed, one step at a time.**
Mark a baseline, let any agent (or yourself) edit, and replay every step as a diff plus an explanation in a local web UI. Nothing leaves your machine.

[한국어](README.ko.md)

![flickbook demo](docs/demo.gif)

## Why

When I started my first developer job, I had senior colleagues, but they were busy, and writing good code is a different skill from explaining it. I'd hear "this is wrong," but not why, and not that the problem had a name (idempotency, input validation, race conditions...). Without the name I couldn't even search for it.

Now AI writes a lot of the code. It's faster, but more code gets accepted without anyone really reading it. In an [Anthropic study](https://www.anthropic.com/research/AI-assistance-coding-skills), developers who used AI assistance scored 17% lower on a quiz about the library they had just used. Moving on without understanding is now easier for everyone.

flickbook lets you flip through what your AI changed, one page at a time: what you asked for, what it actually did, what differs (missed or out of scope), where to check by hand, and the names of the concepts involved.

- **Juniors** get the "why" and the concept name right next to the change, so they can look it up on their own.
- **Seniors** who hand more and more work to AI can meet concepts they haven't used in a while, follow the code by hand again, and reuse the explanation order (asked, did, differs, check here) when explaining code to others.
- **Teams** can put the replay on a shared screen and walk colleagues through an AI-assisted change step by step. The replay runs only on your machine; flickbook does not share anything for you (explanations, if you turn them on, go through your provider).

You ask an agent for a change, it touches seven files, and you skim a wall of diff afterwards. flickbook snapshots your working tree at each step so you can read the change in the order it happened, with the prompt that caused it next to the diff.

How it differs from nearby tools (as of 2026-10-29, from their public READMEs/docs):

| Tool | What it is | How flickbook differs |
|---|---|---|
| [Hunk](https://github.com/modem-dev/hunk) | Diff viewer for the current state | No timeline and no baseline you pick; flickbook replays a sequence of steps from a baseline you choose |
| [Entire CLI](https://github.com/entireio/cli) | Commit-linked checkpoints stored in refs that are pushed to the remote, for memory and sharing | flickbook keeps everything in local refs and never pushes; the point is reading, not sharing |
| Claude Code checkpoints / rewind | Per-prompt undo, Claude only, no explanations | flickbook is read-only for your files, works with any agent or a human, and adds explanations |
| [learning-opportunities](https://github.com/DrCatHicks/learning-opportunities) | A skill that quizzes you after the work | flickbook shows the diff itself, step by step |

## Install

Requires Node 20+ and git.

```sh
npm install -g flickbook
# or run once without installing
npx flickbook --help
```

## Usage

```sh
cd your-repo
flickbook start                         # mark the baseline (step 0)
# ... you or your agent edit files ...
flickbook step -m "add validation"      # snapshot the working tree as the next step
# ... more edits ...
flickbook step -m "add tests"
flickbook end                           # final snapshot, closes the session

flickbook replay                        # open the local web UI (127.0.0.1)
flickbook list                          # sessions in this repo
flickbook rm <id>                       # delete a session's snapshots
```

A step with no changes since the previous one is skipped. Uncommitted changes and untracked files are included (anything ignored by `.gitignore`, `.git/info/exclude` or your global excludes is not). Snapshots are hidden refs under `refs/flickbook/`; your branch, HEAD, index and files are never touched.

In the web UI use `j` / `k` to move between steps, switch between "vs previous" and "vs baseline" (cumulative), and between unified and split.

### Explanations (optional, off by default)

```sh
git config flickbook.provider claude     # or: codex
git config flickbook.lang ko             # default: en
flickbook explain                        # latest step (or --step N / --all)
```

Each explanation has five labeled parts: **Requested** (what you asked for, from the recorded prompt and/or the step note; if no request was recorded it says so and makes no comparison), **Done** (what the diff actually changes), **Gap** (what was asked but is missing, and what changed without being asked), **Check yourself** (1-3 places to read closely, especially what the diff alone cannot confirm), and **Concepts** (1-3 standard design/engineering concepts the step touches or should have applied, such as input validation or boundary values, each with one plain sentence, so you know what to look up). In the web UI each part is a collapsible card; Gap, Check yourself and Concepts start open. To record the request, use the Claude Code hook or `flickbook step -m "..."`.

`git config flickbook.lang ko` switches both the explanations and the web UI to Korean (default `en`; `ko`, `ko-KR` and the like mean Korean, any other value falls back to English). CLI messages and error texts from the server stay in English.

Explanations use the `claude` or `codex` CLI you already have, run in an empty temporary directory and kept away from your own agent setup: `claude` with no tools, `--safe-mode` (no CLAUDE.md, skills, plugins, hooks or MCP servers), `--strict-mcp-config` and `--disable-slash-commands`; `codex` in a read-only sandbox with `--ignore-user-config`, `--ignore-rules` and no MCP servers. They are generated only when you click the button or run `flickbook explain`, cached in `.git/flickbook/explain/`, and shown immediately once they exist.

### Claude Code hook

`flickbook hook claude` prints a snippet to paste into `~/.claude/settings.json` (or a project's `.claude/settings.json`):

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

Each finished turn becomes one step, with your prompt stored as its context. The hooks do nothing (and print nothing) in repositories without an active session, so a global install is quiet. flickbook does not edit your settings for you.

## Privacy

Nothing leaves your machine until you set a provider.

- Snapshots, notes and prompt context live inside your repository's `.git` directory.
- The web server binds to `127.0.0.1` only, loads no remote assets, and rejects requests from other origins.
- If you set a provider, the step's diff (up to 60 KB) and the prompt context are sent to the provider behind that CLI. Not before.
- Snapshots include untracked files that are not ignored, so a large file or a secret such as an unignored `.env` is stored too and, if a provider is set, its diff is sent. List such files in `.gitignore` or `.git/info/exclude`.
- `codex exec` has no flag to skip global instruction files such as `AGENTS.md` in your Codex home, so those may still reach the model.
- Linked worktrees of one repository share the list of sessions (the refs); the active session is per worktree.
- Concurrent Claude Code sessions in one repository share one pending prompt context, so a step can carry another session's prompt.
- Caveat: `git push --mirror` and `git clone --mirror` copy all refs, including `refs/flickbook/*`, which contain your prompts. Run `flickbook rm <id>` first, or push branches explicitly. A normal `git push` / `git clone` does not transfer them.

## Development

```sh
pnpm install --ignore-scripts
pnpm build && pnpm test
scripts/demo-fixture.sh        # builds a throwaway repo with a 3-step session
```

`scripts/demo-fixture.sh` uses a demo-only `fixture` provider that returns canned text from a JSON file. It makes no AI call and is not meant for real use. The product name lives in `src/name.ts`.

## License

MIT
