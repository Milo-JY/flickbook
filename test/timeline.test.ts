import { describe, expect, it } from 'vitest';
import { timelineRowLimit } from '../web/timeline.js';

describe('timelineRowLimit', () => {
  it('draws everything when it is small', () => {
    expect(timelineRowLimit(30, 20)).toBe(30);
  });
  it('caps rows so that rows x columns stays near 50000, with a floor of 10 rows', () => {
    expect(timelineRowLimit(5000, 100)).toBe(500);
    expect(timelineRowLimit(5000, 1000)).toBe(50);
    expect(timelineRowLimit(5000, 100_000)).toBe(10);
    expect(timelineRowLimit(4, 100_000)).toBe(4);
  });
});
