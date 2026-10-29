import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: false,
  sourcemap: false,
  // the shebang in src/cli.ts is preserved by tsup
});
