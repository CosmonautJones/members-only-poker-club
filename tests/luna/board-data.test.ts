import { describe, expect, it } from 'vitest';

import board from '@/docs/luna/board.json';

const STATUSES = new Set(['ready', 'active', 'review', 'blocked', 'done']);
const PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);

describe('Luna board data', () => {
  it('has unique ticket IDs and complete worker fields', () => {
    const ids = board.tickets.map((ticket) => ticket.id);

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
        expect(evidence.href).toMatch(/^https:\/\/github\.com\/CosmonautJones\//);
      }
    }
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

  it('keeps human-gated unfinished work visibly blocked unless it is an investigation', () => {
    const allowedAgentWorkHumanGate = new Set(['LUNA-004', 'LUNA-005']);

    for (const ticket of board.tickets.filter(
      (candidate) => candidate.humanGate && candidate.status !== 'done',
    )) {
      expect(
        ticket.status === 'blocked' ||
          (['ready', 'active'].includes(ticket.status) && allowedAgentWorkHumanGate.has(ticket.id)),
      ).toBe(true);
    }
  });
});
