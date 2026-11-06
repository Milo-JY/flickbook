import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');
const readJson = (p: string) => JSON.parse(readFileSync(join(root, p), 'utf8'));

describe('Claude Code plugin', () => {
  it('keeps the plugin version in step with the npm package', () => {
    expect(readJson('plugins/flickbook/.claude-plugin/plugin.json').version).toBe(readJson('package.json').version);
  });

  it('points the marketplace entry at the plugin folder', () => {
    const entry = readJson('.claude-plugin/marketplace.json').plugins.find((p: { name: string }) => p.name === 'flickbook');
    expect(entry?.source).toBe('./plugins/flickbook');
    expect(existsSync(join(root, entry.source, '.claude-plugin/plugin.json'))).toBe(true);
  });
});
