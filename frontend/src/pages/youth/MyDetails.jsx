import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { youthService, municipalityService } from '../../services/documentService';
import { Field, control } from '../../components/shared/FormField';
import StatusBadge from '../../components/shared/StatusBadge';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { formatDate, calculateAge } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';

const EDUCATION_OPTIONS = [
  ['elementary', 'Elementary'],
  ['high_school', 'High School'],
  ['college', 'College'],
  ['vocational', 'Vocational'],
  ['graduate', 'Graduate'],
  ['out_of_school', 'Out of School'],
];

/*
 * A youth's own registry record.
 *
 * Only the contact details are editable. Name, birth date and municipality identify the person in
 * an official roster, so a correction to those goes through the SK office rather than being
 * self-served — which is also what PUT /api/youth/me enforces, so this page is not the only thing
 * standing between a member and their own identity fields.
 */
export default function MyDetails() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);

  const { data: me, isLoading } = useQuery({
    queryKey: ['youth-me'],
    queryFn: () => youthService.getMine().then((r) => r.data.data),
  });

  const municipalityId = me?.municipality?._id || me?.municipality;
  const { data: barangays = [] } = useQuery({
    queryKey: ['barangays', municipalityId],
    queryFn: () => municipalityService.getBarangays(municipalityId).then((r) => r.data.data),
    enabled: !!municipalityId,
  });

  useEffect(() => {
    if (!me) return;
    setForm({
      contactNumber: me.contactNumber || '',
      address: me.address || '',
      occupation: me.occupation || '',
      educationalAttainment: me.educationalAttainment || '',
      barangay: me.barangay?._id || me.barangay || '',
    });
  }, [me]);

  const saveMutation = useMutation({
    mutationFn: (data) => youthService.updateMine(data),
    onSuccess: () => {
      toast.success('Your details were updated');
      queryClient.invalidateQueries({ queryKey: ['youth-me'] });
    },
    onError: (e) => toast.error(e.message || 'Could not save your details'),
  });

  if (isLoading || !form) return <PageLoader />;

  const set = (key, value) => setForm((f) => ({ ...f, [key]: value }));
  const age = calculateAge(me.birthDate);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="page-title">My details</h1>
        <p className="page-subtitle">Your record in the {me.municipality?.name} youth registry</p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <h2 className="section-heading">
            {me.firstName} {me.lastName}
          </h2>
          <StatusBadge status={me.verificationStatus === 'verified' ? 'approved' : 'pending'} />
        </div>

        {/* Read-only identity. Shown rather than hidden so a member can check it is right and
            report it if not. */}
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="meta-text">Birth date</dt>
            <dd className="text-sm text-gray-900 dark:text-white">
              {formatDate(me.birthDate)}
              {age !== null && <span className="meta-text"> · <span className="numeric">{age}</span> yrs</span>}
            </dd>
          </div>
          <div>
            <dt className="meta-text">Municipality</dt>
            <dd className="text-sm text-gray-900 dark:text-white">{me.municipality?.name || '—'}</dd>
          </div>
          <div>
            <dt className="meta-text">Gender</dt>
            <dd className="text-sm text-gray-900 dark:text-white">{me.gender || '—'}</dd>
          </div>
          <div>
            <dt className="meta-text">Email</dt>
            <dd className="text-sm text-gray-900 dark:text-white">{me.email || '—'}</dd>
          </div>
        </dl>

        <p className="field-hint mt-3">
          Your name, birth date and municipality can only be changed by your SK office.
        </p>
      </section>

      <form
        className="space-y-4 rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800"
        onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form); }}
      >
        <h2 className="section-heading">Contact and background</h2>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="my-contact" label="Contact number" optional>
            <input
              value={form.contactNumber}
              onChange={(e) => set('contactNumber', e.target.value)}
              placeholder="09XXXXXXXXX"
              className={control}
            />
          </Field>
          <Field id="my-barangay" label="Barangay" optional>
            <select value={form.barangay} onChange={(e) => set('barangay', e.target.value)} className={control}>
              <option value="">Select barangay...</option>
              {barangays.map((b) => <option key={b._id} value={b._id}>{b.name}</option>)}
            </select>
          </Field>
        </div>

        <Field id="my-address" label="Address" optional>
          <input value={form.address} onChange={(e) => set('address', e.target.value)} className={control} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="my-education" label="Educational attainment" optional>
            <select
              value={form.educationalAttainment}
              onChange={(e) => set('educationalAttainment', e.target.value)}
              className={control}
            >
              <option value="">Select...</option>
              {EDUCATION_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
          <Field id="my-occupation" label="Occupation" optional>
            <input value={form.occupation} onChange={(e) => set('occupation', e.target.value)} className={control} />
          </Field>
        </div>

        <button
          type="submit"
          disabled={saveMutation.isPending}
          className="rounded-xl bg-navy-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
        >
          {saveMutation.isPending ? 'Saving...' : 'Save changes'}
        </button>
      </form>
    </div>
  );
}
