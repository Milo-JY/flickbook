import { describe, expect, it } from 'vitest';
import { Lru } from '../src/lru.js';

describe('Lru', () => {
  it('evicts the least recently used entry beyond max; a get refreshes', () => {
    const c = new Lru<string, number>(3);
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    expect(c.get('a')).toBe(1); // a is now the most recent
    c.set('d', 4); // evicts b
    expect(c.keys()).toEqual(['c', 'a', 'd']);
    expect(c.get('b')).toBeUndefined();
    c.set('c', 30); // overwrite refreshes too
    expect(c.keys()).toEqual(['a', 'd', 'c']);
    c.delete('d');
    expect(c.keys()).toEqual(['a', 'c']);
  });
});
