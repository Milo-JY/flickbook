// Pure helpers for the timeline (no DOM), so they can be unit tested.

/** Total cells the grid may draw; beyond this the page gets slow. */
export const MAX_TIMELINE_CELLS = 50_000;

/** How many file rows to draw for `columns` step columns: at most MAX_TIMELINE_CELLS cells, but never fewer than 10 rows. */
export function timelineRowLimit(files: number, columns: number): number {
  return Math.min(files, Math.max(10, Math.floor(MAX_TIMELINE_CELLS / Math.max(1, columns))));
}
