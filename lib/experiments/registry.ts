/**
 * Experiment registry — ADR-0029.
 *
 * In-code source of truth for live experiments. Future slice swaps to a
 * PostHog-feature-flag-backed read path; the call-site API stays the same.
 */
import type { ExperimentDefinition, ExperimentName } from './types';

export const EXPERIMENTS: Record<ExperimentName, ExperimentDefinition> = {
  // Example experiment, NOT live (enabled=false). Demonstrates the shape
  // and gives the type system a real key to bind to.
  'hero-cta-v1': {
    name: 'hero-cta-v1',
    variants: ['control', 'v1'],
    holdoutPercent: 10,
    enabled: false,
    owner: 'marketing',
  },
} as const;
