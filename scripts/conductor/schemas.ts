import { z } from 'zod';

// 5 operational phases (bootstrap..retrospective) plus 3 terminal states
// (completed, aborted, escalated). v0.2 dropped 'document' (folded into ship)
// and 'cleanup' (folded into retrospective).
export const PHASES = [
  'bootstrap',
  'plan',
  'build',
  'integration',
  'ship',
  'retrospective',
  'completed',
  'aborted',
  'escalated',
] as const;

export const StatusSchema = z.object({
  adr: z.string().regex(/^\d{4}$/),
  phase: z.enum(PHASES),
  started_at: z.string().datetime(),
  current_task_id: z.string().optional(),
  // Per-task iteration counts. Replaces the old global iter_count for split-aware
  // bookkeeping: when task-splitter fires on `t3`, the new `t3a`/`t3b` start at 0
  // and the original `t3` entry is preserved for audit.
  task_iters: z.record(z.string(), z.number().int().nonnegative()).default({}),
  // Per-task split count. Number of times task-splitter has run on this task or
  // any predecessor (chained: if `t3` split into `t3a/t3b` and `t3a` split into
  // `t3a1/t3a2`, then `t3a1` carries splits[t3a1] = 2). Used to enforce a
  // hard cap (default 2) on chained split-and-retry before escalation.
  splits: z.record(z.string(), z.number().int().nonnegative()).default({}),
  events_offset: z.number().int().nonnegative(),
  spec_path: z.string().optional(),
  // Spec acceptance_commands the validator MUST run before scope-judge can
  // return ship_ready=true. Bound at Phase 1 (planner reads spec frontmatter)
  // and frozen for the run.
  acceptance_commands_required: z.array(z.string()).default([]),
  // Subset that has run and passed in the latest validator pass. scope-judge
  // refuses ship_ready=true if required ⊃ run.
  acceptance_commands_run: z.array(z.string()).default([]),
  // v0.3: canonical content hashes of the ADR and spec captured at Phase 0
  // close. Keyed by file path. /conductor resume recomputes these and
  // dispatches `critic mode=delta` if any value drifts. See canonical-hash.ts
  // for the hashing rules. Also stamped into every dispatch envelope (as
  // input_signature) so background work cannot silently complete against an
  // ADR that has since been amended.
  input_hashes: z.record(z.string(), z.string()).default({}),
  // v0.3: Phase 0 triage classifies the ADR as `light` (ratifier alone) or
  // `full` (fan out to falsifier + direction-mode premortem before ratifier).
  // Recorded so resume re-enters the same depth without re-triaging.
  triage_depth: z.enum(['light', 'full']).optional(),
  escalation_reason: z.string().optional(),
});

export type Status = z.infer<typeof StatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  blockedBy: z.array(z.string()).default([]),
  risk: z.enum(['low', 'medium', 'high']),
  linked_adrs: z.array(z.string().regex(/^\d{4}$/)).default([]),
});

export type Task = z.infer<typeof TaskSchema>;

export const PlanSchema = z
  .object({
    spec_path: z.string(),
    tasks: z.array(TaskSchema).min(1),
  })
  .superRefine((plan, ctx) => {
    const ids = new Set(plan.tasks.map((t) => t.id));
    for (const task of plan.tasks) {
      for (const dep of task.blockedBy) {
        if (!ids.has(dep)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `task ${task.id} blockedBy references unknown task ${dep}`,
          });
        }
      }
    }

    const visited = new Set<string>();
    const inStack = new Set<string>();
    const taskById = new Map(plan.tasks.map((t) => [t.id, t]));
    const hasCycle = (id: string): boolean => {
      if (inStack.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      inStack.add(id);
      const task = taskById.get(id);
      if (task) {
        for (const dep of task.blockedBy) {
          if (hasCycle(dep)) return true;
        }
      }
      inStack.delete(id);
      return false;
    };
    for (const task of plan.tasks) {
      if (hasCycle(task.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `blockedBy graph contains a cycle involving task ${task.id}`,
        });
        break;
      }
    }
  });

export type Plan = z.infer<typeof PlanSchema>;

// ============================================================
// Validator
// ============================================================

const ValidatorPassSchema = z.object({
  pass: z.literal(true),
  summary_path: z.string(),
  acceptance_commands_run: z.array(z.string()).default([]),
  acceptance_commands_unrun: z.array(z.string()).default([]),
});

const ValidatorFailSchema = z.object({
  pass: z.literal(false),
  failed_step: z.string(),
  first_error_loc: z.string(),
  summary_path: z.string(),
  acceptance_commands_run: z.array(z.string()).default([]),
  acceptance_commands_unrun: z.array(z.string()).default([]),
});

export const ValidatorResultSchema = z.discriminatedUnion('pass', [
  ValidatorPassSchema,
  ValidatorFailSchema,
]);

export type ValidatorResult = z.infer<typeof ValidatorResultSchema>;

// ============================================================
// Generic role summary (worker, test-writer, spec-writer)
// ============================================================

export const RoleSummarySchema = z.object({
  status: z.enum(['ok', 'blocked', 'context_exhausted', 'failed']),
  summary_path: z.string(),
  notes: z.string().optional(),
  files_touched: z.array(z.string()).default([]),
});

export type RoleSummary = z.infer<typeof RoleSummarySchema>;

// ============================================================
// Planner (covers initial planning AND task-splitter mode — v0.2 merged
// task-splitter into planner since it's the same role at two times)
// ============================================================

const InitialPlannerResultSchema = z.object({
  status: z.enum(['ok', 'blocked', 'context_exhausted', 'failed']),
  mode: z.literal('initial'),
  plan_path: z.string(),
  task_count: z.number().int().positive(),
  summary_path: z.string(),
  notes: z.string().optional(),
});

const SplitPlannerResultSchema = z.object({
  status: z.enum(['ok', 'blocked', 'context_exhausted', 'failed']),
  mode: z.literal('split'),
  removed_task_id: z.string(),
  added_task_ids: z.array(z.string()).min(2),
  plan_path: z.string(),
  summary_path: z.string(),
  notes: z.string().optional(),
});

export const PlannerResultSchema = z.discriminatedUnion('mode', [
  InitialPlannerResultSchema,
  SplitPlannerResultSchema,
]);

export type PlannerResult = z.infer<typeof PlannerResultSchema>;

// ============================================================
// Critic — v0.3 adds `delta` mode for staleness analysis on /conductor
// resume. Spec/diff modes preserved verbatim from v0.2.
// ============================================================

const CriticSpecOrDiffSchema = z.object({
  verdict: z.enum(['ship', 'revise']),
  mode: z.enum(['spec', 'diff']),
  concerns: z.array(z.string()).default([]),
  summary_path: z.string(),
});

const DeltaChangeSchema = z.object({
  // Affected task id from plan.json, or `"<frontmatter>"` / `"<context>"` etc.
  // for ADR-level changes that don't map to a single task.
  target: z.string(),
  description: z.string(),
});

const CriticDeltaSchema = z
  .object({
    mode: z.literal('delta'),
    severity: z.enum(['minor', 'major', 'breaking']),
    additions: z.array(DeltaChangeSchema).default([]),
    modifications: z.array(DeltaChangeSchema).default([]),
    removals: z.array(DeltaChangeSchema).default([]),
    // One of: "patch_forward" (only safe when modifications and removals are
    // empty AND every addition targets an unstarted task), "rebootstrap"
    // (forced when any modification or removal touches completed work, or
    // when severity is "breaking"), "abort".
    recommendation: z.enum(['patch_forward', 'rebootstrap', 'abort']),
    summary_path: z.string(),
  })
  .superRefine((r, ctx) => {
    const touchesNonAdditions = r.modifications.length > 0 || r.removals.length > 0;
    if (r.recommendation === 'patch_forward' && touchesNonAdditions) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'patch_forward is illegal when modifications or removals are non-empty: rebootstrap is required (or open an amendment ADR)',
      });
    }
    if (r.recommendation === 'patch_forward' && r.severity === 'breaking') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'patch_forward is illegal when severity=breaking: rebootstrap is required',
      });
    }
  });

// v0.4: proposal mode for ratification-proposal review. Phase 0, after
// ratifier produces the proposal, before user approval. Only fires when
// triage_depth=full — when light, there are no falsifier/risk obligations
// to verify. The schema enforces verdict-vs-coverage consistency; the
// orchestrator separately enforces array-length equality with the upstream
// falsifier and direction-mode premortem outputs (lengths invisible to the
// schema).
const FalsifierCoverageEntrySchema = z.object({
  // Index into the upstream falsifier dispatch's `claims` array.
  claim_index: z.number().int().nonnegative(),
  addressed: z.boolean(),
  // Section heading or anchor where the claim is engaged in the proposal
  // (e.g. "Consequences › Negative" or "Alternatives considered"). Optional
  // because verdict=revise legitimately may have addressed=false entries.
  where: z.string().optional(),
});

const DirectionRiskCoverageEntrySchema = z.object({
  // Index into the upstream direction-mode premortem's `risks` array.
  risk_index: z.number().int().nonnegative(),
  addressed: z.boolean(),
  where: z.string().optional(),
});

const CriticProposalSchema = z
  .object({
    mode: z.literal('proposal'),
    verdict: z.enum(['ship', 'revise']),
    falsifier_coverage: z.array(FalsifierCoverageEntrySchema),
    direction_risk_coverage: z.array(DirectionRiskCoverageEntrySchema),
    // Free-form fallthrough for non-coverage issues (e.g. proposal contradicts
    // a cross-referenced ADR, or "deferred decisions disguised as decisions").
    concerns: z.array(z.string()).default([]),
    summary_path: z.string(),
  })
  .superRefine((r, ctx) => {
    if (r.verdict === 'ship') {
      const unaddressedFalsifiers = r.falsifier_coverage
        .filter((c) => !c.addressed)
        .map((c) => c.claim_index);
      const unaddressedRisks = r.direction_risk_coverage
        .filter((c) => !c.addressed)
        .map((c) => c.risk_index);
      if (unaddressedFalsifiers.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `verdict=ship is incompatible with unaddressed falsifier_coverage entries [${unaddressedFalsifiers.join(', ')}]: every claim must be engaged in the proposal before ratification`,
        });
      }
      if (unaddressedRisks.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `verdict=ship is incompatible with unaddressed direction_risk_coverage entries [${unaddressedRisks.join(', ')}]: every direction-level risk must be addressed in the proposal before ratification`,
        });
      }
    }
  });

export const CriticResultSchema = z.union([
  CriticSpecOrDiffSchema,
  CriticDeltaSchema,
  CriticProposalSchema,
]);

export type CriticResult = z.infer<typeof CriticResultSchema>;

// ============================================================
// Scope-judge — gates ship-readiness against acceptance criteria AND
// the spec's acceptance_commands. ship_ready=true is rejected by schema
// if any acceptance criterion or command is unmet.
// ============================================================

const MissingCriterionSchema = z.object({
  criterion: z.string(),
  reason: z.string(),
});

export const ScopeJudgeResultSchema = z
  .object({
    ship_ready: z.boolean(),
    missing: z.array(MissingCriterionSchema).default([]),
    acceptance_commands_run: z.array(z.string()).default([]),
    acceptance_commands_unrun: z.array(z.string()).default([]),
    summary_path: z.string(),
  })
  .superRefine((r, ctx) => {
    if (r.ship_ready && r.missing.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'ship_ready=true is incompatible with non-empty missing[]: every acceptance criterion must be satisfied',
      });
    }
    if (r.ship_ready && r.acceptance_commands_unrun.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'ship_ready=true is incompatible with non-empty acceptance_commands_unrun[]: every acceptance command must run and pass',
      });
    }
  });

export type ScopeJudgeResult = z.infer<typeof ScopeJudgeResultSchema>;

// ============================================================
// Premortem — v0.3 adds `mode: "direction"` so premortem can run against
// the ADR Direction itself (Phase 0, before ratification) in addition to
// the original `mode: "task"` (Phase 1, post-ratification, per-task).
// ============================================================

const RiskSchema = z.object({
  trigger: z.string(),
  blast_radius: z.enum(['money', 'pii', 'auth', 'audit', 'availability']),
  mitigation: z.string(),
});

export const PremortemResultSchema = z.object({
  mode: z.enum(['task', 'direction']).default('task'),
  risks: z.array(RiskSchema),
  summary_path: z.string(),
});

export type PremortemResult = z.infer<typeof PremortemResultSchema>;

// ============================================================
// Ratifier — v0.3 adds content_signature, the canonical hash of the proposed
// ADR text (per canonical-hash.ts). Orchestrator copies this into
// status.input_hashes[adr_path] when the user accepts the proposal, and into
// the live ADR's frontmatter (`content_signature: <hash[:12]>`) so the user
// has a visible artifact.
// ============================================================

export const RatifierResultSchema = z.object({
  status: z.enum(['ok', 'blocked']),
  proposal_path: z.string(),
  summary_path: z.string(),
  open_questions_count: z.number().int().nonnegative(),
  // sha256 hex of the proposed ADR's canonical text. May be omitted on
  // status: "blocked" when no proposal text exists yet.
  content_signature: z.string().optional(),
  notes: z.string().optional(),
});

export type RatifierResult = z.infer<typeof RatifierResultSchema>;

// ============================================================
// Triage (v0.3) — Phase 0 depth classifier. Cheap single dispatch right after
// spec-writer (or immediately on Phase 0 entry if the spec exists). Decides
// whether the ratifier runs alone (`light`, today's behavior) or whether
// falsifier + direction-mode premortem fan out before ratification (`full`).
// ============================================================

export const TriageResultSchema = z.object({
  depth: z.enum(['light', 'full']),
  rationale: z.string(),
  // Auditable signals that drove the depth verdict (e.g. cross_adr_refs >= 3,
  // money_keyword_present, no_alternatives_listed). Stored so the user can
  // sanity-check the triage decision.
  signals: z.array(z.string()).default([]),
  summary_path: z.string(),
});

export type TriageResult = z.infer<typeof TriageResultSchema>;

// ============================================================
// Falsifier (v0.3) — Phase 0 (only when triage_depth=full). For each
// commitment in the ADR's Direction, produce one falsifiable claim — a
// statement that, if true, would invalidate the Direction. Replaces the
// generic "alternatives generator" from the v0.3 draft: alternatives ARE
// the falsifier's "if X were true, Y would be the better choice" outputs.
// Forces the ratifier to address each falsifier by name in Consequences,
// rather than dismissing it.
// ============================================================

const FalsifierClaimSchema = z.object({
  // The Direction-level commitment this claim attacks. Quote or paraphrase.
  commitment: z.string(),
  // What would have to be true for the commitment to be wrong, and why.
  falsifier: z.string(),
  // Either a path to evidence (KB topic, prior ADR, external source captured
  // to a file) or the literal sentinel "unanswered" if no evidence exists yet
  // — that signals the ratifier (and user) that this is an open empirical
  // bet, not a settled question.
  evidence_path: z.union([z.string(), z.literal('unanswered')]),
});

export const FalsifierResultSchema = z.object({
  status: z.enum(['ok', 'blocked']),
  claims: z.array(FalsifierClaimSchema).min(1),
  summary_path: z.string(),
});

export type FalsifierResult = z.infer<typeof FalsifierResultSchema>;

// ============================================================
// Journalist (covers journal entry AND KB curation — v0.2 merged
// knowledge-curator since they're the same role with two output paths)
// ============================================================

export const JournalistResultSchema = z.object({
  status: z.enum(['ok', 'blocked', 'context_exhausted', 'failed']),
  entry_path: z.string(),
  topics_modified: z.array(z.string()).default([]),
  topics_created: z.array(z.string()).default([]),
  summary_path: z.string(),
});

export type JournalistResult = z.infer<typeof JournalistResultSchema>;

// ============================================================
// Shipper
// ============================================================

export const ShipperResultSchema = z.object({
  status: z.enum(['ok', 'blocked']),
  commit_sha: z.string().optional(),
  pr_url: z.string().url().optional(),
  summary_path: z.string(),
  notes: z.string().optional(),
});

export type ShipperResult = z.infer<typeof ShipperResultSchema>;

// ============================================================
// Retrospective
// ============================================================

export const RetrospectiveResultSchema = z.object({
  status: z.enum(['ok', 'failed']),
  proposal_path: z.string(),
  patterns_found: z.number().int().nonnegative(),
  diffs_proposed: z.number().int().nonnegative(),
  summary_path: z.string(),
});

export type RetrospectiveResult = z.infer<typeof RetrospectiveResultSchema>;

// ============================================================
// Dispatch envelope (v0.3). Every dispatch result lands in
// `.conductor/<N>/dispatches/<role>-<n>.json` wrapped in this envelope. The
// orchestrator stamps `input_signature` from `status.input_hashes` at dispatch
// time. When the result returns, the orchestrator compares the envelope's
// signature against the live status — mismatch means the input drifted while
// the dispatch was in flight, so the result is rejected as stale and the
// orchestrator surfaces the staleness condition. Without this, hash-checking
// only at /conductor resume is paper armor: a long-running background worker
// could complete against an old ADR while the user amended it mid-run.
// ============================================================

export const DispatchEnvelopeSchema = z.object({
  role: z.string(),
  // ISO 8601 timestamp of dispatch (orchestrator-stamped, not agent-supplied).
  dispatched_at: z.string().datetime(),
  // sha256 hex of the canonical ADR text observed at dispatch time. The
  // validator rejects the result if this does not match status.input_hashes
  // for the ADR path.
  input_signature: z.string(),
  // The role's own structured return value. Type-erased here; the orchestrator
  // parses it against SCHEMA_BY_ROLE[role] after the envelope check passes.
  result: z.unknown(),
});

export type DispatchEnvelope = z.infer<typeof DispatchEnvelopeSchema>;

// ============================================================
// Schema-by-name lookup (used by validate-skill.ts to verify each
// template's embedded JSON example parses against its named schema).
// v0.3: 14 roles after adding triage and falsifier.
// ============================================================

export const SCHEMA_BY_ROLE = {
  worker: RoleSummarySchema,
  'test-writer': RoleSummarySchema,
  'spec-writer': RoleSummarySchema,
  validator: ValidatorResultSchema,
  planner: PlannerResultSchema,
  critic: CriticResultSchema,
  'scope-judge': ScopeJudgeResultSchema,
  premortem: PremortemResultSchema,
  ratifier: RatifierResultSchema,
  triage: TriageResultSchema,
  falsifier: FalsifierResultSchema,
  journalist: JournalistResultSchema,
  shipper: ShipperResultSchema,
  retrospective: RetrospectiveResultSchema,
} as const;

export type RoleName = keyof typeof SCHEMA_BY_ROLE;
