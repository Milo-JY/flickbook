import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { LIMITS } from './config.js';
import { truncateBytes } from './meta.js';
import { openRepo } from './repo.js';
import { activeId, stepSession } from './session.js';
import { NAME } from './name.js';

export const CLAUDE_HOOK_SNIPPET = `{
  "hooks": {
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "${NAME} hook claude-prompt" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "${NAME} hook claude-stop" }] }
    ]
  }
}`;

/** Only the fields we use are read, and only when they are strings. */
export interface HookInput {
  cwd?: string;
  prompt?: string;
  lastAssistantMessage?: string;
}

export function parseHookInput(raw: string): HookInput {
  let j: unknown;
  try {
    j = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof j !== 'object' || j === null || Array.isArray(j)) return {};
  const o = j as Record<string, unknown>;
  const out: HookInput = {};
  if (typeof o['cwd'] === 'string' && o['cwd']) out.cwd = o['cwd'];
  if (typeof o['prompt'] === 'string') out.prompt = o['prompt'];
  if (typeof o['last_assistant_message'] === 'string') out.lastAssistantMessage = o['last_assistant_message'];
  return out;
}

const pendingPath = (rr: string) => join(rr, 'pending-context.txt');

/**
 * Hooks must never break the agent: every failure path ends in a normal return.
 * Returns a short status string for tests; nothing is printed to stdout.
 */
export async function runHook(kind: 'claude-prompt' | 'claude-stop', rawStdin: string): Promise<string> {
  const input = parseHookInput(rawStdin);
  let repo;
  try {
    repo = await openRepo(input.cwd ?? process.cwd());
  } catch {
    return 'not-a-repo';
  }
  if (!(await activeId(repo))) return 'inactive';
  if (kind === 'claude-prompt') {
    if (input.prompt === undefined) return 'no-prompt';
    await mkdir(repo.rr, { recursive: true });
    await writeFile(pendingPath(repo.rr), truncateBytes(input.prompt, LIMITS.contextBytes));
    return 'saved';
  }
  let context = '';
  try {
    context = await readFile(pendingPath(repo.rr), 'utf8');
  } catch {
    /* no prompt was recorded for this turn */
  }
  const res = await stepSession(repo, {
    source: 'claude-code',
    ifActive: true,
    context,
    agentSummary: input.lastAssistantMessage
      ? truncateBytes(input.lastAssistantMessage, LIMITS.agentSummaryBytes)
      : '',
  });
  await rm(pendingPath(repo.rr), { force: true });
  return res.status;
}
