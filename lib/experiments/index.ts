/**
 * Public experiments surface — ADR-0029 slice 1.
 *
 * Consumer call sites:
 *
 *   import { getExperimentVariant } from '@/lib/experiments';
 *
 *   const variant = getExperimentVariant('hero-cta-v1', { profileId });
 *
 * For React UI, prefer `<Experiment>` from `components/site/experiment.tsx`.
 */
import { assignVariant } from './assign';
import { EXPERIMENTS } from './registry';
import type { ExperimentContext, ExperimentName } from './types';

// Returns a variant name string, OR the literal HOLDOUT (`'__holdout__'`)
// for holdout assignments. The return type collapses to `string` in
// TypeScript (HOLDOUT is a string literal), but callers should compare
// against the exported `HOLDOUT` constant to detect holdout — never
// hard-code the literal at call sites.
export function getExperimentVariant(name: ExperimentName, ctx: ExperimentContext = {}): string {
  const def = EXPERIMENTS[name];
  return assignVariant(def, ctx);
}

export type { ExperimentName, ExperimentContext, ExperimentDefinition, Holdout } from './types';
export { HOLDOUT } from './types';
export { EXPERIMENTS } from './registry';
export { assignVariant } from './assign';
