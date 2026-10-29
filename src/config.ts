import { NAME } from './name.js';

// Product defaults live here so they can be flipped in one place.

export const DEFAULTS = {
  /**
   * How the explanation panel behaves when a step is selected.
   *  - 'immediate': show an existing explanation right away (no click)
   *  - 'click':     hide it behind a "Reveal explanation" button (reading-practice mode)
   */
  explanationReveal: 'immediate' as 'immediate' | 'click',
  /** Language of generated explanations; override with `git config <NAME>.lang ko`. */
  explanationLang: 'en',
};

export const LIMITS = {
  /** Max diff bytes sent to an explanation provider; the rest is cut per file. */
  explainDiffBytes: 60 * 1024,
  /** Prompt context stored in a snapshot commit message. */
  contextBytes: 4 * 1024,
  /** Agent's last message stored in a snapshot commit message. */
  agentSummaryBytes: 2 * 1024,
  noteChars: 200,
  explainTimeoutMs: 120_000,
  explainOutputBytes: 64 * 1024,
  /** A tmp index older than this is considered abandoned by a killed process. */
  staleTmpIndexMs: 10 * 60 * 1000,
  stepAttempts: 5,
};

/** Bumped when the prompt template changes; part of the explanation cache key. */
export const TEMPLATE_VERSION = 'v2';
export const FORMAT_VERSION = 1;
export const REF_PREFIX = `refs/${NAME}`;
export const ZERO_OID = '0000000000000000000000000000000000000000';
