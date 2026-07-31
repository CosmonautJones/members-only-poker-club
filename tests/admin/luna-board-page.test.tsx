import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('@/lib/auth/requireRole', () => ({
  requireRole: mocks.requireRole,
}));

import LunaBoardPage from '@/app/(admin)/admin/luna/page';

beforeEach(() => {
  mocks.requireRole.mockReset();
  mocks.requireRole.mockResolvedValue({
    profile: {
      id: 'manager-id',
      role: 'manager',
      full_name: 'Manager',
      email: 'manager@example.com',
    },
  });
});

describe('Luna board page', () => {
  it('requires manager access and renders all five kanban lanes', async () => {
    render((await LunaBoardPage()) as React.ReactElement);

    expect(mocks.requireRole).toHaveBeenCalledWith('manager');
    expect(screen.getByRole('heading', { name: 'Ready' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Active' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Review' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Blocked' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Done' })).toBeTruthy();
  });

  it('renders assignments, dependencies, and acceptance criteria visibly', async () => {
    render((await LunaBoardPage()) as React.ReactElement);

    expect(screen.getByText('Repair and land rate-limit middleware')).toBeTruthy();
    expect(screen.getAllByText('Luna Release').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Definition of done').length).toBeGreaterThan(0);
    expect(screen.getAllByText('LUNA-002').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Human gate').length).toBeGreaterThan(0);
  });

  it('propagates role failures', async () => {
    mocks.requireRole.mockRejectedValueOnce(new Error('InsufficientRoleError'));
    await expect(LunaBoardPage()).rejects.toThrow('InsufficientRoleError');
  });
});
