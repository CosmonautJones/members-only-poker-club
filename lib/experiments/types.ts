/**
 * Experiment definition types — ADR-0029.
 *
 * Add a new experiment:
 *   1. Append the name to `ExperimentName`.
 *   2. Add a registry entry in `registry.ts` with variants/weights/holdout.
 *   3. Wrap the UI in `<Experiment name="..." renderers={...}>`.
 *
 * `__holdout__` is reserved as the holdout-variant return value from
 * `assignVariant`. Renderers should handle it as "render nothing" (i.e.,
 * fall back to a no-experiment baseline).
 */

export type ExperimentName = 'hero-cta-v1';

export const HOLDOUT = '__holdout__' as const;
export type Holdout = typeof HOLDOUT;

export interface ExperimentDefinition {
  readonly name: ExperimentName;
  /**
   * Variant names (excluding holdout). The first entry is "control" by
   * convention; assign() returns it for anonymous traffic too.
   */
  readonly variants: readonly string[];
  /**
   * Per-variant weights. Defaults to equal split. Must sum to 1 (validated
   * at registration; the test suite asserts).
   */
  readonly weights?: readonly number[];
  /**
   * Holdout percent (0–100). Holdout profiles always return `__holdout__`
   * and never see any variant. Default 10 per ADR-0029.
   */
  readonly holdoutPercent: number;
  /**
   * Whether the experiment is "live". When `false`, every profile gets the
   * control variant (used for hard-off / paused experiments).
   */
  readonly enabled: boolean;
  /** Owner — for the post-experiment readout. */
  readonly owner: string;
  /**
   * Path to the experiment-design doc (`docs/experiments/...`). Required —
   * every live experiment must have a written hypothesis.
   */
  readonly designDoc?: string;
}

export interface ExperimentContext {
  readonly profileId?: string;
}
