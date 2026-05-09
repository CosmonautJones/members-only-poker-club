'use client';

/**
 * <Experiment> component — ADR-0029 slice 1.
 *
 * Wraps a UI choice in a deterministic variant assignment. The `renderers`
 * map names variant → React node. Holdout renders the renderer named
 * `__holdout__` if present; otherwise renders nothing (fall back to no
 * experiment).
 *
 * Fires `experiment_exposed` analytics on first mount per
 * (experiment, variant) pair so the funnel tools can correlate exposure
 * with downstream events. Multiple mounts (e.g., navigation back-and-forth)
 * suppress duplicate events within the same browser session.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { getExperimentVariant } from '@/lib/experiments';
import { HOLDOUT, type ExperimentName } from '@/lib/experiments/types';
import { track } from '@/lib/analytics';

interface ExperimentProps {
  readonly name: ExperimentName;
  /** Authenticated profile id. Anonymous traffic gets control. */
  readonly profileId?: string;
  readonly renderers: Readonly<Record<string, ReactNode>>;
}

export function Experiment({ name, profileId, renderers }: ExperimentProps): ReactNode {
  const variant = useMemo(() => {
    const ctx: { profileId?: string } = profileId === undefined ? {} : { profileId };
    return getExperimentVariant(name, ctx);
  }, [name, profileId]);
  const exposed = useRef<string | null>(null);

  useEffect(() => {
    if (exposed.current === variant) return;
    exposed.current = variant;
    track({ name: 'experiment_exposed', props: { experiment: name, variant } });
  }, [name, variant]);

  if (variant === HOLDOUT) {
    return renderers[HOLDOUT] ?? null;
  }
  return renderers[variant] ?? null;
}
