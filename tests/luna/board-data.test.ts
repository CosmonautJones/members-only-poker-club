import { describe, expect, it } from 'vitest';

import board from '@/docs/luna/board.json';

const STATUSES = new Set(['ready', 'active', 'review', 'blocked', 'done']);
const PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);
const EXPECTED_IDS = Array.from(
  { length: 21 },
  (_, index) => `LUNA-${String(index).padStart(3, '0')}`,
);
const DONE_IDS = [
  'LUNA-000',
  'LUNA-001',
  'LUNA-002',
  'LUNA-003',
  'LUNA-006',
  'LUNA-007',
  'LUNA-008',
  'LUNA-009',
];
const UNRESOLVED_IDS = [
  'LUNA-004',
  'LUNA-005',
  'LUNA-010',
  'LUNA-011',
  'LUNA-012',
  'LUNA-013',
  'LUNA-014',
  'LUNA-015',
  'LUNA-016',
  'LUNA-017',
  'LUNA-018',
  'LUNA-019',
  'LUNA-020',
];

describe('Luna board data', () => {
  it('has unique ticket IDs and complete worker fields', () => {
    const ids = board.tickets.map((ticket) => ticket.id);

    expect(ids).toEqual(EXPECTED_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ticket of board.tickets) {
      expect(ticket.id).toMatch(/^LUNA-\d{3}$/);
      expect(ticket.title.length).toBeGreaterThan(0);
      expect(ticket.summary.length).toBeGreaterThan(0);
      expect(ticket.assignee).toMatch(/^Luna /);
      expect(ticket.agentRole.length).toBeGreaterThan(0);
      expect(ticket.nextAction.length).toBeGreaterThan(0);
      expect(ticket.acceptanceCriteria.length).toBeGreaterThan(0);
      expect(STATUSES.has(ticket.status)).toBe(true);
      expect(PRIORITIES.has(ticket.priority)).toBe(true);
      for (const evidence of ticket.evidence) {
        expect(evidence.label).not.toMatch(/Open PR/i);
        expect(evidence.href).toMatch(/^https:\/\/github\.com\/CosmonautJones\//);
      }
      if (['done', 'review'].includes(ticket.status)) {
        expect(
          ticket.evidence.length,
          `${ticket.id} must include completion evidence`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('records a current, attributable snapshot', () => {
    expect(board.snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(`${board.snapshotAt}T00:00:00Z`))).toBe(false);
    expect(board.sourceNote).toContain('9d7b2fd');
    expect(board.sourceNote).toContain('#57');
  });

  it('references only existing dependencies from the same or an earlier wave', () => {
    const byId = new Map(board.tickets.map((ticket) => [ticket.id, ticket]));

    for (const ticket of board.tickets) {
      for (const dependencyId of ticket.blockedBy) {
        const dependency = byId.get(dependencyId);
        expect(dependency, `${ticket.id} depends on missing ${dependencyId}`).toBeDefined();
        expect(dependency!.wave).toBeLessThanOrEqual(ticket.wave);
      }
    }
  });

  it('does not expose work as actionable before its dependencies are done', () => {
    const byId = new Map(board.tickets.map((ticket) => [ticket.id, ticket]));

    for (const ticket of board.tickets.filter((candidate) =>
      ['ready', 'active', 'review'].includes(candidate.status),
    )) {
      for (const dependencyId of ticket.blockedBy) {
        expect(byId.get(dependencyId)?.status, `${ticket.id} is waiting on ${dependencyId}`).toBe(
          'done',
        );
      }
    }
  });

  it('keeps every unfinished human gate visibly blocked', () => {
    for (const ticket of board.tickets.filter(
      (candidate) => candidate.humanGate && candidate.status !== 'done',
    )) {
      expect(ticket.status).toBe('blocked');
    }
  });

  it('matches the reconciled completed and unresolved ticket sets', () => {
    expect(
      board.tickets.filter((ticket) => ticket.status === 'done').map((ticket) => ticket.id),
    ).toEqual(DONE_IDS);
    expect(
      board.tickets.filter((ticket) => ticket.status === 'blocked').map((ticket) => ticket.id),
    ).toEqual(UNRESOLVED_IDS);

    for (const ticket of board.tickets) {
      if (UNRESOLVED_IDS.includes(ticket.id)) {
        expect(ticket.humanGate, `${ticket.id} must expose its human gate`).toBe(true);
      } else {
        expect(ticket.status, `${ticket.id} must be complete`).toBe('done');
      }
    }
  });
});
