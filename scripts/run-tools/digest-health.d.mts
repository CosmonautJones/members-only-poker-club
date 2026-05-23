/**
 * Type declarations for digest-health.mjs.
 *
 * The implementation is plain ESM JavaScript so the script can run under any
 * Node toolchain without a build step; these declarations let the vitest test
 * suite (and any future TS consumer) exercise the exports with real types.
 */

export interface HealthByCategory {
  'new-test': number;
  'new-tool': number;
  'new-skill': number;
  'kb-archive': number;
  drop: number;
  surface: number;
  unknown: number;
}

export interface HealthResult {
  inbox_dir: string;
  total_processed: number;
  by_category: HealthByCategory;
  binding_numerator: number;
  binding_denominator: number;
  binding_ratio: number | null;
  healthy: boolean | null;
  threshold: number;
}

export type Frontmatter = Record<string, string>;

export type Category = keyof HealthByCategory;

export function parseFrontmatter(content: string): Frontmatter | null;
export function classify(processedInto: string): Category;
export function computeHealth(inboxDir: string): HealthResult;
