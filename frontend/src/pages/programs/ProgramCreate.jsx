import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus, X } from 'lucide-react';
import { programService } from '../../services/programService';
import { municipalityService } from '../../services/documentService';
import { budgetService } from '../../services/budgetService';
import { PROGRAM_CATEGORIES } from '../../utils/constants';
import { toast } from '../../components/ui/toaster';
import { confirm } from '../../utils/confirm';
import { Field, RequiredNote, control } from '../../components/shared/FormField';

const schema = z.object({
  title: z.string().min(5, 'Title must be at least 5 characters'),
  description: z.string().min(20, 'Description must be at least 20 characters'),
  category: z.string().min(1, 'Category is required'),
  budget: z.coerce.number().min(1, 'Budget must be greater than 0'),
  startDate: z.string().min(1, 'Start date is required'),
  endDate: z.string().min(1, 'End date is required'),
  targetParticipants: z.coerce.number().min(1, 'Target participants required'),
  municipality: z.string().optional(),
  budgetRef: z.string().optional(),
  isPublic: z.boolean().optional(),
}).refine((d) => !d.startDate || !d.endDate || new Date(d.endDate) > new Date(d.startDate), {
  message: 'End date must be after start date',
  path: ['endDate'],
});

export default function ProgramCreate() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [objectives, setObjectives] = useState(['']);
  const objectiveRefs = useRef([]);

  const { data: munData } = useQuery({
    queryKey: ['municipalities'],
    queryFn: () => municipalityService.getAll().then((r) => r.data.data),
  });

  const { data: budgetsData } = useQuery({
    queryKey: ['budgets-approved-for-program'],
    queryFn: () => budgetService.getAll({ status: 'approved', limit: 100 }).then((r) => r.data.data),
  });

  const { register, handleSubmit, setFocus, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { isPublic: true },
  });

  const mutation = useMutation({
    mutationFn: (data) => programService.create(data),
    onSuccess: () => {
      toast.success('Program created successfully!');
      queryClient.invalidateQueries(['programs']);
      navigate('/programs');
    },
    onError: (err) => toast.error(err.message || 'Failed to create program'),
  });

  const onSubmit = async (data) => {
    const result = await confirm.create({ title: 'Create Program?', text: 'You are about to create a new SK program.' });
    if (result.isConfirmed) mutation.mutate({ ...data, objectives: objectives.filter(Boolean) });
  };

  /*
   * On a rejected submit the page previously stayed where it was, so on a form this long the
   * failing field could be entirely off screen and the user saw nothing happen at all.
   * Moving focus to the first invalid field both scrolls it into view and announces it.
   */
  const onInvalid = (formErrors) => {
    const first = Object.keys(formErrors)[0];
    if (first) setFocus(first);
  };

  const addObjective = () => {
    setObjectives((prev) => [...prev, '']);
    // Focus the row that was just added, so adding several in a row does not mean
    // reaching for the mouse between each one.
    requestAnimationFrame(() => objectiveRefs.current[objectives.length]?.focus());
  };

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
        <div>
          <h1 className="page-title">Create New Program</h1>
          <p className="page-subtitle">Fill in the program details below</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit, onInvalid)} noValidate className="space-y-5">
        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="border-b border-gray-200 pb-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
            Basic Information
          </h2>
          {/* The asterisk convention was never explained anywhere on the page. */}
          <RequiredNote />

          <div className="mt-5 space-y-5">
            <Field id="title" label="Program Title" required error={errors.title}>
              <input {...register('title')} placeholder="e.g., Youth Leadership Summit 2026" className={control} />
            </Field>

            <Field id="description" label="Description" required error={errors.description} hint="At least 20 characters.">
              <textarea {...register('description')} rows={4} placeholder="Describe the program objectives and activities..." className={`${control} resize-y`} />
            </Field>

            {/* Single column on phones: two date/select columns at 360px wide left each control
                too narrow to read its own value. */}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="category" label="Category" required error={errors.category}>
                <select {...register('category')} className={control}>
                  <option value="">Select category...</option>
                  {PROGRAM_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </Field>
              <Field id="municipality" label="Municipality" error={errors.municipality}>
                <select {...register('municipality')} className={control}>
                  <option value="">Select municipality...</option>
                  {munData?.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
                </select>
              </Field>
            </div>

            <Field
              id="budgetRef"
              label="Linked Budget"
              optional
              error={errors.budgetRef}
              hint="Link this program to an approved budget to enable allocation tracking."
            >
              <select {...register('budgetRef')} className={control}>
                <option value="">No budget linked</option>
                {(budgetsData || []).map((b) => <option key={b._id} value={b._id}>{b.title} — FY {b.fiscalYear}</option>)}
              </select>
            </Field>

            <fieldset>
              <legend className="form-label">Program Objectives</legend>
              <p className="field-hint">Optional. Add one objective per line.</p>
              <div className="mt-2 space-y-2">
                {objectives.map((obj, i) => (
                  <div key={i} className="flex gap-2">
                    {/* Each row previously relied on its placeholder as its only name, and a
                        placeholder disappears the moment you type. */}
                    <label htmlFor={`objective-${i}`} className="sr-only">Objective {i + 1}</label>
                    <input
                      id={`objective-${i}`}
                      ref={(el) => { objectiveRefs.current[i] = el; }}
                      value={obj}
                      onChange={(e) => {
                        const next = [...objectives];
                        next[i] = e.target.value;
                        setObjectives(next);
                      }}
                      className={`${control} mt-0 flex-1`}
                      placeholder={`Objective ${i + 1}`}
                    />
                    {objectives.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setObjectives(objectives.filter((_, j) => j !== i))}
                        aria-label={`Remove objective ${i + 1}`}
                        className="shrink-0 rounded-xl border border-gray-300 p-2.5 text-gray-500 transition-colors hover:border-red-300 hover:text-red-600 dark:border-gray-600 dark:text-gray-400"
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addObjective}
                  className="flex items-center gap-2 text-sm font-medium text-navy-700 hover:underline dark:text-navy-300"
                >
                  <Plus size={14} aria-hidden="true" /> Add Objective
                </button>
              </div>
            </fieldset>
          </div>
        </section>

        <section className="rounded-xl border border-gray-200 bg-white p-6 dark:border-gray-700 dark:bg-gray-800">
          <h2 className="border-b border-gray-200 pb-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-white">
            Timeline &amp; Budget
          </h2>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field id="startDate" label="Start Date" required error={errors.startDate}>
              <input {...register('startDate')} type="date" className={control} />
            </Field>
            <Field id="endDate" label="End Date" required error={errors.endDate}>
              <input {...register('endDate')} type="date" className={control} />
            </Field>
            <Field id="budget" label="Budget (₱)" required error={errors.budget}>
              <input {...register('budget')} type="number" min="0" step="0.01" placeholder="0.00" className={`${control} numeric`} />
            </Field>
            <Field id="targetParticipants" label="Target Participants" required error={errors.targetParticipants}>
              <input {...register('targetParticipants')} type="number" min="1" placeholder="e.g., 100" className={`${control} numeric`} />
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
              {/* This publishes to a page anyone on the internet can read. That consequence was
                  not stated anywhere, on a control that defaults to on. */}
              <p className="field-hint">Visible to the public without signing in.</p>
            </div>
          </div>
        </section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-xl bg-navy-900 px-6 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
          >
            {mutation.isPending ? 'Creating...' : 'Create Program'}
          </button>
        </div>
      </form>
    </div>
  );
}
