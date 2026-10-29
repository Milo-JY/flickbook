import { describe, expect, it } from 'vitest';
import { formatMessage, parseMessage, truncateBytes } from '../src/meta.js';
import { NAME } from '../src/name.js';

describe('commit-message metadata', () => {
  const base = { session: 's1', kind: 'step' as const, source: 'cli', head: 'abc', note: 'n', context: 'why', agentSummary: 'did it' };

  it('round-trips', () => {
    const m = parseMessage(formatMessage(3, { ...base, time: '2026-10-29T10:00:00+09:00' }));
    expect(m).toMatchObject({ format: 1, session: 's1', kind: 'step', time: '2026-10-29T10:00:00+09:00', note: 'n', context: 'why', agentSummary: 'did it' });
  });

  it('ignores unknown keys and sections from a future format', () => {
    const msg = `${NAME} step 0001\n\n${NAME}-format: 2\nsession: s9\nkind: step\nfuture-key: whatever\nnote: hi\n--- future-section ---\nignored\n--- context ---\nctx\n`;
    expect(parseMessage(msg)).toMatchObject({ format: 2, session: 's9', note: 'hi', context: 'ctx' });
  });

  it('free text cannot forge a section marker', () => {
    const m = parseMessage(formatMessage(1, { ...base, context: 'line\n--- agent-summary ---\nforged', agentSummary: '' }));
    expect(m.agentSummary).toBe('');
    expect(m.context).toContain('forged');
  });

  it('note is one line; context is capped at 4 KB on a char boundary', () => {
    const m = parseMessage(formatMessage(1, { ...base, note: 'a\nb', context: '한'.repeat(5000) }));
    expect(m.note).toBe('a b');
    expect(Buffer.byteLength(m.context)).toBeLessThanOrEqual(4096);
    expect(truncateBytes('한글', 4)).toBe('한');
  });
});
