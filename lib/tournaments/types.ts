/**
 * Tournament + TournamentTemplate domain types.
 *
 * Slice 1 of ADR-0037 widened the `Tournament` shape from the fixture-era
 * 5-field interface to the database-projected shape that `lib/tournaments/
 * queries.ts` returns. The two consumers of `Tournament` outside this module
 * (`components/seo/event-jsonld.tsx` and `app/(marketing)/games/[slug]/page.tsx`)
 * still read only the fields they always read; the new fields are additive.
 *
 * `venueName` / `venueAddress` are composed in the queries layer from
 * `lib/content/nap.ts` — they are NOT stored in the database. The tournament
 * is always at the club; if that changes, the queries module gets the
 * conditional (not the row).
 */

/** A single tournament instance — the shape `fetchUpcomingTournaments` returns. */
export interface Tournament {
  /** UUID primary key. */
  readonly id: string;
  /** Stable slug; kebab-case; matches `/games/[slug]` permalink. */
  readonly slug: string;
  readonly name: string;
  /**
   * ISO-8601 UTC instant at which the tournament starts.
   * Per ADR-0034 §wall-clock-intent — pair with `tzName` for display.
   */
  readonly startsAt: string;
  /** IANA zone in which `startsAt` was scheduled (e.g. `'America/Chicago'`). */
  readonly tzName: string;
  /** Integer cents per ADR-0004. NEVER divide for arithmetic. */
  readonly buyInCents: number;
  readonly capacity: number;
  /** One of `'nlhe' | 'plo' | 'mixed' | 'other'` — DB CHECK enforces. */
  readonly gameType: 'nlhe' | 'plo' | 'mixed' | 'other';
  /** Markdown describing blind levels / rules. May be null. */
  readonly structureMd: string | null;
  /**
   * One of the lifecycle states. Slice 1 only emits / consumes
   * `'scheduled' | 'canceled' | 'complete'`; the remaining values activate
   * with ADR-0012 Slice 3 (registration).
   */
  readonly status: 'scheduled' | 'registering' | 'live' | 'complete' | 'canceled';
  /**
   * If materialized from a `tournament_templates` row, the template id.
   * `null` for one-off tournaments.
   */
  readonly sourceTemplateId: string | null;
  /** NAP-composed display value — single source of truth in lib/content/nap.ts. */
  readonly venueName: string;
  /** NAP-composed full street address. */
  readonly venueAddress: string;
}

/** A recurring tournament rule. Materializer expands these into `Tournament` rows. */
export interface TournamentTemplate {
  readonly id: string;
  readonly name: string;
  /** kebab-case prefix; materializer composes `<slugPrefix>-<YYYY-MM-DD>`. */
  readonly slugPrefix: string;
  /** 0=Sunday, 6=Saturday (ISO mod for Sunday-first weeks). */
  readonly dayOfWeek: number;
  /** `HH:MM:SS` wall-clock time, in `tzName`. */
  readonly timeOfDayLocal: string;
  readonly tzName: string;
  readonly buyInCents: number;
  readonly capacity: number;
  readonly gameType: 'nlhe' | 'plo' | 'mixed' | 'other';
  readonly structureMd: string | null;
  /** When false, the materializer skips this template. */
  readonly active: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}
