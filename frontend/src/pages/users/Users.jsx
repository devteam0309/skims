import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCheck, Shield } from 'lucide-react';
import Swal from 'sweetalert2';
import { userService } from '../../services/documentService';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import SearchInput from '../../components/shared/SearchInput';
import { Field, control } from '../../components/shared/FormField';
import { formatDate } from '../../utils/formatters';
import { ROLE_LABELS } from '../../utils/constants';
import { toast } from '../../components/ui/toaster';
import { confirm } from '../../utils/confirm';
import useAuthStore from '../../store/authStore';

/**
 * Mirrors ASSIGNABLE_ROLES in backend/src/controllers/userController.js, narrowed to the roles
 * that can actually reach it: routes/users.js authorizes PUT /:id/role for super_admin and
 * provincial_admin only, so the controller's municipal_admin entry is unreachable and is
 * deliberately not mirrored here.
 */
const ROLE_ASSIGNABLE_MAP = {
  super_admin: ['super_admin', 'provincial_admin', 'municipal_admin', 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative'],
  provincial_admin: ['municipal_admin', 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative'],
};

export default function Users() {
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuthStore();
  const [filters, setFilters] = useState({ page: 1, limit: 10, search: '', role: '', isApproved: '' });
  const [roleTarget, setRoleTarget] = useState(null); // { id, name, currentRole }
  const [selectedRole, setSelectedRole] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['users', filters],
    queryFn: () => userService.getAll(filters).then((r) => r.data),
  });

  const { data: pending } = useQuery({
    queryKey: ['users-pending'],
    queryFn: () => userService.getPending().then((r) => r.data.data),
  });

  const invalidateUsers = () => {
    queryClient.invalidateQueries(['users']);
    queryClient.invalidateQueries(['users-pending']);
  };

  const approveMutation = useMutation({
    mutationFn: (id) => userService.approve(id),
    onSuccess: () => { toast.success('User approved'); invalidateUsers(); },
    onError: (e) => toast.error(e.message || 'Approval failed'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => userService.reject(id, reason),
    onSuccess: () => { toast.success('User rejected'); invalidateUsers(); },
    onError: (e) => toast.error(e.message || 'Rejection failed'),
  });

  const toggleMutation = useMutation({
    mutationFn: (id) => userService.toggleStatus(id),
    onSuccess: () => { toast.success('User status updated'); queryClient.invalidateQueries(['users']); },
    onError: (e) => toast.error(e.message || 'Status change failed'),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }) => userService.updateRole(id, { role }),
    onSuccess: () => { toast.success('Role updated'); queryClient.invalidateQueries(['users']); setRoleTarget(null); },
    onError: (e) => toast.error(e.message || 'Role change failed'),
  });

  const handleApprove = async (id, name) => {
    const result = await confirm.approve({ title: 'Approve User?', text: `Grant system access to ${name}?` });
    if (result.isConfirmed) approveMutation.mutate(id);
  };

  const handleReject = async (id, name) => {
    const { isConfirmed, value: reason } = await Swal.fire({
      title: 'Reject Account?',
      html: `<p style="font-size:0.875rem;color:#6b7280">Provide a reason for rejecting <strong>${name}</strong>'s account application.</p>`,
      input: 'textarea',
      inputPlaceholder: 'Reason for rejection (optional)...',
      inputAttributes: { rows: 3, style: 'font-size:0.875rem;border:1px solid #e5e7eb;border-radius:0.75rem;padding:0.75rem;width:100%;resize:none;margin-top:0.5rem;outline:none' },
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Reject Account',
      cancelButtonText: 'Cancel',
      buttonsStyling: false,
      reverseButtons: true,
      customClass: {
        popup: 'swal-popup',
        confirmButton: 'swal-btn-confirm swal-btn-confirm--danger',
        cancelButton: 'swal-btn-cancel',
        actions: 'swal-actions',
        title: 'swal-title',
        htmlContainer: 'swal-html',
      },
    });
    if (isConfirmed) rejectMutation.mutate({ id, reason: reason?.trim() || '' });
  };

  const handleToggle = async (id, name, isActive) => {
    const result = isActive
      ? await confirm.statusChange({ title: 'Deactivate User?', text: `${name} will lose access to the system.` })
      : await confirm.statusChange({ title: 'Activate User?', text: `${name} will regain access to the system.` });
    if (result.isConfirmed) toggleMutation.mutate(id);
  };

  const openRoleChange = (row) => {
    setRoleTarget({ id: row._id, name: `${row.firstName} ${row.lastName}`, currentRole: row.role });
    setSelectedRole(row.role);
  };

  const handleRoleChange = async () => {
    if (!selectedRole || selectedRole === roleTarget.currentRole) { setRoleTarget(null); return; }
    const result = await confirm.statusChange({
      title: 'Change Role?',
      text: `Change ${roleTarget.name}'s role to "${ROLE_LABELS[selectedRole]}"?`,
    });
    if (result.isConfirmed) roleMutation.mutate({ id: roleTarget.id, role: selectedRole });
  };

  const assignableRoles = ROLE_ASSIGNABLE_MAP[currentUser?.role] || [];
  const canChangeRoles = assignableRoles.length > 0;

  const columns = [
    {
      key: 'firstName',
      header: 'User',
      render: (v, row) => {
        const isSelf = row._id === currentUser?._id;
        return (
          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-navy-100 text-sm font-bold text-navy-700 dark:bg-navy-500/20 dark:text-navy-300"
            >
              {row.firstName?.[0]}{row.lastName?.[0]}
            </span>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-white">
                {row.firstName} {row.lastName}
                {/* Which row is your own matters here — the actions on it are withheld. */}
                {isSelf && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                    You
                  </span>
                )}
              </p>
              <p className="meta-text truncate">{row.email}</p>
            </div>
          </div>
        );
      },
    },
    { key: 'role', header: 'Role', render: (v) => <span className="text-xs">{ROLE_LABELS[v] || v}</span> },
    { key: 'municipality', header: 'Municipality', render: (v) => v?.name || '—' },
    {
      key: 'isEmailVerified',
      header: 'Email',
      // Was bare green/amber text with no dark variant, so it dimmed into the dark surface.
      render: (v) => (
        <span className={`text-xs font-medium ${v ? 'text-green-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400'}`}>
          {v ? 'Verified' : 'Unverified'}
        </span>
      ),
    },
    { key: 'isApproved', header: 'Approval', render: (v) => <StatusBadge status={v ? 'approved' : 'pending'} /> },
    { key: 'isActive', header: 'Status', render: (v) => <StatusBadge status={v ? 'active' : 'inactive'} /> },
    { key: 'createdAt', header: 'Joined', render: (v) => formatDate(v) },
    {
      key: '_id',
      header: 'Actions',
      render: (id, row) => {
        const name = `${row.firstName} ${row.lastName}`;
        /*
         * Both of these are one click away from locking yourself out: a super_admin can demote
         * themselves to a lesser role, and any admin can deactivate their own account. Neither the
         * role endpoint nor the toggle-status endpoint checks whether the target is the caller,
         * so nothing downstream would stop it. Withholding them on your own row removes the
         * footgun from the only place it is reachable in the product.
         */
        const isSelf = row._id === currentUser?._id;

        return (
          <div className="flex flex-wrap items-center gap-1.5">
            {!row.isApproved && (
              <>
                <ActionButton onClick={() => handleApprove(id, name)} label={`Approve ${name}`} tone="success">
                  Approve
                </ActionButton>
                <ActionButton onClick={() => handleReject(id, name)} label={`Reject ${name}`} tone="danger">
                  Reject
                </ActionButton>
              </>
            )}

            {canChangeRoles && !isSelf && (
              <ActionButton onClick={() => openRoleChange(row)} label={`Change role for ${name}`} tone="neutral">
                <Shield size={10} aria-hidden="true" />Role
              </ActionButton>
            )}

            {!isSelf && (
              <ActionButton
                onClick={() => handleToggle(id, name, row.isActive)}
                label={`${row.isActive ? 'Deactivate' : 'Activate'} ${name}`}
                tone={row.isActive ? 'warning' : 'info'}
              >
                {row.isActive ? 'Deactivate' : 'Activate'}
              </ActionButton>
            )}

            {isSelf && (
              <span className="meta-text">Manage your own account in your profile</span>
            )}
          </div>
        );
      },
    },
  ];

  const pendingCount = pending?.length || 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">User Management</h1>
        <p className="page-subtitle">Manage SK officials and user accounts</p>
      </div>

      {pendingCount > 0 && (
        <section
          aria-label="Pending approvals"
          className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20"
        >
          <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/40">
            <UserCheck size={16} className="text-amber-600 dark:text-amber-400" />
          </span>
          <div className="min-w-0 flex-1">
            {/* Was "N account(s) pending approval" — the parenthesised plural is a placeholder
                nobody got round to, and reads as unfinished on an admin's first screen. */}
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              <span className="numeric">{pendingCount}</span> account{pendingCount !== 1 ? 's' : ''} pending approval
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {pending.slice(0, 3).map((u) => {
                const name = `${u.firstName} ${u.lastName}`;
                return (
                  <li key={u._id} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-white px-3 py-1.5 dark:border-amber-700 dark:bg-gray-800">
                    <span className="text-xs text-gray-700 dark:text-gray-300">{name} ({ROLE_LABELS[u.role]})</span>
                    <ActionButton onClick={() => handleApprove(u._id, name)} label={`Approve ${name}`} tone="success" size="xs">
                      Approve
                    </ActionButton>
                    <ActionButton onClick={() => handleReject(u._id, name)} label={`Reject ${name}`} tone="danger" size="xs">
                      Reject
                    </ActionButton>
                  </li>
                );
              })}
            </ul>
            {/* Only the first three were ever listed, with nothing to say the rest existed. */}
            {pendingCount > 3 && (
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, isApproved: 'false', page: 1 }))}
                className="mt-2 text-xs font-medium text-amber-800 underline hover:no-underline dark:text-amber-300"
              >
                Show all {pendingCount} pending accounts
              </button>
            )}
          </div>
        </section>
      )}

      <section aria-label="Filter users" className="rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-wrap gap-3">
          <SearchInput
            id="user-search"
            label="Search users"
            placeholder="Search by name or email..."
            value={filters.search}
            onSearch={(search) => setFilters((f) => ({ ...f, search, page: 1 }))}
          />

          <div>
            <label htmlFor="filter-role" className="sr-only">Filter by role</label>
            <select
              id="filter-role"
              value={filters.role}
              // Neither select reset the page, so narrowing the list while on page 4 left you
              // looking at an empty table.
              onChange={(e) => setFilters({ ...filters, role: e.target.value, page: 1 })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              <option value="">All Roles</option>
              {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          <div>
            <label htmlFor="filter-approval" className="sr-only">Filter by approval state</label>
            <select
              id="filter-approval"
              value={filters.isApproved}
              onChange={(e) => setFilters({ ...filters, isApproved: e.target.value, page: 1 })}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              <option value="">All Approval</option>
              <option value="true">Approved</option>
              <option value="false">Pending</option>
            </select>
          </div>
        </div>
      </section>

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        pagination={data?.meta}
        onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage="No users match these filters"
      />

      <Modal
        isOpen={!!roleTarget}
        onClose={() => setRoleTarget(null)}
        title="Change User Role"
        size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => setRoleTarget(null)}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRoleChange}
              disabled={roleMutation.isPending || selectedRole === roleTarget?.currentRole}
              className="rounded-xl bg-navy-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-50"
            >
              {roleMutation.isPending ? 'Saving...' : 'Save Role'}
            </button>
          </div>
        }
      >
        {roleTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Changing role for <span className="font-semibold text-gray-900 dark:text-white">{roleTarget.name}</span>
            </p>

            <Field id="new-role" label="New Role" required>
              <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className={control}>
                {assignableRoles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </Field>

            {selectedRole !== roleTarget.currentRole && (
              <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-400">
                Changing from <strong>{ROLE_LABELS[roleTarget.currentRole]}</strong> to{' '}
                <strong>{ROLE_LABELS[selectedRole]}</strong>. This affects what the user can access.
              </p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

/**
 * Row action button.
 *
 * The row previously mixed green, red, purple and orange chips. Purple and orange belong to no
 * tone in the status vocabulary, so "Role" and "Deactivate" read as two more statuses rather than
 * as controls. Tones here are the same five used by StatusBadge.
 */
const TONES = {
  neutral: 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600',
  info: 'bg-blue-50 text-blue-700 hover:bg-blue-100 dark:bg-blue-500/15 dark:text-blue-300 dark:hover:bg-blue-500/25',
  success: 'bg-green-50 text-green-700 hover:bg-green-100 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25',
  warning: 'bg-amber-50 text-amber-700 hover:bg-amber-100 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25',
  danger: 'bg-red-50 text-red-700 hover:bg-red-100 dark:bg-red-500/15 dark:text-red-300 dark:hover:bg-red-500/25',
};

function ActionButton({ onClick, label, tone = 'neutral', size = 'sm', children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`flex items-center gap-1 rounded-lg font-medium transition-colors ${
        size === 'xs' ? 'px-2 py-0.5 text-xs' : 'px-2 py-1 text-xs'
      } ${TONES[tone]}`}
    >
      {children}
    </button>
  );
}
