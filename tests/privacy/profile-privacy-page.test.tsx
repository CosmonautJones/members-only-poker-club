/**
 * Tests for app/(member)/profile/privacy/page.tsx — ADR-0023 AC8.
 *
 * Sub-cases:
 *   1. Renders both buttons with documented labels.
 *   2. Clicking "Delete my account" opens the AlertDialog (getByRole('alertdialog')).
 *   3. Initial focus inside the dialog lands on the Cancel button.
 *   4. Clicking Cancel closes the dialog without firing fetch.
 *   5. Clicking the destructive Action fires fetch('/api/privacy/delete', { method: 'POST' }).
 *   6. On mocked-200 export response: URL.createObjectURL called with Blob;
 *      URL.revokeObjectURL called afterwards.
 *   7. On mocked-500 export response: inline role="alert" error message rendered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock next/link — happy-dom doesn't have Next.js router context.
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// Mock window.location.assign for the redirect-after-delete behavior.
const mockLocationAssign = vi.fn();
Object.defineProperty(window, 'location', {
  value: { ...window.location, assign: mockLocationAssign },
  writable: true,
});

// Mock URL.createObjectURL and URL.revokeObjectURL for blob download test.
const mockCreateObjectURL = vi.fn(() => 'blob:mock-url');
const mockRevokeObjectURL = vi.fn();
Object.defineProperty(URL, 'createObjectURL', { value: mockCreateObjectURL, writable: true });
Object.defineProperty(URL, 'revokeObjectURL', { value: mockRevokeObjectURL, writable: true });

// Mock fetch.
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import ProfilePrivacyPage from '@/app/(member)/profile/privacy/page';

beforeEach(() => {
  vi.resetAllMocks();
  mockLocationAssign.mockReset();
  mockCreateObjectURL.mockReturnValue('blob:mock-url');
  mockRevokeObjectURL.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProfilePrivacyPage', () => {
  it('renders both action buttons', () => {
    render(<ProfilePrivacyPage />);
    expect(screen.getByRole('button', { name: /download my data/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /delete my account/i })).toBeTruthy();
  });

  it('clicking "Delete my account" opens the AlertDialog', async () => {
    render(<ProfilePrivacyPage />);

    const deleteButton = screen.getByRole('button', { name: /delete my account/i });
    await userEvent.click(deleteButton);

    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toBeTruthy();
  });

  it('AlertDialog has the correct title and description text', async () => {
    render(<ProfilePrivacyPage />);

    const deleteButton = screen.getByRole('button', { name: /delete my account/i });
    await userEvent.click(deleteButton);

    await screen.findByRole('alertdialog');
    expect(screen.getByText(/delete your account\?/i)).toBeTruthy();
    expect(screen.getByText(/this anonymizes your name/i)).toBeTruthy();
  });

  it('initial focus inside AlertDialog lands on Cancel button', async () => {
    render(<ProfilePrivacyPage />);

    const deleteButton = screen.getByRole('button', { name: /delete my account/i });
    await userEvent.click(deleteButton);

    await screen.findByRole('alertdialog');

    // Wait for focus to settle on the Cancel button.
    await waitFor(() => {
      const cancelButton = screen.getByRole('button', { name: /^cancel$/i });
      expect(document.activeElement).toBe(cancelButton);
    });
  });

  it('clicking Cancel closes the dialog without firing fetch', async () => {
    render(<ProfilePrivacyPage />);

    // Open dialog.
    const deleteButton = screen.getByRole('button', { name: /delete my account/i });
    await userEvent.click(deleteButton);
    await screen.findByRole('alertdialog');

    // Click Cancel.
    const cancelButton = screen.getByRole('button', { name: /^cancel$/i });
    await userEvent.click(cancelButton);

    // Dialog should be gone.
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).toBeNull();
    });

    // fetch must not have been called.
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('clicking the destructive Action fires fetch /api/privacy/delete POST', async () => {
    // Mock a successful delete response.
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ ok: true, alreadyDeleted: false }),
    });

    render(<ProfilePrivacyPage />);

    // Open dialog.
    const deleteButton = screen.getByRole('button', { name: /delete my account/i });
    await userEvent.click(deleteButton);
    await screen.findByRole('alertdialog');

    // Find and click the destructive Action button inside the dialog.
    // There are two "Delete my account" buttons: the trigger (outside) and
    // the action button inside the dialog. Use getByRole within dialog.
    const dialog = screen.getByRole('alertdialog');
    const actionButton = dialog.querySelector('button[class*="red"]') as HTMLElement
      ?? screen.getAllByRole('button', { name: /delete my account/i }).find(
           (b) => b.closest('[role="alertdialog"]'),
         )!;

    await userEvent.click(actionButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/privacy/delete', { method: 'POST' });
    });
  });

  it('mocked-200 export: URL.createObjectURL called with Blob; revokeObjectURL called', async () => {
    const mockBlob = new Blob(['{"data": "export"}'], { type: 'application/json' });
    mockFetch.mockResolvedValueOnce({
      status: 200,
      ok: true,
      blob: async () => mockBlob,
    });

    render(<ProfilePrivacyPage />);

    const downloadButton = screen.getByRole('button', { name: /download my data/i });
    await userEvent.click(downloadButton);

    await waitFor(() => {
      expect(mockCreateObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    });
    await waitFor(() => {
      expect(mockRevokeObjectURL).toHaveBeenCalled();
    });
  });

  it('mocked-500 export: renders inline role="alert" error message', async () => {
    mockFetch.mockResolvedValueOnce({
      status: 500,
      ok: false,
    });

    render(<ProfilePrivacyPage />);

    const downloadButton = screen.getByRole('button', { name: /download my data/i });
    await userEvent.click(downloadButton);

    const errorAlert = await screen.findByRole('alert');
    expect(errorAlert).toBeTruthy();
    expect(errorAlert.textContent).toMatch(/export failed/i);
  });
});
