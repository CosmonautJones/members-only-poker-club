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
// Critic
// ============================================================

export const CriticResultSchema = z.object({
  verdict: z.enum(['ship', 'revise']),
  mode: z.enum(['spec', 'diff']),
  concerns: z.array(z.string()).default([]),
  summary_path: z.string(),
});

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
// Premortem
// ============================================================

const RiskSchema = z.object({
  trigger: z.string(),
  blast_radius: z.enum(['money', 'pii', 'auth', 'audit', 'availability']),
  mitigation: z.string(),
});

export const PremortemResultSchema = z.object({
  risks: z.array(RiskSchema),
  summary_path: z.string(),
});

export type PremortemResult = z.infer<typeof PremortemResultSchema>;

// ============================================================
// Ratifier
// ============================================================

export const RatifierResultSchema = z.object({
  status: z.enum(['ok', 'blocked']),
  proposal_path: z.string(),
  summary_path: z.string(),
  open_questions_count: z.number().int().nonnegative(),
  notes: z.string().optional(),
});

export type RatifierResult = z.infer<typeof RatifierResultSchema>;

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
// Schema-by-name lookup (used by validate-skill.ts to verify each
// template's embedded JSON example parses against its named schema).
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
  journalist: JournalistResultSchema,
  shipper: ShipperResultSchema,
  retrospective: RetrospectiveResultSchema,
} as const;

export type RoleName = keyof typeof SCHEMA_BY_ROLE;
