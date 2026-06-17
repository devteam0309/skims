import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Pencil, Trash2, ChevronDown } from 'lucide-react';
import { youthService, municipalityService } from '../../services/documentService';
import DataTable from '../../components/shared/DataTable';
import Modal from '../../components/shared/Modal';
import { formatDate } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import { confirm } from '../../utils/confirm';
import useAuthStore from '../../store/authStore';
import { YOUTH_EDITORS } from '../../utils/constants';

const ADMIN_ROLES = ['super_admin', 'provincial_admin', 'municipal_admin'];

const EMPTY_FORM = {
  firstName: '', lastName: '', birthDate: '', gender: '',
  educationalAttainment: '', contactNumber: '', email: '',
  address: '', occupation: '', barangay: '', municipality: '',
  isRegisteredVoter: false,
};

const EDUCATION_OPTIONS = [
  ['elementary', 'Elementary'],
  ['high_school', 'High School'],
  ['college', 'College'],
  ['vocational', 'Vocational'],
  ['graduate', 'Graduate'],
  ['out_of_school', 'Out of School'],
];

const cls = 'mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700';

function BarangaySelect({ barangays, value, onChange }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const selected = barangays.find((b) => b._id === value);
  const filtered = barangays.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()));
  const isDark = document.documentElement.classList.contains('dark');

  const openDropdown = () => {
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    setSearch('');
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    // The dropdown is portaled to <body>, so it is NOT inside triggerRef. Without also
    // checking dropdownRef, a click on an option fires this mousedown handler first,
    // unmounts the dropdown, and the option's onClick never fires (barangay never changes).
    const close = (e) => {
      if (!triggerRef.current?.contains(e.target) && !dropdownRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  return (
    <div ref={triggerRef} className="relative">
      <button
        type="button"
        onClick={openDropdown}
        className={`${cls} flex items-center justify-between`}
      >
        <span className={selected ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}>
          {selected?.name || 'Select barangay...'}
        </span>
        <ChevronDown size={14} className="text-gray-400 dark:text-gray-500 flex-shrink-0" />
      </button>
      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-lg overflow-hidden"
        >
          <div className="p-2 border-b border-gray-100 dark:border-gray-700">
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg outline-none focus:ring-2 focus:ring-navy-700 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
              placeholder="Search barangay..."
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            <button type="button" onClick={() => { onChange(''); setOpen(false); }}
              className="w-full px-4 py-2.5 text-left text-sm text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700">
              None
            </button>
            {filtered.map((b) => (
              <button
                type="button"
                key={b._id}
                onClick={() => { onChange(b._id); setOpen(false); }}
                className={`w-full px-4 py-2.5 text-left text-sm hover:bg-navy-50 dark:hover:bg-navy-900/30 hover:text-navy-700 ${value === b._id ? 'bg-navy-50 dark:bg-navy-900/30 text-navy-700 font-medium' : 'text-gray-700 dark:text-gray-300'}`}
              >
                {b.name}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-4 py-3 text-sm text-gray-400 dark:text-gray-500 text-center">No barangays found</p>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default function Youth() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  const isAdmin = ADMIN_ROLES.includes(user?.role);
  const canRegister = [...ADMIN_ROLES, 'sk_chairperson'].includes(user?.role);
  const canEdit = YOUTH_EDITORS.includes(user?.role);
  const [filters, setFilters] = useState({ page: 1, limit: 20, search: '', gender: '', educationalAttainment: '', isActive: '', barangay: '' });
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const set = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  const { data, isLoading } = useQuery({
    queryKey: ['youth', filters],
    queryFn: () => youthService.getAll(filters).then((r) => r.data),
  });

  const userMunId = user?.municipality?._id || user?.municipality;
  const effectiveMunId = isAdmin ? form.municipality : userMunId;

  const { data: municipalities = [] } = useQuery({
    queryKey: ['municipalities'],
    queryFn: () => municipalityService.getAll().then((r) => r.data.data),
    enabled: isAdmin,
  });

  const { data: barangays = [] } = useQuery({
    queryKey: ['barangays', effectiveMunId],
    queryFn: () => municipalityService.getBarangays(effectiveMunId).then((r) => r.data.data),
    enabled: !!effectiveMunId,
  });

  const openCreate = () => { setEditTarget(null); setForm(EMPTY_FORM); setShowModal(true); };
  const openEdit = (m) => {
    setEditTarget(m);
    setForm({
      firstName: m.firstName || '',
      lastName: m.lastName || '',
      birthDate: m.birthDate ? m.birthDate.slice(0, 10) : '',
      gender: m.gender || '',
      educationalAttainment: m.educationalAttainment || '',
      contactNumber: m.contactNumber || '',
      email: m.email || '',
      address: m.address || '',
      occupation: m.occupation || '',
      barangay: m.barangay?._id || m.barangay || '',
      municipality: m.municipality?._id || m.municipality || '',
      isRegisteredVoter: m.isRegisteredVoter ?? false,
      isActive: m.isActive ?? true,
    });
    setShowModal(true);
  };
  const closeModal = () => { setShowModal(false); setEditTarget(null); setForm(EMPTY_FORM); };

  const createMutation = useMutation({
    mutationFn: (d) => youthService.create(d),
    onSuccess: () => { toast.success('Youth member registered'); queryClient.invalidateQueries(['youth']); closeModal(); },
    onError: (e) => toast.error(e?.response?.data?.message || e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }) => youthService.update(id, data),
    onSuccess: () => { toast.success('Youth member updated'); queryClient.invalidateQueries(['youth']); closeModal(); },
    onError: (e) => toast.error(e?.response?.data?.message || e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => youthService.delete(id),
    onSuccess: () => { toast.success('Youth member deleted'); queryClient.invalidateQueries(['youth']); },
    onError: (e) => toast.error(e?.response?.data?.message || e.message),
  });

  const PH_PHONE = /^(09|\+639)\d{9}$/;

  const handleSave = async () => {
    if (!form.firstName || !form.lastName || !form.birthDate || !form.gender) {
      return toast.error('First name, last name, birth date and gender are required');
    }
    if (isAdmin && !editTarget && !form.municipality) {
      return toast.error('Please select a municipality');
    }
    const age = Math.floor((Date.now() - new Date(form.birthDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (age < 15 || age > 30) {
      return toast.error('Youth member must be between 15 and 30 years old');
    }
    if (form.contactNumber && !PH_PHONE.test(form.contactNumber)) {
      return toast.error('Contact number must be a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX)');
    }
    if (editTarget) {
      const r = await confirm.save({ text: `Save changes to ${form.firstName} ${form.lastName}?` });
      if (r.isConfirmed) updateMutation.mutate({ id: editTarget._id, data: form });
    } else {
      try {
        const { data: dupData } = await youthService.checkDuplicate({
          firstName: form.firstName, lastName: form.lastName, birthDate: form.birthDate,
        });
        if (dupData.exists) {
          const r = await confirm.save({
            title: 'Possible Duplicate Detected',
            text: `A youth member named "${form.firstName} ${form.lastName}" with the same birth date already exists. Register anyway?`,
          });
          if (r.isConfirmed) createMutation.mutate(form);
          return;
        }
      } catch { /* proceed if check fails */ }
      const r = await confirm.register({ text: `Register ${form.firstName} ${form.lastName} as a youth member?` });
      if (r.isConfirmed) createMutation.mutate(form);
    }
  };

  const handleDelete = async (member) => {
    const r = await confirm.delete({ text: `Delete ${member.firstName} ${member.lastName} from the registry? This cannot be undone.` });
    if (r.isConfirmed) deleteMutation.mutate(member._id);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  const columns = [
    { key: 'lastName', header: 'Name', render: (v, row) => <p className="font-medium text-sm">{row.firstName} {v}</p> },
    { key: 'gender', header: 'Gender', render: (v) => <span className="capitalize text-sm">{v}</span> },
    { key: 'birthDate', header: 'Birthday', render: (v) => formatDate(v) },
    { key: 'educationalAttainment', header: 'Education', render: (v) => <span className="text-xs capitalize">{v?.replace(/_/g, ' ')}</span> },
    { key: 'municipality', header: 'Municipality', render: (v) => v?.name || '—' },
    { key: 'barangay', header: 'Barangay', render: (v) => v?.name || '—' },
    { key: 'contactNumber', header: 'Contact', render: (v) => v || '—' },
    ...(canEdit ? [{
      key: '_id', header: '', width: 80,
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <button onClick={() => openEdit(row)} title="Edit"
            className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-navy-700 hover:bg-navy-50 dark:hover:bg-navy-900/30 rounded-lg transition-colors">
            <Pencil size={14} />
          </button>
          <button onClick={() => handleDelete(row)} title="Delete" disabled={deleteMutation.isPending}
            className="p-1.5 text-gray-400 dark:text-gray-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors disabled:opacity-40">
            <Trash2 size={14} />
          </button>
        </div>
      ),
    }] : []),
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Youth Registry</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Track and manage youth member records</p>
        </div>
        {canRegister && (
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-navy-900 text-white px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors">
            <Plus size={16} />Register Youth
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 shadow-sm rounded-xl p-4">
        <Search size={14} className="text-gray-400 dark:text-gray-500 ml-1" />
        <input type="text" placeholder="Search by name..." value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value, page: 1 })}
          className="flex-1 text-sm outline-none text-gray-600 dark:text-gray-300" />
      </div>

      {/* Demographic filters */}
      <div className="flex flex-wrap gap-2 items-center">
        {[['', 'All'], ['male', 'Male'], ['female', 'Female'], ['other', 'Other']].map(([val, label]) => (
          <button key={val} onClick={() => setFilters({ ...filters, gender: val, page: 1 })}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${filters.gender === val ? 'bg-navy-900 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
            {label}
          </button>
        ))}
        <select value={filters.barangay} onChange={(e) => setFilters({ ...filters, barangay: e.target.value, page: 1 })}
          className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 outline-none focus:ring-2 focus:ring-navy-700">
          <option value="">All Barangays</option>
          {barangays.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
        </select>
        <select value={filters.educationalAttainment} onChange={(e) => setFilters({ ...filters, educationalAttainment: e.target.value, page: 1 })}
          className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 outline-none focus:ring-2 focus:ring-navy-700">
          <option value="">All Education</option>
          {EDUCATION_OPTIONS.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
        </select>
        <select value={filters.isActive} onChange={(e) => setFilters({ ...filters, isActive: e.target.value, page: 1 })}
          className="px-3 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg text-xs bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 outline-none focus:ring-2 focus:ring-navy-700">
          <option value="">All Status</option>
          <option value="true">Active</option>
          <option value="false">Inactive</option>
        </select>
        {(filters.gender || filters.barangay || filters.educationalAttainment || filters.isActive) && (
          <button onClick={() => setFilters({ ...filters, gender: '', barangay: '', educationalAttainment: '', isActive: '', page: 1 })}
            className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            Clear filters
          </button>
        )}
      </div>

      {data?.meta && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-4">
          <div className="text-center">
            <p className="text-2xl font-bold text-navy-900 dark:text-white">{data.meta.total}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">Total Members</p>
          </div>
        </div>
      )}

      <DataTable columns={columns} data={data?.data} loading={isLoading}
        pagination={data?.meta} onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage="No youth members registered" />

      <Modal isOpen={showModal} onClose={closeModal}
        title={editTarget ? `Edit — ${editTarget.firstName} ${editTarget.lastName}` : 'Register Youth Member'}
        size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button onClick={closeModal} className="px-4 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-xl text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Cancel</button>
            <button onClick={handleSave} disabled={isPending}
              className="px-5 py-2 bg-navy-900 text-white text-sm rounded-xl font-semibold hover:bg-navy-800 disabled:opacity-60">
              {isPending ? 'Saving...' : editTarget ? 'Save Changes' : 'Register'}
            </button>
          </div>
        }>
        <div className="space-y-4">

          {/* Name */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">First Name *</label>
              <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} className={cls} />
            </div>
            <div>
              <label className="form-label">Last Name *</label>
              <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} className={cls} />
            </div>
          </div>

          {/* Birth date + Gender */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Birth Date *</label>
              <input type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} className={cls} />
            </div>
            <div>
              <label className="form-label">Gender *</label>
              <select value={form.gender} onChange={(e) => set('gender', e.target.value)} className={cls}>
                <option value="">Select...</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>

          {/* Education */}
          <div>
            <label className="form-label">Educational Attainment</label>
            <select value={form.educationalAttainment} onChange={(e) => set('educationalAttainment', e.target.value)} className={cls}>
              <option value="">Select...</option>
              {EDUCATION_OPTIONS.map(([val, label]) => (
                <option key={val} value={val}>{label}</option>
              ))}
            </select>
          </div>

          {/* Municipality + Barangay */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Municipality {isAdmin && !editTarget && <span className="text-red-500">*</span>}</label>
              {isAdmin && !editTarget ? (
                <select
                  value={form.municipality}
                  onChange={(e) => { set('municipality', e.target.value); set('barangay', ''); }}
                  className={cls}
                >
                  <option value="">Select municipality...</option>
                  {municipalities.map((m) => (
                    <option key={m._id} value={m._id}>{m.name}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={editTarget ? (editTarget.municipality?.name || '') : (user?.municipality?.name || '')}
                  readOnly
                  className={`${cls} bg-gray-50 dark:bg-gray-700 cursor-not-allowed text-gray-500 dark:text-gray-400`}
                />
              )}
            </div>
            <div>
              <label className="form-label">Barangay</label>
              <BarangaySelect
                barangays={barangays}
                value={form.barangay}
                onChange={(val) => set('barangay', val)}
              />
            </div>
          </div>

          {/* Contact + Email */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Contact Number</label>
              <input type="tel" value={form.contactNumber} onChange={(e) => set('contactNumber', e.target.value)} className={cls} />
            </div>
            <div>
              <label className="form-label">Email</label>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={cls} />
            </div>
          </div>

          {/* Address */}
          <div>
            <label className="form-label">Street Address</label>
            <input value={form.address} onChange={(e) => set('address', e.target.value)} className={cls} placeholder="House no., street name" />
          </div>

          {/* Occupation */}
          <div>
            <label className="form-label">Occupation</label>
            <input value={form.occupation} onChange={(e) => set('occupation', e.target.value)} className={cls} />
          </div>

          {/* Checkboxes */}
          <div className="flex items-center gap-6 pt-1">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.isRegisteredVoter}
                onChange={(e) => set('isRegisteredVoter', e.target.checked)}
                className="w-4 h-4 accent-navy-900" />
              <span className="text-sm text-gray-700 dark:text-gray-300">Registered Voter</span>
            </label>
            {editTarget && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.isActive}
                  onChange={(e) => set('isActive', e.target.checked)}
                  className="w-4 h-4 accent-navy-900" />
                <span className="text-sm text-gray-700 dark:text-gray-300">Active Member</span>
              </label>
            )}
          </div>

        </div>
      </Modal>
    </div>
  );
}
