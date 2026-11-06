---
description: Start a flickbook session in this git repository so each Claude Code turn is recorded as a step you can replay later.
---
Run `flickbook start` in the root of the current git repository and show the user its output.

If the `flickbook` command is not found, do not install anything yourself. Tell the user to install it with `npm i -g flickbook` (Node 20 or later) and run this again.

After the session has started, each finished turn is recorded as one step by the plugin's hooks. Tell the user they can open the replay with `flickbook replay` and close the session with `flickbook end`.
