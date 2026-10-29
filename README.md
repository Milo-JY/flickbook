# diffroll

**Rewind and read what your AI coding agent changed, one step at a time.**
Mark a baseline, let any agent (or yourself) edit, and replay every step as a diff plus an explanation in a local web UI. Nothing leaves your machine.

[한국어](README.ko.md)

<!-- demo GIF: recorded separately, to be added at docs/demo.gif -->
![diffroll demo](docs/demo.gif)

## Why

You ask an agent for a change, it touches seven files, and you skim a wall of diff afterwards. diffroll snapshots your working tree at each step so you can read the change in the order it happened, with the prompt that caused it next to the diff.

How it differs from nearby tools (as of 2026-10-29, from their public READMEs/docs):

| Tool | What it is | How diffroll differs |
|---|---|---|
| [Hunk](https://github.com/modem-dev/hunk) | Diff viewer for the current state | No timeline and no baseline you pick; diffroll replays a sequence of steps from a baseline you choose |
| [Entire CLI](https://github.com/entireio/cli) | Commit-linked checkpoints stored in refs that are pushed to the remote, for memory and sharing | diffroll keeps everything in local refs and never pushes; the point is reading, not sharing |
| Claude Code checkpoints / rewind | Per-prompt undo, Claude only, no explanations | diffroll is read-only for your files, works with any agent or a human, and adds explanations |
| [learning-opportunities](https://github.com/DrCatHicks/learning-opportunities) | A skill that quizzes you after the work | diffroll shows the diff itself, step by step |

## Install

Requires Node 20+ and git.

```sh
npm install -g diffroll
# or run once without installing
npx diffroll --help
```

## Usage

```sh
cd your-repo
diffroll start                         # mark the baseline (step 0)
# ... you or your agent edit files ...
diffroll step -m "add validation"      # snapshot the working tree as the next step
# ... more edits ...
diffroll step -m "add tests"
diffroll end                           # final snapshot, closes the session

diffroll replay                        # open the local web UI (127.0.0.1)
diffroll list                          # sessions in this repo
diffroll rm <id>                       # delete a session's snapshots
```

A step with no changes since the previous one is skipped. Uncommitted changes and untracked files are included (anything ignored by `.gitignore`, `.git/info/exclude` or your global excludes is not). Snapshots are hidden refs under `refs/diffroll/`; your branch, HEAD, index and files are never touched.

In the web UI use `j` / `k` to move between steps, switch between "vs previous" and "vs baseline" (cumulative), and between unified and split.

### Explanations (optional, off by default)

```sh
git config diffroll.provider claude     # or: codex
git config diffroll.lang ko             # default: en
diffroll explain                        # latest step (or --step N / --all)
```

Explanations use the `claude` or `codex` CLI you already have, run in an empty temporary directory and kept away from your own agent setup: `claude` with no tools, `--safe-mode` (no CLAUDE.md, skills, plugins, hooks or MCP servers), `--strict-mcp-config` and `--disable-slash-commands`; `codex` in a read-only sandbox with `--ignore-user-config`, `--ignore-rules` and no MCP servers. They are generated only when you click the button or run `diffroll explain`, cached in `.git/diffroll/explain/`, and shown immediately once they exist.

### Claude Code hook

`diffroll hook claude` prints a snippet to paste into `~/.claude/settings.json` (or a project's `.claude/settings.json`):

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

Each finished turn becomes one step, with your prompt stored as its context. The hooks do nothing (and print nothing) in repositories without an active session, so a global install is quiet. diffroll does not edit your settings for you.

## Privacy

Nothing leaves your machine until you set a provider.

- Snapshots, notes and prompt context live inside your repository's `.git` directory.
- The web server binds to `127.0.0.1` only, loads no remote assets, and rejects requests from other origins.
- If you set a provider, the step's diff (up to 60 KB) and the prompt context are sent to the provider behind that CLI. Not before.
- Snapshots include untracked files that are not ignored, so a large file or a secret such as an unignored `.env` is stored too and, if a provider is set, its diff is sent. List such files in `.gitignore` or `.git/info/exclude`.
- `codex exec` has no flag to skip global instruction files such as `AGENTS.md` in your Codex home, so those may still reach the model.
- Linked worktrees of one repository share the list of sessions (the refs); the active session is per worktree.
- Concurrent Claude Code sessions in one repository share one pending prompt context, so a step can carry another session's prompt.
- Caveat: `git push --mirror` and `git clone --mirror` copy all refs, including `refs/diffroll/*`, which contain your prompts. Run `diffroll rm <id>` first, or push branches explicitly. A normal `git push` / `git clone` does not transfer them.

## Development

```sh
pnpm install --ignore-scripts
pnpm build && pnpm test
scripts/demo-fixture.sh        # builds a throwaway repo with a 3-step session
```

`scripts/demo-fixture.sh` uses a demo-only `fixture` provider that returns canned text from a JSON file. It makes no AI call and is not meant for real use. The product name lives in `src/name.ts`.

## License

MIT
