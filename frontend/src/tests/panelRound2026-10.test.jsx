/**
 * Frontend half of the October 2026 panel round: the screens render the rules the server enforces.
 *
 *   - registration offers only the chosen municipality's barangays, disables seats already taken,
 *     and will not submit an SK application without identity / residency proof;
 *   - an announcement opens in full, and one issued by a higher office shows no Edit control;
 *   - the expense review withholds Approve while no proof is attached, and withholds every decision
 *     from the person who recorded the expense.
 *
 * Services are mocked: these assert what the page does with what the API returns. The API's own
 * enforcement is pinned by the backend suites (accountVerification, barangayRecords, barangayFinance).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Register from '../pages/auth/Register';
import Announcements from '../pages/announcements/Announcements';
import ExpenseReview from '../components/finance/ExpenseReview';
import useAuthStore from '../store/authStore';
import { municipalityService } from '../services/documentService';
import { authService } from '../services/authService';
import { announcementService } from '../services/announcementService';
import { expenseService } from '../services/budgetService';

// vi.mock is hoisted above the imports, so the pages above receive these stubs.
vi.mock('../services/documentService', () => ({
  municipalityService: { getAll: vi.fn(), getBarangays: vi.fn(), getAllBarangays: vi.fn() },
}));
vi.mock('../services/authService', () => ({ authService: { register: vi.fn() } }));
vi.mock('../services/announcementService', () => ({
  announcementService: { getAll: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  default: {},
}));
vi.mock('../services/budgetService', () => ({
  expenseService: { getById: vi.fn(), attachment: vi.fn() },
  budgetService: {},
  liquidationService: {},
}));

const mount = (ui) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Register: barangay follows municipality, seats, and proof (1.1, 1.2, 1.5)', () => {
  const BARANGAYS = {
    boac: [
      { _id: 'agot', name: 'Agot', seatStatus: 'filled' },
      { _id: 'maligaya', name: 'Maligaya', seatStatus: 'vacant' },
    ],
    mogpog: [{ _id: 'argao', name: 'Argao', seatStatus: 'pending' }],
  };

  beforeEach(() => {
    municipalityService.getAll.mockResolvedValue({ data: { data: [{ _id: 'boac', name: 'Boac' }, { _id: 'mogpog', name: 'Mogpog' }] } });
    municipalityService.getBarangays.mockImplementation((id) => Promise.resolve({ data: { data: BARANGAYS[id] || [] } }));
    authService.register.mockResolvedValue({ data: { success: true } });
  });

  it('lists only the chosen municipality\'s barangays and disables a taken seat', async () => {
    const user = userEvent.setup();
    mount(<Register />);
    await user.selectOptions(screen.getByLabelText('Role'), 'sk_chairperson');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Boac' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Municipality'), 'boac');

    await waitFor(() => expect(screen.getByRole('option', { name: 'Maligaya' })).toBeInTheDocument());
    expect(municipalityService.getBarangays).toHaveBeenCalledWith('boac', { role: 'sk_chairperson' });
    expect(screen.getByRole('option', { name: /Agot — SK Chairperson already registered/ })).toBeDisabled();
    expect(screen.getByRole('option', { name: 'Maligaya' })).not.toBeDisabled();
    expect(screen.queryByRole('option', { name: /Argao/ })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Municipality'), 'mogpog');
    await waitFor(() => expect(screen.getByRole('option', { name: /Argao — SK Chairperson awaiting approval/ })).toBeDisabled());
    expect(screen.queryByRole('option', { name: 'Maligaya' })).not.toBeInTheDocument();
  });

  it('will not submit an SK application without proof, and sends it as multipart with one', async () => {
    const user = userEvent.setup();
    const { container } = mount(<Register />);
    await user.selectOptions(screen.getByLabelText('Role'), 'sk_treasurer');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Boac' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Municipality'), 'boac');
    await waitFor(() => expect(screen.getByRole('option', { name: 'Maligaya' })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText('Barangay'), 'maligaya');
    await user.type(screen.getByLabelText('First Name'), 'Rosa');
    await user.type(screen.getByLabelText('Last Name'), 'Lim');
    await user.type(screen.getByLabelText('Email Address'), 'rosa@example.com');
    await user.type(screen.getByLabelText('Password'), 'Admin@123');
    await user.type(screen.getByLabelText('Confirm Password'), 'Admin@123');

    await user.click(screen.getByRole('button', { name: /Create Account/ }));
    expect(await screen.findByText(/Attach at least one: a valid government ID/)).toBeInTheDocument();
    expect(authService.register).not.toHaveBeenCalled();

    const file = new File(['%PDF-1.4'], 'barangay-certificate.pdf', { type: 'application/pdf' });
    await user.upload(container.querySelector('#verification-documents'), file);
    await user.selectOptions(screen.getByLabelText(/What is barangay-certificate.pdf/), 'proof_of_residency');
    await user.click(screen.getByRole('button', { name: /Create Account/ }));

    await waitFor(() => expect(authService.register).toHaveBeenCalledTimes(1));
    const body = authService.register.mock.calls[0][0];
    expect(body).toBeInstanceOf(FormData);
    expect(body.get('barangay')).toBe('maligaya');
    expect(body.get('role')).toBe('sk_treasurer');
    expect(body.getAll('documentTypes')).toEqual(['proof_of_residency']);
    expect(body.get('verificationDocuments').name).toBe('barangay-certificate.pdf');
  });

  it('no longer offers SK Kagawad, and offers SK Municipal Admin', () => {
    mount(<Register />);
    const roles = within(screen.getByLabelText('Role')).getAllByRole('option').map((o) => o.textContent);
    expect(roles).not.toContain('SK Kagawad');
    expect(roles).toContain('SK Municipal Admin');
  });
});

describe('Announcements: full view and ownership (2.1, 2.2)', () => {
  const LONG = 'Submit the Q3 compliance report by 15 November.\n\nLate submissions are flagged to the provincial office.';
  beforeEach(() => {
    useAuthStore.setState({ user: { _id: 'chair', role: 'sk_chairperson' }, isAuthenticated: true });
    announcementService.getAll.mockResolvedValue({
      data: {
        data: [
          {
            _id: 'a1', title: 'DILG Compliance Deadline Reminder', content: LONG, type: 'deadline', isPublic: true,
            issuingOffice: 'DILG Marinduque', author: { firstName: 'DILG', lastName: 'Officer', role: 'dilg_representative' },
            publishedAt: '2026-10-01T00:00:00Z', canEdit: false, canDelete: false,
          },
          {
            _id: 'a2', title: 'Agot clean-up', content: 'Saturday, 7 AM.', type: 'event', isPublic: true,
            issuingOffice: 'Sangguniang Kabataan — Barangay Agot, Boac', author: { firstName: 'Juan', lastName: 'dela Cruz', role: 'sk_chairperson' },
            publishedAt: '2026-10-02T00:00:00Z', canEdit: true, canDelete: false,
          },
        ],
        meta: { page: 1, limit: 10, total: 2, pages: 1 },
      },
    });
  });

  it('opens an announcement in full, with its issuing office, and keeps a DILG one read-only', async () => {
    const user = userEvent.setup();
    mount(<Announcements />);
    await user.click(await screen.findByRole('button', { name: 'Open announcement: DILG Compliance Deadline Reminder' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Late submissions are flagged to the provincial office/)).toBeInTheDocument();
    expect(within(dialog).getByText('DILG Marinduque')).toBeInTheDocument();
    expect(within(dialog).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(dialog).getByText(/can be changed only by the office that issued it/)).toBeInTheDocument();
  });

  it('shows Edit only on the announcement the server says this account may change', async () => {
    mount(<Announcements />);
    await screen.findByText('DILG Compliance Deadline Reminder');
    expect(screen.queryByRole('button', { name: 'Edit DILG Compliance Deadline Reminder' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit Agot clean-up' })).toBeInTheDocument();
    expect(screen.getByText('View only')).toBeInTheDocument();
  });
});

describe('Expense review: decide only on evidence, never on your own (7.4, 7.5)', () => {
  const EXPENSE = {
    _id: 'e1', referenceNumber: 'EXP-2026-00001', title: 'Banner printing', type: 'official_receipt', amount: 1800,
    transactionDate: '2026-10-25', status: 'pending', barangay: { name: 'Agot' }, municipality: { name: 'Boac' },
    budget: { title: 'Agot 2026', remainingBalance: 50000 }, createdBy: { _id: 'treasurer', firstName: 'Maria', lastName: 'Santos' },
  };

  it('withholds Approve while no proof is attached, but lets the reviewer return it', async () => {
    useAuthStore.setState({ user: { _id: 'admin', role: 'municipal_admin' }, isAuthenticated: true });
    expenseService.getById.mockResolvedValue({ data: { data: { ...EXPENSE, attachments: [] } } });
    mount(<ExpenseReview expenseId="e1" onClose={() => {}} />);
    expect(await screen.findByText(/No proof attached/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Return for correction' })).toBeEnabled();
  });

  it('lets the reviewer approve once proof is attached, and preview it first', async () => {
    useAuthStore.setState({ user: { _id: 'admin', role: 'municipal_admin' }, isAuthenticated: true });
    expenseService.getById.mockResolvedValue({ data: { data: { ...EXPENSE, attachments: [{ _id: 'att1', originalName: 'OR-0518.pdf', fileType: 'application/pdf', documentType: 'official_receipt' }] } } });
    mount(<ExpenseReview expenseId="e1" onClose={() => {}} />);
    expect(await screen.findByText('OR-0518.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Preview OR-0518.pdf' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve' })).toBeEnabled();
  });

  it('gives no decision buttons to the administrator who recorded the expense', async () => {
    useAuthStore.setState({ user: { _id: 'treasurer', role: 'municipal_admin' }, isAuthenticated: true });
    expenseService.getById.mockResolvedValue({ data: { data: { ...EXPENSE, attachments: [{ _id: 'att1', originalName: 'OR.pdf', fileType: 'application/pdf' }] } } });
    mount(<ExpenseReview expenseId="e1" onClose={() => {}} />);
    expect(await screen.findByText(/You recorded this expense/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });
});
