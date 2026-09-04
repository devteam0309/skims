import { useParams, useNavigate, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { programService } from '../../services/programService';
import { budgetService } from '../../services/budgetService';
import ComboInput from '../../components/shared/ComboInput';
import { PROGRAM_CATEGORIES } from '../../utils/constants';
import { toast } from '../../components/ui/toaster';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { confirm } from '../../utils/confirm';
import { Field, RequiredNote, control } from '../../components/shared/FormField';

/*
 * Messages are spelled out rather than left to Zod's defaults. Unmessaged rules surfaced as
 * "String must contain at least 20 character(s)" under the Description box, which names the
 * constraint but not what the user should do about it — and differed in wording from the create
 * form, which validates the same program with the same rules.
 */
const schema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters'),
  description: z.string().min(20, 'Description must be at least 20 characters'),
  category: z.string().min(1, 'Category is required'),
  budget: z.coerce.number({ invalid_type_error: 'Budget must be a number' }).min(0, 'Budget cannot be negative'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  targetParticipants: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(1, 'Target participants required'),
  actualParticipants: z.coerce.number({ invalid_type_error: 'Enter a number' }).min(0, 'Cannot be negative').optional(),
  budgetRef: z.string().optional(),
  isPublic: z.boolean().optional(),
}).refine((d) => !d.startDate || !d.endDate || new Date(d.endDate) > new Date(d.startDate), {
  message: 'End date must be after start date',
  path: ['endDate'],
});

export default function ProgramEdit() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: program, isLoading } = useQuery({
    queryKey: ['program', id],
    queryFn: () => programService.getById(id).then((r) => r.data.data),
  });

  const { data: budgetsData } = useQuery({
    queryKey: ['budgets-approved-for-program'],
    queryFn: () => budgetService.getAll({ status: 'approved', limit: 100 }).then((r) => r.data.data),
  });

  const {
    register,
    handleSubmit,
    reset,
    setFocus,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (program) {
      reset({
        ...program,
        startDate: program.startDate?.slice(0, 10),
        endDate: program.endDate?.slice(0, 10),
        budgetRef: program.budgetRef?._id || program.budgetRef || '',
      });
    }
  }, [program, reset]);

  const mutation = useMutation({
    mutationFn: (data) => programService.update(id, data),
    onSuccess: () => {
      toast.success('Program updated');
      queryClient.invalidateQueries(['program', id]);
      queryClient.invalidateQueries(['programs']);
      navigate(`/programs/${id}`);
    },
    onError: (e) => toast.error(e.message || 'Failed to update program'),
  });

  const onSubmit = async (data) => {
    const result = await confirm.save();
    if (result.isConfirmed) mutation.mutate(data);
  };

  // A rejected submit on a form this long can leave the failing field off screen, so the user
  // sees the page simply not respond. Focusing the first invalid field scrolls to it and
  // announces it. Matches the create form.
  const onInvalid = (formErrors) => {
    const first = Object.keys(formErrors)[0];
    if (first) setFocus(first);
  };

  if (isLoading) return <PageLoader />;

  // The query can resolve to nothing — a deleted program, or an id typed by hand. This
  // previously rendered the full form bound to `undefined`: every field blank, and saving it
  // would have posted an empty program back.
  if (!program) {
    return (
      <div className="mx-auto max-w-3xl rounded-xl border border-gray-200 bg-white py-16 text-center dark:border-gray-700 dark:bg-gray-800">
        <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Program not found</p>
        <p className="meta-text mt-1">It may have been deleted.</p>
        <Link to="/programs" className="mt-3 inline-block text-sm font-medium text-navy-700 hover:underline dark:text-navy-300">
          Back to programs
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate(-1)}
          aria-label="Go back"
          className="rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700"
        >
          <ArrowLeft size={20} aria-hidden="true" />
        </button>
        <div className="min-w-0">
          <h1 className="page-title">Edit Program</h1>
          <p className="page-subtitle truncate">{program.title}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="space-y-5">
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="border-b border-gray-200 pb-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
            Basic Information
          </h2>
          <RequiredNote />

          <div className="mt-5 space-y-5">
            <Field id="title" label="Program Title" required error={errors.title}>
              <input {...register('title')} className={control} />
            </Field>

            <Field id="description" label="Description" required error={errors.description} hint="At least 20 characters.">
              <textarea {...register('description')} rows={4} className={`${control} resize-y`} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="category" label="Category" required error={errors.category}>
                {/*
                  * Type-or-pick, matching the create form — which already used ComboInput while
                  * this stayed a fixed <select>, so a category typed on create could not be read
                  * back or kept on edit. A stored value outside the suggestion list had no
                  * matching <option> at all: the control rendered blank and quietly rewrote the
                  * category on the next save.
                  */}
                <ComboInput
                  {...register('category')}
                  options={PROGRAM_CATEGORIES}
                  placeholder="Select or type a category..."
                />
              </Field>

              <Field
                id="budgetRef"
                label="Linked Budget"
                optional
                error={errors.budgetRef}
                hint="Only approved budgets can be linked."
              >
                <select {...register('budgetRef')} className={control}>
                  <option value="">No budget linked</option>
                  {(budgetsData || []).map((b) => <option key={b._id} value={b._id}>{b.title} — FY {b.fiscalYear}</option>)}
                </select>
              </Field>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="border-b border-gray-200 pb-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
            Timeline &amp; Participation
          </h2>

          {/* Single column on phones — two date controls at 360px wide leave neither wide enough
              to show its own value. Matches the create form. */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field id="startDate" label="Start Date" required error={errors.startDate}>
              <input {...register('startDate')} type="date" className={control} />
            </Field>
            <Field id="endDate" label="End Date" required error={errors.endDate}>
              <input {...register('endDate')} type="date" className={control} />
            </Field>
            <Field id="budget" label="Budget (₱)" required error={errors.budget}>
              <input {...register('budget')} type="number" min="0" step="0.01" className={`${control} numeric`} />
            </Field>
            <Field id="targetParticipants" label="Target Participants" required error={errors.targetParticipants}>
              <input {...register('targetParticipants')} type="number" min="1" className={`${control} numeric`} />
            </Field>
            <Field
              id="actualParticipants"
              label="Actual Participants"
              optional
              error={errors.actualParticipants}
              hint="Attendance recorded so far. Drives the completion figure."
            >
              <input {...register('actualParticipants')} type="number" min="0" className={`${control} numeric`} />
            </Field>
          </div>

          <div className="mt-5 flex items-start gap-3">
            <input
              {...register('isPublic')}
              type="checkbox"
              id="isPublic"
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-navy-700"
            />
            <div>
              <label htmlFor="isPublic" className="text-sm font-medium text-gray-700 dark:text-gray-300">
                Show on Public Transparency Portal
              </label>
              {/* Toggling this off unpublishes a page the public may already be linking to.
                  Neither direction was stated on the control. */}
              <p className="field-hint">Visible to the public without signing in.</p>
            </div>
          </div>
        </section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          {/* Nothing on the page previously indicated whether there was anything to save. */}
          {!isDirty && !mutation.isPending && (
            <p className="meta-text sm:mr-auto">No changes yet.</p>
          )}
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending || !isDirty}
            className="rounded-xl bg-navy-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
