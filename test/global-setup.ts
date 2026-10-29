import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// e2e tests spawn dist/cli.js, so make sure it is current.
export default function setup(): void {
  const root = fileURLToPath(new URL('..', import.meta.url));
  execFileSync('pnpm', ['exec', 'tsup'], { cwd: root, stdio: 'pipe' });
}
