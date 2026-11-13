/**
 * Defects found by clicking through the October 2026 build in a real Chrome, pinned here.
 *
 *   - Escape on a file preview opened over a review closed the review underneath, and left the
 *     preview up over nothing. Escape on a confirmation prompt closed the dialog under it too.
 *   - A download manager's browser extension (IDM) answers the page's PDF requests with an empty
 *     "204 No Content": the preview showed a blank frame and a download saved an empty file.
 *   - An expense decision refreshed the whole query cache five times over (TanStack Query v5 reads
 *     the old array form as "no filter"); with the API's rate limit that left the screen showing
 *     the expense as it was before the decision.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Modal from '../components/shared/Modal';
import ExpenseReview from '../components/finance/ExpenseReview';
import api, { FILE_INTERCEPTED_MESSAGE } from '../services/api';
import useAuthStore from '../store/authStore';
import { expenseService } from '../services/budgetService';
import { confirm } from '../utils/confirm';

vi.mock('../services/budgetService', () => ({
  expenseService: { getById: vi.fn(), attachment: vi.fn(), returnForCorrection: vi.fn() },
  budgetService: {},
  liquidationService: {},
}));
vi.mock('../utils/confirm', () => ({
  confirm: { rejectWithReason: vi.fn(), approve: vi.fn(), archive: vi.fn() },
  escapeHtml: (s) => s,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Stacked dialogs: the keyboard belongs to the one on top', () => {
  it('Escape closes the preview and leaves the review it was opened from', () => {
    const closeReview = vi.fn();
    const closePreview = vi.fn();
    render(
      <>
        <Modal isOpen onClose={closeReview} title="Review application">details</Modal>
        <Modal isOpen onClose={closePreview} title="residency.pdf">preview</Modal>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closePreview).toHaveBeenCalledTimes(1);
    expect(closeReview).not.toHaveBeenCalled();
  });

  it('hands Escape back to the review once the preview has closed', () => {
    const closeReview = vi.fn();
    const { rerender } = render(
      <>
        <Modal isOpen onClose={closeReview} title="Review application">details</Modal>
        <Modal isOpen onClose={() => {}} title="residency.pdf">preview</Modal>
      </>,
    );
    rerender(
      <>
        <Modal isOpen onClose={closeReview} title="Review application">details</Modal>
        <Modal isOpen={false} onClose={() => {}} title="residency.pdf">preview</Modal>
      </>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(closeReview).toHaveBeenCalledTimes(1);
  });

  it('leaves the dialog open when Escape is pressed on a confirmation prompt above it', () => {
    const closeReview = vi.fn();
    render(<Modal isOpen onClose={closeReview} title="Expense EXP-2026-00006">details</Modal>);
    const prompt = document.createElement('div');
    prompt.className = 'swal2-container';
    prompt.innerHTML = '<button type="button">Cancel</button>';
    document.body.appendChild(prompt);
    try {
      fireEvent.keyDown(prompt.querySelector('button'), { key: 'Escape' });
      expect(closeReview).not.toHaveBeenCalled();
    } finally {
      prompt.remove();
    }
  });
});

describe('A file the browser swallowed is reported, not shown blank', () => {
  const originalAdapter = api.defaults.adapter;
  const answer = (status, data) => {
    api.defaults.adapter = async (config) => ({ data, status, statusText: '', headers: {}, config, request: {} });
  };
  afterEach(() => { api.defaults.adapter = originalAdapter; });

  it('rejects a file request that came back as 204 No Content, saying why', async () => {
    answer(204, new Blob([]));
    await expect(api.get('/documents/d1/serve', { responseType: 'blob' }))
      .rejects.toMatchObject({ status: 204, message: FILE_INTERCEPTED_MESSAGE });
  });

  it('passes a delivered file through, and leaves a 204 on an ordinary request alone', async () => {
    answer(200, new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    const file = await api.get('/documents/d1/serve', { responseType: 'blob' });
    expect(file.status).toBe(200);

    answer(204, '');
    const ordinary = await api.delete('/notifications/n1');
    expect(ordinary.status).toBe(204);
  });
});

describe('An expense decision refreshes the cache once', () => {
  it('returns the expense for correction and invalidates once, not once per key', async () => {
    useAuthStore.setState({ user: { _id: 'admin', role: 'municipal_admin' }, isAuthenticated: true });
    expenseService.getById.mockResolvedValue({
      data: {
        data: {
          _id: 'e6', referenceNumber: 'EXP-2026-00006', title: 'Snacks and water', type: 'official_receipt', amount: 6500,
          transactionDate: '2026-10-18', status: 'pending', barangay: { name: 'Agot' }, municipality: { name: 'Boac' },
          createdBy: { _id: 'treasurer', firstName: 'Maria', lastName: 'Santos' },
          attachments: [{ _id: 'a1', originalName: 'OR-0441.pdf', fileType: 'application/pdf' }],
        },
      },
    });
    expenseService.returnForCorrection.mockResolvedValue({ data: { success: true } });
    confirm.rejectWithReason.mockResolvedValue({ isConfirmed: true, value: 'Attach the signed acknowledgment receipt.' });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(<QueryClientProvider client={client}><MemoryRouter><ExpenseReview expenseId="e6" onClose={() => {}} /></MemoryRouter></QueryClientProvider>);

    await userEvent.setup().click(await screen.findByRole('button', { name: 'Return for correction' }));

    await waitFor(() => expect(expenseService.returnForCorrection).toHaveBeenCalledWith('e6', 'Attach the signed acknowledgment receipt.'));
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    expect(invalidate.mock.calls[0]).toEqual([]);
  });
});
