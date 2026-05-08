import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  StatusSchema,
  PlanSchema,
  ValidatorResultSchema,
  RoleSummarySchema,
  PlannerResultSchema,
  CriticResultSchema,
  ScopeJudgeResultSchema,
  PremortemResultSchema,
  RatifierResultSchema,
  JournalistResultSchema,
  ShipperResultSchema,
  RetrospectiveResultSchema,
  SCHEMA_BY_ROLE,
} from './schemas';

const fx = (name: string) => JSON.parse(readFileSync(resolve(__dirname, 'fixtures', name), 'utf8'));

describe('StatusSchema', () => {
  it('parses a valid status', () => {
    expect(() => StatusSchema.parse(fx('status.valid.json'))).not.toThrow();
  });
  it('rejects status missing `phase`', () => {
    expect(() => StatusSchema.parse(fx('status.invalid-missing-phase.json'))).toThrow();
  });
  it('defaults task_iters/splits/acceptance_commands when omitted', () => {
    const parsed = StatusSchema.parse(fx('status.valid.json'));
    expect(parsed.task_iters).toEqual({});
    expect(parsed.splits).toEqual({});
    expect(parsed.acceptance_commands_required).toEqual([]);
    expect(parsed.acceptance_commands_run).toEqual([]);
  });
});

describe('PlanSchema', () => {
  it('parses a valid plan', () => {
    expect(() => PlanSchema.parse(fx('plan.valid.json'))).not.toThrow();
  });
  it('rejects a plan whose blockedBy points at a non-existent task', () => {
    const bad = { ...fx('plan.valid.json') };
    bad.tasks = [{ id: 't1', title: 'x', blockedBy: ['does-not-exist'], risk: 'low' }];
    expect(() => PlanSchema.parse(bad)).toThrow();
  });
  it('rejects a plan with a blockedBy cycle', () => {
    const cyclic = {
      spec_path: 'docs/specs/x.md',
      tasks: [
        { id: 'a', title: 'A', blockedBy: ['b'], risk: 'low' },
        { id: 'b', title: 'B', blockedBy: ['a'], risk: 'low' },
      ],
    };
    expect(() => PlanSchema.parse(cyclic)).toThrow();
  });
});

describe('ValidatorResultSchema', () => {
  it('parses a valid validator result', () => {
    expect(() => ValidatorResultSchema.parse(fx('validator-result.valid.json'))).not.toThrow();
  });
  it('requires failure fields when pass=false', () => {
    expect(() => ValidatorResultSchema.parse({ pass: false })).toThrow();
  });
  it('parses a pass=true result with default acceptance arrays', () => {
    const parsed = ValidatorResultSchema.parse({
      pass: true,
      summary_path: '.conductor/0011/dispatches/0019-validator.md',
    });
    expect(parsed.pass).toBe(true);
    if (parsed.pass) {
      expect(parsed.acceptance_commands_run).toEqual([]);
      expect(parsed.acceptance_commands_unrun).toEqual([]);
    }
  });
});

describe('RoleSummarySchema', () => {
  it('parses a valid summary', () => {
    expect(() =>
      RoleSummarySchema.parse({
        status: 'ok',
        summary_path: '.conductor/0011/dispatches/0007-worker.md',
        files_touched: ['src/lib/time-bank.ts'],
      }),
    ).not.toThrow();
  });
  it('requires a summary_path', () => {
    expect(() => RoleSummarySchema.parse({ status: 'ok' })).toThrow();
  });
});

describe('PlannerResultSchema', () => {
  it('parses initial mode', () => {
    expect(() =>
      PlannerResultSchema.parse({
        status: 'ok',
        mode: 'initial',
        plan_path: '.conductor/0011/plan.json',
        task_count: 5,
        summary_path: '.conductor/0011/dispatches/0003-planner.md',
      }),
    ).not.toThrow();
  });
  it('parses split mode', () => {
    expect(() =>
      PlannerResultSchema.parse({
        status: 'ok',
        mode: 'split',
        removed_task_id: 't3',
        added_task_ids: ['t3a', 't3b'],
        plan_path: '.conductor/0011/plan.json',
        summary_path: '.conductor/0011/dispatches/0021-planner.md',
      }),
    ).not.toThrow();
  });
  it('rejects split mode with only one added_task_id', () => {
    expect(() =>
      PlannerResultSchema.parse({
        status: 'ok',
        mode: 'split',
        removed_task_id: 't3',
        added_task_ids: ['t3a'],
        plan_path: '.conductor/0011/plan.json',
        summary_path: '.conductor/0011/dispatches/0021-planner.md',
      }),
    ).toThrow();
  });
});

describe('CriticResultSchema', () => {
  it('parses ship verdict', () => {
    expect(() =>
      CriticResultSchema.parse({
        verdict: 'ship',
        mode: 'diff',
        concerns: [],
        summary_path: '.conductor/0011/dispatches/0030-critic.md',
      }),
    ).not.toThrow();
  });
  it('parses revise verdict with concerns', () => {
    expect(() =>
      CriticResultSchema.parse({
        verdict: 'revise',
        mode: 'spec',
        concerns: ['acceptance criterion 3 is ambiguous'],
        summary_path: '.conductor/0011/dispatches/0002-critic.md',
      }),
    ).not.toThrow();
  });
  it('rejects unknown verdict', () => {
    expect(() =>
      CriticResultSchema.parse({
        verdict: 'approve',
        mode: 'diff',
        summary_path: '.conductor/0011/dispatches/0030-critic.md',
      }),
    ).toThrow();
  });
});

describe('ScopeJudgeResultSchema', () => {
  it('parses ship_ready=true with empty missing/unrun', () => {
    expect(() =>
      ScopeJudgeResultSchema.parse({
        ship_ready: true,
        missing: [],
        acceptance_commands_run: ['pnpm test:e2e:auth'],
        acceptance_commands_unrun: [],
        summary_path: '.conductor/0011/dispatches/0035-scope-judge.md',
      }),
    ).not.toThrow();
  });
  it('rejects ship_ready=true when missing[] is non-empty', () => {
    expect(() =>
      ScopeJudgeResultSchema.parse({
        ship_ready: true,
        missing: [{ criterion: 'rate-limit on signup', reason: 'no test covers this' }],
        summary_path: '.conductor/0011/dispatches/0035-scope-judge.md',
      }),
    ).toThrow();
  });
  it('rejects ship_ready=true when acceptance_commands_unrun is non-empty', () => {
    expect(() =>
      ScopeJudgeResultSchema.parse({
        ship_ready: true,
        missing: [],
        acceptance_commands_run: [],
        acceptance_commands_unrun: ['pnpm test:e2e:auth'],
        summary_path: '.conductor/0011/dispatches/0035-scope-judge.md',
      }),
    ).toThrow();
  });
  it('allows ship_ready=false with both populated', () => {
    expect(() =>
      ScopeJudgeResultSchema.parse({
        ship_ready: false,
        missing: [{ criterion: 'X', reason: 'Y' }],
        acceptance_commands_unrun: ['pnpm test:e2e:auth'],
        summary_path: '.conductor/0011/dispatches/0035-scope-judge.md',
      }),
    ).not.toThrow();
  });
});

describe('PremortemResultSchema', () => {
  it('parses a valid premortem result', () => {
    expect(() =>
      PremortemResultSchema.parse({
        risks: [
          {
            trigger: 'concurrent deposit on the same time-bank',
            blast_radius: 'money',
            mitigation: 'wrap in SELECT FOR UPDATE',
          },
        ],
        summary_path: '.conductor/0011/dispatches/0004-premortem.md',
      }),
    ).not.toThrow();
  });
  it('rejects unknown blast_radius', () => {
    expect(() =>
      PremortemResultSchema.parse({
        risks: [{ trigger: 'x', blast_radius: 'reputational', mitigation: 'y' }],
        summary_path: '.conductor/0011/dispatches/0004-premortem.md',
      }),
    ).toThrow();
  });
});

describe('RatifierResultSchema', () => {
  it('parses an ok ratifier result', () => {
    expect(() =>
      RatifierResultSchema.parse({
        status: 'ok',
        proposal_path: '.conductor/0030/ratification-proposal.md',
        summary_path: '.conductor/0030/dispatches/0001-ratifier.md',
        open_questions_count: 2,
      }),
    ).not.toThrow();
  });
});

describe('JournalistResultSchema', () => {
  it('parses an entry with KB topic deltas', () => {
    expect(() =>
      JournalistResultSchema.parse({
        status: 'ok',
        entry_path: 'docs/journal/2026-05-08-01-time-bank.md',
        topics_modified: ['rls.md', 'money-handling.md'],
        topics_created: [],
        summary_path: '.conductor/0011/dispatches/0050-journalist.md',
      }),
    ).not.toThrow();
  });
});

describe('ShipperResultSchema', () => {
  it('parses an ok shipper result with PR url', () => {
    expect(() =>
      ShipperResultSchema.parse({
        status: 'ok',
        commit_sha: 'abc1234',
        pr_url: 'https://github.com/owner/repo/pull/42',
        summary_path: '.conductor/0011/dispatches/0060-shipper.md',
      }),
    ).not.toThrow();
  });
  it('parses a blocked shipper result with no commit', () => {
    expect(() =>
      ShipperResultSchema.parse({
        status: 'blocked',
        summary_path: '.conductor/0011/dispatches/0060-shipper.md',
        notes: 'remote rejected: branch protection',
      }),
    ).not.toThrow();
  });
});

describe('RetrospectiveResultSchema', () => {
  it('parses an ok retrospective result', () => {
    expect(() =>
      RetrospectiveResultSchema.parse({
        status: 'ok',
        proposal_path: '.conductor/0011/skill-diff-proposal.md',
        patterns_found: 2,
        diffs_proposed: 1,
        summary_path: '.conductor/0011/dispatches/0070-retrospective.md',
      }),
    ).not.toThrow();
  });
});

describe('SCHEMA_BY_ROLE registry', () => {
  it('exposes a schema for each non-merged role', () => {
    const roles = Object.keys(SCHEMA_BY_ROLE);
    // 12 roles after the v0.2 merges (planner+task-splitter, journalist+kb-curator).
    expect(roles).toHaveLength(12);
    expect(roles).toContain('worker');
    expect(roles).toContain('planner');
    expect(roles).toContain('scope-judge');
    expect(roles).not.toContain('task-splitter'); // merged into planner
    expect(roles).not.toContain('knowledge-curator'); // merged into journalist
  });
});
