import { useState, useRef, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, ChevronDown } from 'lucide-react';
import { youthService, municipalityService } from '../../services/documentService';
import DataTable from '../../components/shared/DataTable';
import Modal from '../../components/shared/Modal';
import SearchInput from '../../components/shared/SearchInput';
import StatusBadge from '../../components/shared/StatusBadge';
import ComboInput from '../../components/shared/ComboInput';
import { Field, RequiredNote, control } from '../../components/shared/FormField';
import { formatDate, calculateAge, YOUTH_MIN_AGE, YOUTH_MAX_AGE } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import { confirm } from '../../utils/confirm';
import useAuthStore from '../../store/authStore';
import { YOUTH_EDITORS, YOUTH_REGISTRARS } from '../../utils/constants';

const EMPTY_FORM = {
  firstName: '', lastName: '', birthDate: '', gender: '',
  educationalAttainment: '', contactNumber: '', email: '',
  address: '', occupation: '', barangay: '', municipality: '',
  isRegisteredVoter: false,
  // Was absent, so a newly registered member had no isActive in the payload at all and relied on
  // the schema default, while an edited one always sent it. Same record, two shapes.
  isActive: true,
};

const EDUCATION_OPTIONS = [
  ['elementary', 'Elementary'],
  ['high_school', 'High School'],
  ['college', 'College'],
  ['vocational', 'Vocational'],
  ['graduate', 'Graduate'],
  ['out_of_school', 'Out of School'],
];

/*
 * Suggestions, not a closed list. Gender is free text on both the model and the route, so a member
 * who identifies as e.g. LGBTQIA+ is recorded as written instead of being flattened into "Other" —
 * which was the panel's finding. These three are offered because they cover most entries and keep
 * the common values spelled consistently.
 */
const GENDER_SUGGESTIONS = ['Male', 'Female', 'LGBTQIA+'];

const PH_PHONE = /^(09|\+639)\d{9}$/;

/**
 * Searchable barangay picker.
 *
 * Rebuilt rather than restyled. The original was a button that opened a portalled div of buttons:
 *  - it took no keyboard input at all — no arrows, no Enter, no Escape — so the field was
 *    unusable without a mouse, on a registration form for a government registry;
 *  - it exposed no combobox semantics, so assistive tech announced an unlabelled button and then
 *    a stack of unrelated buttons;
 *  - its position was measured once on open and written as `position: fixed`, so any scroll of
 *    the surrounding modal left the list floating over unrelated content, still anchored to
 *    where the trigger used to be.
 */
function BarangaySelect({ id, barangays, value, onChange, disabled, disabledHint }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });

  const triggerRef = useRef(null);
  const dropdownRef = useRef(null);
  const optionRefs = useRef([]);
  const listboxId = `${useId()}-barangay-listbox`;

  const selected = barangays.find((b) => b._id === value);
  const filtered = barangays.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()));
  // "None" is a real choice, so it belongs in the keyboard sequence rather than sitting outside it.
  const options = [{ _id: '', name: 'None' }, ...filtered];

  const openDropdown = () => {
    if (disabled) return;
    setSearch('');
    setActiveIndex(Math.max(0, options.findIndex((o) => o._id === value)));
    setOpen(true);
  };

  const closeDropdown = ({ refocus = true } = {}) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  };

  const choose = (optionValue) => {
    onChange(optionValue);
    closeDropdown();
  };

  // Re-measure while open. Listening in the capture phase catches scrolls of any ancestor —
  // the modal body scrolls, and that is exactly the case the original missed.
  useEffect(() => {
    if (!open) return undefined;
    const reposition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    };
    reposition();
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    /*
     * The dropdown is portalled to <body>, so it is not inside triggerRef. Without also checking
     * dropdownRef a click on an option fires this handler first, unmounts the list, and the
     * option's onClick never runs — the barangay silently never changes.
     */
    const onPointerDown = (e) => {
      if (!triggerRef.current?.contains(e.target) && !dropdownRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  // Keep the highlighted option in view when arrowing past the visible window.
  useEffect(() => {
    if (open) optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const onKeyDown = (e) => {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openDropdown();
      }
      return;
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Home':
        e.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        e.preventDefault();
        setActiveIndex(options.length - 1);
        break;
      case 'Enter':
        e.preventDefault();
        if (options[activeIndex]) choose(options[activeIndex]._id);
        break;
      case 'Escape':
        // Stopped here so the surrounding Modal does not also close: Escape should dismiss the
        // innermost layer only.
        e.preventDefault();
        e.stopPropagation();
        closeDropdown();
        break;
      case 'Tab':
        closeDropdown({ refocus: false });
        break;
      default:
        break;
    }
  };

  return (
    <div className="relative">
      <button
        id={id}
        ref={triggerRef}
        type="button"
        onClick={() => (open ? closeDropdown() : openDropdown())}
        onKeyDown={onKeyDown}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        className={`${control} flex items-center justify-between text-left disabled:cursor-not-allowed disabled:bg-gray-50 dark:disabled:bg-gray-700/50`}
      >
        <span className={selected ? 'text-gray-900 dark:text-white' : 'text-gray-400 dark:text-gray-500'}>
          {disabled ? (disabledHint || 'Select a municipality first') : (selected?.name || 'Select barangay...')}
        </span>
        <ChevronDown size={14} aria-hidden="true" className="shrink-0 text-gray-400 dark:text-gray-500" />
      </button>

      {open && createPortal(
        <div
          ref={dropdownRef}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, zIndex: 9999 }}
          className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg dark:border-gray-600 dark:bg-gray-800"
        >
          <div className="border-b border-gray-100 p-2 dark:border-gray-700">
            <label htmlFor={`${listboxId}-search`} className="sr-only">Search barangays</label>
            <input
              id={`${listboxId}-search`}
              autoFocus
              value={search}
              onChange={(e) => { setSearch(e.target.value); setActiveIndex(0); }}
              onKeyDown={onKeyDown}
              placeholder="Search barangay..."
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-navy-700 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>

          <ul id={listboxId} role="listbox" aria-label="Barangays" className="max-h-48 overflow-y-auto">
            {options.map((o, i) => {
              const isSelected = value === o._id;
              const isActive = i === activeIndex;
              return (
                <li key={o._id || '__none'} role="option" aria-selected={isSelected}>
                  <button
                    type="button"
                    ref={(el) => { optionRefs.current[i] = el; }}
                    onClick={() => choose(o._id)}
                    onMouseEnter={() => setActiveIndex(i)}
                    tabIndex={-1}
                    className={`w-full px-4 py-2.5 text-left text-sm ${
                      o._id === '' ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'
                    } ${isActive ? 'bg-navy-50 dark:bg-navy-900/30' : ''} ${
                      isSelected ? 'font-medium text-navy-700 dark:text-navy-300' : ''
                    }`}
                  >
                    {o.name}
                  </button>
                </li>
              );
            })}
            {filtered.length === 0 && (
              <li className="px-4 py-3 text-center text-sm text-gray-400 dark:text-gray-500">No barangays found</li>
            )}
          </ul>
        </div>,
        document.body
      )}
    </div>
  );
}

export default function Youth() {
  const queryClient = useQueryClient();
  const { user } = useAuthStore();
  /*
   * Whether this account genuinely spans municipalities. municipal_admin is in ADMIN_ROLES but is
   * scoped to its own municipality by the server, so offering it a municipality filter produced a
   * control that could only ever return an empty table — the same "the filter is broken" reading
   * the barangay picker once caused. Programs gates its equivalent filter the same way.
   */
  const isCrossMunicipality = ['super_admin', 'provincial_admin'].includes(user?.role);
  /*
   * Youth register themselves now, so this is the fallback rather than the normal way in — kept
   * for members with no email address, who cannot sign up and would otherwise be missing from the
   * roster entirely. That makes the SK Chairperson the person who most needs it, since they do the
   * canvassing; restricting it to admins left them unable to add anyone at all.
   */
  const canRegister = YOUTH_REGISTRARS.includes(user?.role);
  const canEdit = YOUTH_EDITORS.includes(user?.role);

  const [filters, setFilters] = useState({
    page: 1, limit: 20, search: '', gender: '', educationalAttainment: '', isActive: '',
    barangay: '', municipality: '', skEligible: '',
  });
  const [showModal, setShowModal] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const set = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  const { data, isLoading } = useQuery({
    queryKey: ['youth', filters],
    queryFn: () => youthService.getAll(filters).then((r) => r.data),
  });

  const userMunId = user?.municipality?._id || user?.municipality;

  const { data: municipalities = [] } = useQuery({
    queryKey: ['municipalities'],
    queryFn: () => municipalityService.getAll().then((r) => r.data.data),
    enabled: isCrossMunicipality,
  });

  /*
   * The barangay list is fetched twice against two different municipalities, because the filter
   * bar and the registration form are asking different questions.
   *
   * Both previously shared one query keyed on the *form's* municipality. For an admin that is
   * empty until they open the modal and choose one, so the "All Barangays" filter sat permanently
   * empty and there was no way to filter the registry by barangay at all.
   */
  /*
   * Both key off whether the account genuinely spans municipalities, not off ADMIN_ROLES.
   *
   * municipal_admin is in ADMIN_ROLES but is scoped by the server like any other municipal role.
   * Keying on ADMIN_ROLES left it with no municipality filter (correctly hidden) while these
   * still resolved to the empty filter value — so its barangay picker stayed disabled on "Pick a
   * municipality" forever, and the registration form offered a choice the server would override.
   */
  const filterMunId = isCrossMunicipality ? filters.municipality : userMunId;
  const formMunId = isCrossMunicipality ? form.municipality : userMunId;

  /*
   * With no municipality chosen, a province-wide account gets every barangay in the province
   * rather than a disabled control telling it to pick a municipality first. Narrowing by
   * municipality is still offered; it is no longer a precondition for filtering by barangay.
   */
  const { data: filterBarangays = [] } = useQuery({
    queryKey: ['barangays', filterMunId || 'all'],
    queryFn: () => (filterMunId
      ? municipalityService.getBarangays(filterMunId)
      : municipalityService.getAllBarangays()
    ).then((r) => r.data.data),
    enabled: !!filterMunId || isCrossMunicipality,
  });

  // Grouped under their municipality when the list spans the province; flat otherwise, where
  // every entry already belongs to the same municipality and a header would say nothing.
  const groupedFilterBarangays = filterMunId ? null : filterBarangays.reduce((acc, b) => {
    const name = b.municipality?.name || 'Unassigned';
    (acc[name] = acc[name] || []).push(b);
    return acc;
  }, {});

  const { data: formBarangays = [] } = useQuery({
    queryKey: ['barangays', formMunId],
    queryFn: () => municipalityService.getBarangays(formMunId).then((r) => r.data.data),
    enabled: !!formMunId,
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
    mutationFn: ({ id, data: payload }) => youthService.update(id, payload),
    onSuccess: () => { toast.success('Youth member updated'); queryClient.invalidateQueries(['youth']); closeModal(); },
    onError: (e) => toast.error(e?.response?.data?.message || e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => youthService.delete(id),
    onSuccess: () => { toast.success('Youth member deleted'); queryClient.invalidateQueries(['youth']); },
    onError: (e) => toast.error(e?.response?.data?.message || e.message),
  });

  const formAge = calculateAge(form.birthDate);

  const handleSave = async () => {
    if (!form.firstName || !form.lastName || !form.birthDate || !form.gender) {
      return toast.error('First name, last name, birth date and gender are required');
    }
    if (isCrossMunicipality && !editTarget && !form.municipality) {
      return toast.error('Please select a municipality');
    }
    // Calendar age, matching backend/src/utils/age.js. The previous 365.25-day approximation
    // disagreed with the calendar around a birthday, and from 2027 would have started refusing
    // 15-year-olds and admitting 31-year-olds.
    if (formAge === null || formAge < YOUTH_MIN_AGE || formAge > YOUTH_MAX_AGE) {
      return toast.error(`Youth member must be between ${YOUTH_MIN_AGE} and ${YOUTH_MAX_AGE} years old`);
    }
    if (form.contactNumber && !PH_PHONE.test(form.contactNumber)) {
      return toast.error('Contact number must be a valid PH mobile number (09XXXXXXXXX or +639XXXXXXXXX)');
    }

    if (editTarget) {
      const r = await confirm.save({ text: `Save changes to ${form.firstName} ${form.lastName}?` });
      if (r.isConfirmed) updateMutation.mutate({ id: editTarget._id, data: form });
      return;
    }

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
    } catch { /* the duplicate check is advisory — a failure here must not block registration */ }

    const r = await confirm.register({ text: `Register ${form.firstName} ${form.lastName} as a youth member?` });
    if (r.isConfirmed) createMutation.mutate(form);
  };

  const handleDelete = async (member) => {
    const r = await confirm.delete({ text: `Delete ${member.firstName} ${member.lastName} from the registry? This cannot be undone.` });
    if (r.isConfirmed) deleteMutation.mutate(member._id);
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const hasFilters = Boolean(
    filters.gender || filters.barangay || filters.educationalAttainment || filters.isActive
    || filters.municipality || filters.search || filters.skEligible
  );
  const clearFilters = () => setFilters((f) => ({
    ...f, gender: '', barangay: '', educationalAttainment: '', isActive: '', municipality: '',
    search: '', skEligible: '', page: 1,
  }));

  const columns = [
    { key: 'lastName', header: 'Name', render: (v, row) => <p className="text-sm font-medium text-gray-900 dark:text-white">{row.firstName} {v}</p> },
    { key: 'gender', header: 'Gender', render: (v) => <span className="text-sm capitalize">{v}</span> },
    {
      key: 'birthDate',
      header: 'Birthday',
      // The registry is age-gated, so the age is the operative fact; the date alone made every
      // reader do the arithmetic themselves.
      render: (v) => (
        <span>
          {formatDate(v)}
          <span className="meta-text"> · <span className="numeric">{calculateAge(v) ?? '—'}</span> yrs</span>
        </span>
      ),
    },
    { key: 'educationalAttainment', header: 'Education', render: (v) => <span className="text-xs capitalize">{v?.replace(/_/g, ' ') || '—'}</span> },
    { key: 'municipality', header: 'Municipality', render: (v) => v?.name || '—' },
    { key: 'barangay', header: 'Barangay', render: (v) => v?.name || '—' },
    { key: 'contactNumber', header: 'Contact', render: (v) => v || '—' },
    {
      key: 'isActive',
      header: 'Status',
      /*
       * Two separate facts, and the registry showed neither. `isActive` is an administrative
       * decision — whether this record is a current member. SK membership is a matter of age:
       * the Sangguniang Kabataan covers 15–30, so a member who has aged past 30 remains a valid
       * historical record but is no longer under the SK. Someone can be active and aged out, so
       * both are shown rather than one standing in for the other.
       */
      render: (v, row) => {
        const active = v !== false;
        const age = calculateAge(row.birthDate);
        const underSk = age !== null && age >= YOUTH_MIN_AGE && age <= YOUTH_MAX_AGE;
        return (
          <div className="flex flex-wrap items-center gap-1.5">
            <StatusBadge status={active ? 'active' : 'inactive'} />
            {active && !underSk && (
              <span className="meta-text whitespace-nowrap" title={`Age ${age} is outside the SK range of ${YOUTH_MIN_AGE}–${YOUTH_MAX_AGE}`}>
                aged out of SK
              </span>
            )}
          </div>
        );
      },
    },
    ...(canEdit ? [{
      key: '_id',
      // The header was an empty string, leaving the column with no name for anyone navigating
      // the table by headers.
      header: <span className="sr-only">Actions</span>,
      width: 80,
      render: (_, row) => (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => openEdit(row)}
            aria-label={`Edit ${row.firstName} ${row.lastName}`}
            title="Edit"
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-navy-50 hover:text-navy-700 dark:text-gray-500 dark:hover:bg-navy-900/30 dark:hover:text-navy-300"
          >
            <Pencil size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => handleDelete(row)}
            disabled={deleteMutation.isPending}
            aria-label={`Delete ${row.firstName} ${row.lastName}`}
            title="Delete"
            className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40 dark:text-gray-500 dark:hover:bg-red-900/20 dark:hover:text-red-400"
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      ),
    }] : []),
  ];

  const selectClass = 'rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs text-gray-700 outline-none focus:border-navy-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200';

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="page-title">Youth Registry</h1>
          <p className="page-subtitle">
          Track and manage youth member records · members register themselves
        </p>
        </div>
        {canRegister && (
          <button
            type="button"
            onClick={openCreate}
            className="flex items-center gap-2 rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
          >
            <Plus size={16} aria-hidden="true" />Register on behalf
          </button>
        )}
      </div>

      <section aria-label="Filter youth members" className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <SearchInput
          id="youth-search"
          label="Search youth members"
          placeholder="Search by name..."
          value={filters.search}
          onSearch={(search) => setFilters((f) => ({ ...f, search, page: 1 }))}
        />

        <div className="flex flex-wrap items-center gap-2">
          {/* A fixed button per gender cannot work now that the field is free text — an entry the
              buttons do not name would be unfilterable. The server matches the whole value
              case-insensitively, so typing "female" finds "Female". */}
          <div className="w-40">
            <label htmlFor="filter-gender" className="sr-only">Filter by gender</label>
            <ComboInput
              id="filter-gender"
              options={GENDER_SUGGESTIONS}
              value={filters.gender}
              onChange={(e) => setFilters({ ...filters, gender: e.target.value, page: 1 })}
              placeholder="Any gender"
              className="!mt-0 !py-1.5 !text-xs"
            />
          </div>

          {isCrossMunicipality && (
            <>
              <label htmlFor="filter-municipality" className="sr-only">Filter by municipality</label>
              <select
                id="filter-municipality"
                value={filters.municipality}
                onChange={(e) => setFilters({ ...filters, municipality: e.target.value, barangay: '', page: 1 })}
                className={selectClass}
              >
                <option value="">All Municipalities</option>
                {municipalities.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
              </select>
            </>
          )}

          <label htmlFor="filter-barangay" className="sr-only">Filter by barangay</label>
          <select
            id="filter-barangay"
            value={filters.barangay}
            onChange={(e) => setFilters({ ...filters, barangay: e.target.value, page: 1 })}
            disabled={!filterMunId && !isCrossMunicipality}
            className={`${selectClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            <option value="">All Barangays</option>
            {groupedFilterBarangays
              ? Object.entries(groupedFilterBarangays).map(([mun, list]) => (
                <optgroup key={mun} label={mun}>
                  {list.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
                </optgroup>
              ))
              : filterBarangays.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>

          {/* Type-or-pick, matching the registration form and the gender filter beside it. A level
              typed into the form has to be reachable from the filter, or the custom entry is
              write-only. */}
          <div className="w-44">
            <label htmlFor="filter-education" className="sr-only">Filter by educational attainment</label>
            <ComboInput
              id="filter-education"
              options={EDUCATION_OPTIONS.map(([, label]) => label)}
              value={filters.educationalAttainment}
              onChange={(e) => setFilters({ ...filters, educationalAttainment: e.target.value, page: 1 })}
              placeholder="All education"
              className="!mt-0 !py-1.5 !text-xs"
            />
          </div>

          <label htmlFor="filter-active" className="sr-only">Filter by membership status</label>
          <select
            id="filter-active"
            value={filters.isActive}
            onChange={(e) => setFilters({ ...filters, isActive: e.target.value, page: 1 })}
            className={selectClass}
          >
            <option value="">All Status</option>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </select>

          {/* Age-derived, not a stored flag — see the Status column. Kept separate from
              Active/Inactive because a member can be an active record and still have aged out. */}
          <label htmlFor="filter-sk" className="sr-only">Filter by SK membership</label>
          <select
            id="filter-sk"
            value={filters.skEligible}
            onChange={(e) => setFilters({ ...filters, skEligible: e.target.value, page: 1 })}
            className={selectClass}
          >
            <option value="">All Ages</option>
            <option value="true">Still under SK</option>
            <option value="false">Aged out of SK</option>
          </select>

          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-700 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            >
              Clear filters
            </button>
          )}
        </div>
      </section>

      {data?.meta && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-center dark:border-gray-700 dark:bg-gray-800">
          <p className="numeric text-2xl font-bold text-navy-900 dark:text-white">{data.meta.total}</p>
          <p className="meta-text">{hasFilters ? 'Members matching filters' : 'Total members'}</p>
        </div>
      )}

      <DataTable
        columns={columns}
        data={data?.data}
        loading={isLoading}
        pagination={data?.meta}
        onPageChange={(p) => setFilters({ ...filters, page: p })}
        emptyMessage={hasFilters ? 'No youth members match these filters' : 'No youth members registered'}
        emptyAction={hasFilters ? (
          <button type="button" onClick={clearFilters} className="text-sm font-medium text-navy-700 hover:underline dark:text-navy-300">
            Clear filters
          </button>
        ) : null}
      />

      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editTarget ? `Edit — ${editTarget.firstName} ${editTarget.lastName}` : 'Register Youth Member'}
        size="md"
        footer={
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={closeModal}
              className="rounded-xl border border-gray-200 px-4 py-2 text-sm text-gray-600 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="rounded-xl bg-navy-900 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
            >
              {isPending ? 'Saving...' : editTarget ? 'Save Changes' : 'Register'}
            </button>
          </div>
        }
      >
        <div className="space-y-4">
          <RequiredNote />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="youth-firstName" label="First Name" required>
              <input value={form.firstName} onChange={(e) => set('firstName', e.target.value)} className={control} />
            </Field>
            <Field id="youth-lastName" label="Last Name" required>
              <input value={form.lastName} onChange={(e) => set('lastName', e.target.value)} className={control} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              id="youth-birthDate"
              label="Birth Date"
              required
              // Eligibility was only revealed by pressing Register and reading a toast. The age
              // now appears as soon as a date is entered, and says whether it qualifies.
              hint={
                form.birthDate && formAge !== null
                  ? `Age ${formAge}${formAge < YOUTH_MIN_AGE || formAge > YOUTH_MAX_AGE ? ` — outside the ${YOUTH_MIN_AGE}–${YOUTH_MAX_AGE} range` : ''}`
                  : `Members must be ${YOUTH_MIN_AGE}–${YOUTH_MAX_AGE} years old.`
              }
            >
              <input type="date" value={form.birthDate} onChange={(e) => set('birthDate', e.target.value)} className={control} />
            </Field>
            <Field
              id="youth-gender"
              label="Gender"
              required
              hint="Choose a suggestion or type the entry that applies."
            >
              <ComboInput
                options={GENDER_SUGGESTIONS}
                value={form.gender}
                onChange={(e) => set('gender', e.target.value)}
                placeholder="Select or type..."
              />
            </Field>
          </div>

          <Field
            id="youth-education"
            label="Educational Attainment"
            optional
            hint="Choose a suggestion or type the level that applies."
          >
            {/* Free text, like gender: a level the six suggestions do not name — ALS, senior high —
                is recorded as such rather than forced onto the nearest wrong one. */}
            <ComboInput
              options={EDUCATION_OPTIONS.map(([, label]) => label)}
              value={form.educationalAttainment}
              onChange={(e) => set('educationalAttainment', e.target.value)}
              placeholder="Select or type..."
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Only the two province-wide roles choose. For everyone else the server forces the
                record onto their own municipality, so offering a list would be a control whose
                selection is silently discarded. */}
            <Field id="youth-municipality" label="Municipality" required={isCrossMunicipality && !editTarget}>
              {isCrossMunicipality && !editTarget ? (
                <select
                  value={form.municipality}
                  onChange={(e) => { set('municipality', e.target.value); set('barangay', ''); }}
                  className={control}
                >
                  <option value="">Select municipality...</option>
                  {municipalities.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
                </select>
              ) : (
                <input
                  value={editTarget ? (editTarget.municipality?.name || '') : (user?.municipality?.name || '')}
                  readOnly
                  disabled
                  className={`${control} cursor-not-allowed bg-gray-50 text-gray-500 dark:bg-gray-700 dark:text-gray-400`}
                />
              )}
            </Field>

            <Field id="youth-barangay" label="Barangay" optional>
              <BarangaySelect
                barangays={formBarangays}
                value={form.barangay}
                onChange={(val) => set('barangay', val)}
                disabled={!formMunId}
              />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="youth-contact" label="Contact Number" optional hint="09XXXXXXXXX or +639XXXXXXXXX">
              <input type="tel" value={form.contactNumber} onChange={(e) => set('contactNumber', e.target.value)} className={control} />
            </Field>
            <Field id="youth-email" label="Email" optional>
              <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={control} />
            </Field>
          </div>

          <Field id="youth-address" label="Street Address" optional>
            <input value={form.address} onChange={(e) => set('address', e.target.value)} className={control} placeholder="House no., street name" />
          </Field>

          <Field id="youth-occupation" label="Occupation" optional>
            <input value={form.occupation} onChange={(e) => set('occupation', e.target.value)} className={control} />
          </Field>

          <div className="flex flex-wrap items-center gap-6 pt-1">
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={form.isRegisteredVoter}
                onChange={(e) => set('isRegisteredVoter', e.target.checked)}
                className="h-4 w-4 accent-navy-900"
              />
              <span className="text-sm text-gray-700 dark:text-gray-300">Registered Voter</span>
            </label>
            {editTarget && (
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => set('isActive', e.target.checked)}
                  className="h-4 w-4 accent-navy-900"
                />
                <span className="text-sm text-gray-700 dark:text-gray-300">Active Member</span>
              </label>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
