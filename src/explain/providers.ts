import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RrError } from '../errors.js';
import { gitConfig, type Repo } from '../repo.js';
import { runCli } from './run.js';
import type { ExplainInput } from './prompt.js';
import { NAME } from '../name.js';

export type ProviderName = 'none' | 'claude' | 'codex' | 'fixture';

export interface Provider {
  explain(input: ExplainInput): Promise<string>;
}

async function withEmptyDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), `${NAME}-explain-`));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function claudeProvider(model: string | undefined): Provider {
  return {
    explain: (input) =>
      withEmptyDir((dir) => {
        // Isolation from the user's own Claude Code setup, in an empty cwd:
        //  --safe-mode               no CLAUDE.md, skills, plugins, hooks, MCP servers, custom commands/agents
        //                            (unlike --bare it keeps normal auth, so OAuth logins still work)
        //  --strict-mcp-config       with no --mcp-config: no MCP servers from any source
        //  --disable-slash-commands  no skills or commands
        //  --tools ""                no built-in tools
        //  --no-session-persistence  nothing saved to disk
        const args = [
          '-p',
          '--output-format',
          'text',
          '--safe-mode',
          '--strict-mcp-config',
          '--disable-slash-commands',
          '--tools',
          '',
          '--no-session-persistence',
        ];
        if (model) args.push('--model', model);
        return runCli('claude', args, { input: input.prompt, cwd: dir });
      }),
  };
}

function codexProvider(model: string | undefined): Provider {
  return {
    explain: (input) =>
      withEmptyDir(async (dir) => {
        const outFile = join(dir, 'out.txt');
        // read-only sandbox, empty cwd, nothing persisted; the user's config.toml (MCP servers, profiles,
        // hooks) and execpolicy rules are not loaded, and MCP servers are emptied for any other config layer
        const args = [
          'exec',
          '-s',
          'read-only',
          '--ephemeral',
          '--skip-git-repo-check',
          '--ignore-user-config',
          '--ignore-rules',
          '-c',
          'mcp_servers={}',
          '-C',
          dir,
          '-o',
          outFile,
        ];
        if (model) args.push('-m', model);
        args.push('-');
        const stdout = await runCli('codex', args, { input: input.prompt, cwd: dir });
        try {
          return await readFile(outFile, 'utf8');
        } catch {
          return stdout;
        }
      }),
  };
}

/**
 * DEMO ONLY. Makes no AI call and sends nothing anywhere: returns canned text from the JSON file named by
 * `git config <NAME>.fixtureFile` ({ "<step note>": "<text>" }), or a generic line built from the file list.
 */
function fixtureProvider(file: string | undefined): Provider {
  return {
    async explain(input) {
      if (file) {
        try {
          const map = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
          const t = map[input.note];
          if (typeof t === 'string') return t;
        } catch {
          /* fall through to the generic text */
        }
      }
      return `- Touches ${input.files.length} file(s): ${input.files.join(', ')}`;
    },
  };
}

export async function resolveProviderName(repo: Repo, override?: string): Promise<ProviderName> {
  const raw = override ?? (await gitConfig(repo, `${NAME}.provider`)) ?? 'none';
  if (raw === 'none' || raw === 'claude' || raw === 'codex' || raw === 'fixture') return raw;
  throw new RrError(`unknown provider "${raw.slice(0, 40)}" (use none, claude or codex)`);
}

export async function makeProvider(repo: Repo, name: ProviderName): Promise<Provider> {
  const model = await gitConfig(repo, `${NAME}.model`);
  switch (name) {
    case 'claude':
      return claudeProvider(model);
    case 'codex':
      return codexProvider(model);
    case 'fixture':
      return fixtureProvider(await gitConfig(repo, `${NAME}.fixtureFile`));
    case 'none':
      throw new RrError(PROVIDER_HELP);
  }
}

export const PROVIDER_HELP =
  'No explanation provider is set, so nothing was generated and nothing was sent anywhere.\n' +
  'Choose one (it uses the CLI you already have installed):\n' +
  `  git config ${NAME}.provider claude   # or: codex\n` +
  'The step diff and your prompt context will then be sent to that CLI\'s provider.';
