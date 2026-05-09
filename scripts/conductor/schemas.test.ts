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
  TriageResultSchema,
  FalsifierResultSchema,
  DispatchEnvelopeSchema,
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
  it('defaults input_hashes to empty record when omitted (v0.3 back-compat)', () => {
    const parsed = StatusSchema.parse(fx('status.valid.json'));
    expect(parsed.input_hashes).toEqual({});
    expect(parsed.triage_depth).toBeUndefined();
  });
  it('parses input_hashes and triage_depth when provided (v0.3)', () => {
    const parsed = StatusSchema.parse({
      ...fx('status.valid.json'),
      input_hashes: {
        'docs/adr/0099-x.md': 'a'.repeat(64),
        'docs/specs/0099-x.md': 'b'.repeat(64),
      },
      triage_depth: 'full',
    });
    expect(parsed.input_hashes['docs/adr/0099-x.md']).toBe('a'.repeat(64));
    expect(parsed.triage_depth).toBe('full');
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
  // v0.3 — delta mode for staleness detection on /conductor resume.
  it('parses delta mode with patch_forward when only additions targeting unstarted tasks', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'delta',
        severity: 'minor',
        additions: [{ target: 't7', description: 'new task: enforce idempotency' }],
        modifications: [],
        removals: [],
        recommendation: 'patch_forward',
        summary_path: '.conductor/0011/dispatches/0001-critic-delta.md',
      }),
    ).not.toThrow();
  });
  it('rejects delta patch_forward when modifications are non-empty', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'delta',
        severity: 'major',
        additions: [],
        modifications: [{ target: 't4', description: 'tightened criterion' }],
        removals: [],
        recommendation: 'patch_forward',
        summary_path: '.conductor/0011/dispatches/0001-critic-delta.md',
      }),
    ).toThrow();
  });
  it('rejects delta patch_forward when severity is breaking', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'delta',
        severity: 'breaking',
        additions: [{ target: 't9', description: 'new task' }],
        modifications: [],
        removals: [],
        recommendation: 'patch_forward',
        summary_path: '.conductor/0011/dispatches/0001-critic-delta.md',
      }),
    ).toThrow();
  });
  it('parses delta mode with rebootstrap when modifications touch completed work', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'delta',
        severity: 'breaking',
        additions: [],
        modifications: [{ target: 't4', description: 'completed task contract changed' }],
        removals: [],
        recommendation: 'rebootstrap',
        summary_path: '.conductor/0011/dispatches/0001-critic-delta.md',
      }),
    ).not.toThrow();
  });
  // v0.4 — proposal mode for ratification-proposal review (Phase 0, after
  // ratifier, before user approval, only when triage_depth=full).
  it('parses proposal mode with verdict=ship and all coverage addressed', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'proposal',
        verdict: 'ship',
        falsifier_coverage: [
          { claim_index: 0, addressed: true, where: 'Consequences › Negative' },
          { claim_index: 1, addressed: true, where: 'Alternatives considered' },
        ],
        direction_risk_coverage: [
          { risk_index: 0, addressed: true, where: 'Consequences › Negative' },
        ],
        concerns: [],
        summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
      }),
    ).not.toThrow();
  });
  it('parses proposal mode with verdict=revise and unaddressed coverage entries', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'proposal',
        verdict: 'revise',
        falsifier_coverage: [
          { claim_index: 0, addressed: true, where: 'Consequences › Negative' },
          { claim_index: 1, addressed: false },
        ],
        direction_risk_coverage: [{ risk_index: 0, addressed: false }],
        concerns: ['falsifier-2 silently dropped from Consequences'],
        summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
      }),
    ).not.toThrow();
  });
  it('rejects verdict=ship when a falsifier_coverage entry is unaddressed', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'proposal',
        verdict: 'ship',
        falsifier_coverage: [
          { claim_index: 0, addressed: true, where: 'Consequences › Negative' },
          { claim_index: 1, addressed: false },
        ],
        direction_risk_coverage: [
          { risk_index: 0, addressed: true, where: 'Consequences › Negative' },
        ],
        concerns: [],
        summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
      }),
    ).toThrow();
  });
  it('rejects verdict=ship when a direction_risk_coverage entry is unaddressed', () => {
    expect(() =>
      CriticResultSchema.parse({
        mode: 'proposal',
        verdict: 'ship',
        falsifier_coverage: [
          { claim_index: 0, addressed: true, where: 'Consequences › Negative' },
        ],
        direction_risk_coverage: [{ risk_index: 0, addressed: false }],
        concerns: [],
        summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
      }),
    ).toThrow();
  });
  it('parses proposal mode with empty coverage arrays (light-path edge case)', () => {
    // triage_depth=light should never reach proposal-mode critic, but the
    // schema must not reject empty coverage arrays — that path is guarded by
    // orchestrator policy, not schema.
    expect(() =>
      CriticResultSchema.parse({
        mode: 'proposal',
        verdict: 'ship',
        falsifier_coverage: [],
        direction_risk_coverage: [],
        concerns: [],
        summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
      }),
    ).not.toThrow();
  });
  it('defaults concerns to [] when omitted in proposal mode', () => {
    const parsed = CriticResultSchema.parse({
      mode: 'proposal',
      verdict: 'ship',
      falsifier_coverage: [{ claim_index: 0, addressed: true, where: 'Consequences' }],
      direction_risk_coverage: [{ risk_index: 0, addressed: true, where: 'Consequences' }],
      summary_path: '.conductor/0035/dispatches/0005-critic-proposal.md',
    });
    if ('mode' in parsed && parsed.mode === 'proposal') {
      expect(parsed.concerns).toEqual([]);
    } else {
      throw new Error('expected proposal mode parse');
    }
  });
  it('parses the canonical proposal-mode fixture', () => {
    expect(() => CriticResultSchema.parse(fx('critic-proposal.valid.json'))).not.toThrow();
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
  it('parses a valid premortem result (mode defaults to "task" for v0.2 back-compat)', () => {
    const parsed = PremortemResultSchema.parse({
      risks: [
        {
          trigger: 'concurrent deposit on the same time-bank',
          blast_radius: 'money',
          mitigation: 'wrap in SELECT FOR UPDATE',
        },
      ],
      summary_path: '.conductor/0011/dispatches/0004-premortem.md',
    });
    expect(parsed.mode).toBe('task');
  });
  it('parses direction mode (v0.3)', () => {
    expect(() =>
      PremortemResultSchema.parse({
        mode: 'direction',
        risks: [
          {
            trigger: 'Stripe sunsets the SCA endpoint we built against',
            blast_radius: 'money',
            mitigation: 'Direction should commit to a payment-vendor abstraction layer',
          },
        ],
        summary_path: '.conductor/0011/dispatches/0001-premortem-direction.md',
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
  it('parses content_signature when present (v0.3)', () => {
    const parsed = RatifierResultSchema.parse({
      status: 'ok',
      proposal_path: '.conductor/0030/ratification-proposal.md',
      summary_path: '.conductor/0030/dispatches/0001-ratifier.md',
      open_questions_count: 0,
      content_signature: 'PENDING',
    });
    expect(parsed.content_signature).toBe('PENDING');
  });
});

describe('TriageResultSchema (v0.3)', () => {
  it('parses light depth', () => {
    expect(() =>
      TriageResultSchema.parse({
        depth: 'light',
        rationale: 'No high-stakes signals fired; ratifier alone is sufficient.',
        signals: [],
        summary_path: '.conductor/0030/dispatches/0001-triage.md',
      }),
    ).not.toThrow();
  });
  it('parses full depth with signals', () => {
    expect(() =>
      TriageResultSchema.parse({
        depth: 'full',
        rationale: 'Money keyword fired; full debate required.',
        signals: ['money_keyword_present', 'external_vendor_present'],
        summary_path: '.conductor/0030/dispatches/0001-triage.md',
      }),
    ).not.toThrow();
  });
  it('rejects unknown depth', () => {
    expect(() =>
      TriageResultSchema.parse({
        depth: 'medium',
        rationale: 'x',
        signals: [],
        summary_path: 'x',
      }),
    ).toThrow();
  });
});

describe('FalsifierResultSchema (v0.3)', () => {
  it('parses claims with mixed evidence pointers', () => {
    expect(() =>
      FalsifierResultSchema.parse({
        status: 'ok',
        claims: [
          {
            commitment: 'Use Stripe for all member-facing payments',
            falsifier: 'If cross-border EUR settlement is ever required, Stripe is insufficient.',
            evidence_path: 'unanswered',
          },
          {
            commitment: 'Store all money as integer cents',
            falsifier: 'If sub-cent rake fees are ever introduced, integer-cents drops precision.',
            evidence_path: 'docs/kb/money-handling.md',
          },
        ],
        summary_path: '.conductor/0030/dispatches/0002-falsifier.md',
      }),
    ).not.toThrow();
  });
  it('rejects empty claims array', () => {
    expect(() =>
      FalsifierResultSchema.parse({
        status: 'ok',
        claims: [],
        summary_path: 'x',
      }),
    ).toThrow();
  });
});

describe('DispatchEnvelopeSchema (v0.3)', () => {
  it('parses an envelope with input_signature', () => {
    expect(() =>
      DispatchEnvelopeSchema.parse({
        role: 'worker',
        dispatched_at: '2026-05-09T12:00:00.000Z',
        input_signature: 'a'.repeat(64),
        result: { status: 'ok', summary_path: 'x' },
      }),
    ).not.toThrow();
  });
  it('rejects an envelope missing input_signature', () => {
    expect(() =>
      DispatchEnvelopeSchema.parse({
        role: 'worker',
        dispatched_at: '2026-05-09T12:00:00.000Z',
        result: { status: 'ok' },
      }),
    ).toThrow();
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
    // v0.3: 14 roles. v0.2 had 12 after merges (planner+task-splitter,
    // journalist+kb-curator); v0.3 adds triage and falsifier for the
    // pre-ratification debate.
    expect(roles).toHaveLength(14);
    expect(roles).toContain('worker');
    expect(roles).toContain('planner');
    expect(roles).toContain('scope-judge');
    expect(roles).toContain('triage');
    expect(roles).toContain('falsifier');
    expect(roles).not.toContain('task-splitter'); // merged into planner
    expect(roles).not.toContain('knowledge-curator'); // merged into journalist
  });
});
