import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Users as UsersIcon, Search, UserCheck, Shield } from 'lucide-react';
import Swal from 'sweetalert2';
import { userService } from '../../services/documentService';
import DataTable from '../../components/shared/DataTable';
import StatusBadge from '../../components/shared/StatusBadge';
import Modal from '../../components/shared/Modal';
import { formatDate } from '../../utils/formatters';
import { ROLE_LABELS } from '../../utils/constants';
import { toast } from '../../components/ui/toaster';
import { motion } from 'framer-motion';
import { confirm } from '../../utils/confirm';
import useAuthStore from '../../store/authStore';

const ROLE_ASSIGNABLE_MAP = {
  super_admin: ['super_admin', 'provincial_admin', 'municipal_admin', 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative', 'public_user'],
  provincial_admin: ['municipal_admin', 'sk_chairperson', 'sk_treasurer', 'sk_secretary', 'sk_kagawad', 'dilg_representative', 'public_user'],
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

  const approveMutation = useMutation({
    mutationFn: (id) => userService.approve(id),
    onSuccess: () => { toast.success('User approved'); queryClient.invalidateQueries(['users']); queryClient.invalidateQueries(['users-pending']); },
    onError: (e) => toast.error(e.message),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }) => userService.reject(id, reason),
    onSuccess: () => { toast.success('User rejected'); queryClient.invalidateQueries(['users']); queryClient.invalidateQueries(['users-pending']); },
    onError: (e) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: (id) => userService.toggleStatus(id),
    onSuccess: () => { toast.success('User status updated'); queryClient.invalidateQueries(['users']); },
    onError: (e) => toast.error(e.message),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }) => userService.updateRole(id, { role }),
    onSuccess: () => { toast.success('Role updated'); queryClient.invalidateQueries(['users']); setRoleTarget(null); },
    onError: (e) => toast.error(e.message),
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
      key: 'firstName', header: 'User', render: (v, row) => (
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full bg-navy-100 flex items-center justify-center text-navy-700 font-bold text-sm flex-shrink-0">
            {row.firstName?.[0]}{row.lastName?.[0]}
          </div>
          <div>
            <p className="font-medium text-sm text-gray-900 dark:text-white">{row.firstName} {row.lastName}</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">{row.email}</p>
          </div>
        </div>
      )
    },
    { key: 'role', header: 'Role', render: (v) => <span className="text-xs">{ROLE_LABELS[v] || v}</span> },
    { key: 'municipality', header: 'Municipality', render: (v) => v?.name || '—' },
    { key: 'isEmailVerified', header: 'Email', render: (v) => <span className={`text-xs font-medium ${v ? 'text-green-600' : 'text-yellow-600'}`}>{v ? 'Verified' : 'Unverified'}</span> },
    { key: 'isApproved', header: 'Approval', render: (v) => <StatusBadge status={v ? 'approved' : 'pending'} /> },
    { key: 'isActive', header: 'Status', render: (v) => <StatusBadge status={v ? 'active' : 'inactive'} /> },
    { key: 'createdAt', header: 'Joined', render: (v) => formatDate(v) },
    {
      key: '_id', header: 'Actions', render: (id, row) => (
        <div className="flex flex-wrap gap-1.5">
          {!row.isApproved && (
            <>
              <button onClick={() => handleApprove(id, `${row.firstName} ${row.lastName}`)}
                className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-lg hover:bg-green-100 font-medium">Approve</button>
              <button onClick={() => handleReject(id, `${row.firstName} ${row.lastName}`)}
                className="text-xs px-2 py-1 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 font-medium">Reject</button>
            </>
          )}
          {canChangeRoles && (
            <button onClick={() => openRoleChange(row)}
              className="text-xs px-2 py-1 bg-purple-50 text-purple-700 rounded-lg hover:bg-purple-100 font-medium flex items-center gap-1">
              <Shield size={10} />Role
            </button>
          )}
          <button onClick={() => handleToggle(id, `${row.firstName} ${row.lastName}`, row.isActive)}
            className={`text-xs px-2 py-1 rounded-lg font-medium ${row.isActive ? 'bg-orange-50 text-orange-700 hover:bg-orange-100' : 'bg-blue-50 text-blue-700 hover:bg-blue-100'}`}>
            {row.isActive ? 'Deactivate' : 'Activate'}
          </button>
        </div>
      )
    },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">User Management</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">Manage SK officials and user accounts</p>
      </div>

      {/* Pending approvals alert */}
      {pending?.length > 0 && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 flex items-center gap-3">
          <div className="w-8 h-8 bg-yellow-100 dark:bg-yellow-900/40 rounded-lg flex items-center justify-center flex-shrink-0">
            <UserCheck size={16} className="text-yellow-600" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">{pending.length} account(s) pending approval</p>
            <div className="flex flex-wrap gap-2 mt-2">
              {pending.slice(0, 3).map((u) => (
                <div key={u._id} className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-yellow-200 dark:border-yellow-700 rounded-lg px-3 py-1.5">
                  <span className="text-xs text-gray-700 dark:text-gray-300">{u.firstName} {u.lastName} ({ROLE_LABELS[u.role]})</span>
                  <button onClick={() => handleApprove(u._id, `${u.firstName} ${u.lastName}`)}
                    className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded font-medium hover:bg-green-200">
                    Approve
                  </button>
                  <button onClick={() => handleReject(u._id, `${u.firstName} ${u.lastName}`)}
                    className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded font-medium hover:bg-red-200">
                    Reject
                  </button>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Filters */}
      <div className="flex gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
        <div className="flex items-center gap-2 flex-1 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2">
          <Search size={14} className="text-gray-400 dark:text-gray-500" />
          <input type="text" placeholder="Search by name or email..." value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
            className="bg-transparent text-sm outline-none flex-1 text-gray-600 dark:text-gray-300" />
        </div>
        <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })}
          className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 outline-none focus:ring-2 focus:ring-navy-700">
          <option value="">All Roles</option>
          {Object.entries(ROLE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={filters.isApproved} onChange={(e) => setFilters({ ...filters, isApproved: e.target.value })}
          className="px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-300 outline-none focus:ring-2 focus:ring-navy-700">
          <option value="">All Approval</option>
          <option value="true">Approved</option>
          <option value="false">Pending</option>
        </select>
      </div>

      <DataTable columns={columns} data={data?.data} loading={isLoading}
        pagination={data?.meta} onPageChange={(p) => setFilters({ ...filters, page: p })} />

      {/* Role Change Modal */}
      <Modal isOpen={!!roleTarget} onClose={() => setRoleTarget(null)} title="Change User Role" size="sm"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={() => setRoleTarget(null)}
              className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              Cancel
            </button>
            <button onClick={handleRoleChange} disabled={roleMutation.isPending || selectedRole === roleTarget?.currentRole}
              className="px-5 py-2 bg-navy-900 text-white text-sm rounded-xl font-semibold hover:bg-navy-800 disabled:opacity-50">
              {roleMutation.isPending ? 'Saving...' : 'Save Role'}
            </button>
          </div>
        }>
        {roleTarget && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Changing role for <span className="font-semibold text-gray-900 dark:text-white">{roleTarget.name}</span>
            </p>
            <div>
              <label className="form-label">New Role</label>
              <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)}
                className="mt-1 w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-navy-700">
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
            {selectedRole !== roleTarget.currentRole && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-700 dark:text-amber-400">
                Changing from <strong>{ROLE_LABELS[roleTarget.currentRole]}</strong> to <strong>{ROLE_LABELS[selectedRole]}</strong>. This affects what the user can access.
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
