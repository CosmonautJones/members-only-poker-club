/**
 * Variant-assignment logic — ADR-0029.
 *
 * Allocation precedence:
 *   1. enabled === false  → control (every profile, including anon)
 *   2. anonymous traffic  → control (can't bucket without a profileId)
 *   3. holdout bucket     → __holdout__
 *   4. variant bucket     → variant name per weights
 *
 * Bucketing is deterministic on `(profileId, experimentName)` using the
 * same djb2 hash as `lib/flags/`. The 0..99 bucket is split:
 *   [0, holdoutPercent)            → holdout
 *   [holdoutPercent, 100)          → variants by cumulative-weight slicing
 */
import { bucketFor } from '@/lib/flags/evaluate';
import type { ExperimentContext, ExperimentDefinition } from './types';
import { HOLDOUT } from './types';

function uniformWeights(n: number): number[] {
  return Array.from({ length: n }, () => 1 / n);
}

// Returns a variant name string, OR the literal HOLDOUT marker (which is
// itself a string). Compare against the exported `HOLDOUT` constant at
// call sites to detect holdout.
export function assignVariant(def: ExperimentDefinition, ctx: ExperimentContext = {}): string {
  const control = def.variants[0];
  if (control === undefined) {
    throw new Error(`experiment ${def.name} has no variants`);
  }

  if (!def.enabled) return control;

  const { profileId } = ctx;
  if (!profileId) return control;

  const bucket = bucketFor(profileId, def.name);

  // Holdout slice: [0, holdoutPercent).
  const holdoutBoundary = Math.floor(def.holdoutPercent);
  if (bucket < holdoutBoundary) return HOLDOUT;

  // Variant distribution within [holdoutBoundary, 100).
  const weights = def.weights ?? uniformWeights(def.variants.length);
  if (weights.length !== def.variants.length) {
    throw new Error(`experiment ${def.name}: weights length must match variants length`);
  }

  const remaining = 100 - holdoutBoundary;
  let cumulative = holdoutBoundary;
  for (let i = 0; i < def.variants.length; i++) {
    const variantBoundaryWidth = (weights[i] ?? 0) * remaining;
    const variantBoundary = cumulative + variantBoundaryWidth;
    if (bucket < variantBoundary) {
      const variant = def.variants[i];
      if (variant === undefined) {
        // Should be unreachable given the length check above, but the type
        // narrowing requires the guard.
        return control;
      }
      return variant;
    }
    cumulative = variantBoundary;
  }

  // Floating-point edge: bucket landed at 100 boundary. Return the last
  // variant.
  const last = def.variants[def.variants.length - 1];
  return last ?? control;
}
