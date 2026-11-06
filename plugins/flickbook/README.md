# flickbook plugin for Claude Code

This plugin records each Claude Code turn as a [flickbook](https://github.com/Milo-JY/flickbook) step, so you can flip through every change the agent made, with its diff, in a local web UI.

## Requirements

The plugin only adds hooks. It needs the flickbook CLI on your `PATH`:

```bash
npm i -g flickbook
```

Without the CLI, the hooks exit quietly and do nothing.

## Install

```
/plugin marketplace add Milo-JY/flickbook
/plugin install flickbook@flickbook
```

## Use

1. In a git repository, run `/flickbook:start` (or `flickbook start` in a terminal).
2. Work with Claude Code as usual. Each finished turn becomes one step.
3. Run `flickbook replay` to open the local web UI, and `flickbook end` to close the session.

## What it runs, writes and sends

- **Runs:** `flickbook hook claude-prompt` when you submit a prompt, and `flickbook hook claude-stop` when a turn ends. Both read the hook input on stdin and print nothing.
- **Writes:** only inside the repository's `.git` folder: session files under `.git/flickbook/` (your prompt text is kept in `pending-context.txt` until the turn ends) and snapshot refs under `refs/flickbook/`. Your working tree and branches are not touched. In a repository without an active session, the hooks do nothing.
- **Sends:** nothing. The hooks make no network requests.

Explanations are a separate CLI feature. They run only when you click the button in the web UI or run `flickbook explain`, and they use your own `claude` CLI. See the main README for what is passed to it.

## License

MIT
