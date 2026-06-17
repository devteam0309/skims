import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { programService } from '../../services/programService';
import { budgetService } from '../../services/budgetService';
import { PROGRAM_CATEGORIES } from '../../utils/constants';
import { toast } from '../../components/ui/toaster';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { confirm } from '../../utils/confirm';

const schema = z.object({
  title: z.string().min(5),
  description: z.string().min(20),
  category: z.string().min(1),
  budget: z.coerce.number().min(0),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
  targetParticipants: z.coerce.number().min(1),
  actualParticipants: z.coerce.number().min(0).optional(),
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

  const { register, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(schema) });

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
    onError: (e) => toast.error(e.message),
  });

  if (isLoading) return <PageLoader />;

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"><ArrowLeft size={20} /></button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Edit Program</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">{program?.title}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(async (d) => { const r = await confirm.save(); if (r.isConfirmed) mutation.mutate(d); })} className="space-y-5">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 space-y-5">
          {[['title', 'Program Title', 'text'], ['description', 'Description', 'textarea']].map(([name, label, type]) => (
            <div key={name}>
              <label className="form-label">{label} *</label>
              {type === 'textarea' ? (
                <textarea {...register(name)} rows={4} className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 resize-none" />
              ) : (
                <input {...register(name)} className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
              )}
              {errors[name] && <p className="mt-1 text-xs text-red-500">{errors[name].message}</p>}
            </div>
          ))}

          <div>
            <label className="form-label">Category *</label>
            <select {...register('category')} className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
              {PROGRAM_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {[['startDate', 'Start Date'], ['endDate', 'End Date']].map(([name, label]) => (
              <div key={name}>
                <label className="form-label">{label} *</label>
                <input {...register(name)} type="date" className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
                {errors[name] && <p className="mt-1 text-xs text-red-500">{errors[name].message}</p>}
              </div>
            ))}
            {[['budget', 'Budget (₱)'], ['targetParticipants', 'Target Participants'], ['actualParticipants', 'Actual Participants']].map(([name, label]) => (
              <div key={name}>
                <label className="form-label">{label}</label>
                <input {...register(name)} type="number" min="0" className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
                {errors[name] && <p className="mt-1 text-xs text-red-500">{errors[name].message}</p>}
              </div>
            ))}
          </div>

          <div>
            <label className="form-label">Linked Budget (optional)</label>
            <select {...register('budgetRef')} className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
              <option value="">No budget linked</option>
              {(budgetsData || []).map((b) => <option key={b._id} value={b._id}>{b.title} — FY {b.fiscalYear}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <input {...register('isPublic')} type="checkbox" id="isPublic" className="w-4 h-4 text-navy-700 rounded" />
            <label htmlFor="isPublic" className="text-sm text-gray-700 dark:text-gray-300">Show on Public Portal</label>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)} className="px-5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">Cancel</button>
          <button type="submit" disabled={mutation.isPending} className="px-6 py-2.5 bg-navy-900 text-white rounded-xl text-sm font-semibold hover:bg-navy-800 disabled:opacity-60">
            {mutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
