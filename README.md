# reviewroll

**Rewind and read what your AI coding agent changed, one step at a time.**
Mark a baseline, let any agent (or yourself) edit, and replay every step as a diff plus an explanation in a local web UI. Nothing leaves your machine.

[한국어](README.ko.md)

<!-- demo GIF: recorded separately, to be added at docs/demo.gif -->
![reviewroll demo](docs/demo.gif)

## Why

You ask an agent for a change, it touches seven files, and you skim a wall of diff afterwards. reviewroll snapshots your working tree at each step so you can read the change in the order it happened, with the prompt that caused it next to the diff.

How it differs from nearby tools (as of 2026-10-29, from their public READMEs/docs):

| Tool | What it is | How reviewroll differs |
|---|---|---|
| [Hunk](https://github.com/modem-dev/hunk) | Diff viewer for the current state | No timeline and no baseline you pick; reviewroll replays a sequence of steps from a baseline you choose |
| [Entire CLI](https://github.com/entireio/cli) | Commit-linked checkpoints stored in refs that are pushed to the remote, for memory and sharing | reviewroll keeps everything in local refs and never pushes; the point is reading, not sharing |
| Claude Code checkpoints / rewind | Per-prompt undo, Claude only, no explanations | reviewroll is read-only for your files, works with any agent or a human, and adds explanations |
| [learning-opportunities](https://github.com/DrCatHicks/learning-opportunities) | A skill that quizzes you after the work | reviewroll shows the diff itself, step by step |

## Install

Requires Node 20+ and git.

```sh
npm install -g reviewroll
# or run once without installing
npx reviewroll --help
```

## Usage

```sh
cd your-repo
reviewroll start                       # mark the baseline (step 0)
# ... you or your agent edit files ...
reviewroll step -m "add validation"    # snapshot the working tree as the next step
# ... more edits ...
reviewroll step -m "add tests"
reviewroll end                         # final snapshot, closes the session

reviewroll replay                      # open the local web UI (127.0.0.1)
reviewroll list                        # sessions in this repo
reviewroll rm <id>                     # delete a session's snapshots
```

A step with no changes since the previous one is skipped. Uncommitted changes and untracked files are included (anything ignored by `.gitignore`, `.git/info/exclude` or your global excludes is not). Snapshots are hidden refs under `refs/reviewroll/`; your branch, HEAD, index and files are never touched.

In the web UI use `j` / `k` to move between steps, switch between "vs previous" and "vs baseline" (cumulative), and between unified and split.

### Explanations (optional, off by default)

```sh
git config reviewroll.provider claude   # or: codex
git config reviewroll.lang ko           # default: en
reviewroll explain                      # latest step (or --step N / --all)
```

Explanations use the `claude` or `codex` CLI you already have, run with tools disabled (claude) or a read-only sandbox in an empty directory (codex). They are generated only when you click the button or run `reviewroll explain`, cached in `.git/reviewroll/explain/`, and shown immediately once they exist.

### Claude Code hook

`reviewroll hook claude` prints a snippet to paste into `~/.claude/settings.json` (or a project's `.claude/settings.json`):

```json
{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "reviewroll hook claude-prompt" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "reviewroll hook claude-stop" }] }
    ]
  }
}
```

Each finished turn becomes one step, with your prompt stored as its context. The hooks do nothing (and print nothing) in repositories without an active session, so a global install is quiet. reviewroll does not edit your settings for you.

## Privacy

Nothing leaves your machine until you set a provider.

- Snapshots, notes and prompt context live inside your repository's `.git` directory.
- The web server binds to `127.0.0.1` only, loads no remote assets, and rejects requests from other origins.
- If you set a provider, the step's diff (up to 60 KB) and the prompt context are sent to the provider behind that CLI. Not before.
- Caveat: `git push --mirror` and `git clone --mirror` copy all refs, including `refs/reviewroll/*`, which contain your prompts. Run `reviewroll rm <id>` first, or push branches explicitly. A normal `git push` / `git clone` does not transfer them.

## Development

```sh
pnpm install --ignore-scripts
pnpm build && pnpm test
scripts/demo-fixture.sh        # builds a throwaway repo with a 3-step session
```

`scripts/demo-fixture.sh` uses a demo-only `fixture` provider that returns canned text from a JSON file. It makes no AI call and is not meant for real use. The product name lives in `src/name.ts`.

## License

MIT
