import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NAME, VERSION } from '../src/name.js';

describe('product name and version', () => {
  it('src/name.ts matches package.json name, bin and version', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      name: string;
      version: string;
      bin: Record<string, string>;
    };
    expect(NAME).toBe('diffroll');
    expect(pkg.name).toBe(NAME);
    expect(Object.keys(pkg.bin)).toEqual([NAME]);
    expect(pkg.version).toBe(VERSION);
  });
});
