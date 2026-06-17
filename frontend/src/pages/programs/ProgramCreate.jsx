import { useState } from 'react';
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
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';

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
  const { user } = useAuthStore();
  const [objectives, setObjectives] = useState(['']);

  const { data: munData } = useQuery({
    queryKey: ['municipalities'],
    queryFn: () => municipalityService.getAll().then((r) => r.data.data),
  });

  const { data: budgetsData } = useQuery({
    queryKey: ['budgets-approved-for-program'],
    queryFn: () => budgetService.getAll({ status: 'approved', limit: 100 }).then((r) => r.data.data),
  });

  const { register, handleSubmit, formState: { errors } } = useForm({
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

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Create New Program</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">Fill in the program details below</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 space-y-5">
          <h2 className="font-semibold text-gray-900 dark:text-white pb-3 border-b border-gray-100 dark:border-gray-700">Basic Information</h2>

          <div>
            <label className="form-label">Program Title *</label>
            <input {...register('title')} className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" placeholder="e.g., Youth Leadership Summit 2026" />
            {errors.title && <p className="mt-1 text-xs text-red-500">{errors.title.message}</p>}
          </div>

          <div>
            <label className="form-label">Description *</label>
            <textarea {...register('description')} rows={4}
              className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 resize-none"
              placeholder="Describe the program objectives and activities..." />
            {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Category *</label>
              <select {...register('category')} className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
                <option value="">Select category...</option>
                {PROGRAM_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              {errors.category && <p className="mt-1 text-xs text-red-500">{errors.category.message}</p>}
            </div>
            <div>
              <label className="form-label">Municipality</label>
              <select {...register('municipality')} className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
                <option value="">Select municipality...</option>
                {munData?.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="form-label">Linked Budget (optional)</label>
            <select {...register('budgetRef')} className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 bg-white">
              <option value="">No budget linked</option>
              {(budgetsData || []).map((b) => <option key={b._id} value={b._id}>{b.title} — FY {b.fiscalYear}</option>)}
            </select>
            <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">Link this program to an approved budget to enable allocation tracking</p>
          </div>

          {/* Objectives */}
          <div>
            <label className="form-label">Program Objectives</label>
            <div className="mt-1 space-y-2">
              {objectives.map((obj, i) => (
                <div key={i} className="flex gap-2">
                  <input
                    value={obj}
                    onChange={(e) => { const newObjs = [...objectives]; newObjs[i] = e.target.value; setObjectives(newObjs); }}
                    className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700"
                    placeholder={`Objective ${i + 1}`}
                  />
                  {objectives.length > 1 && (
                    <button type="button" onClick={() => setObjectives(objectives.filter((_, j) => j !== i))}
                      className="p-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500 hover:text-red-500 hover:border-red-200 transition-colors">
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setObjectives([...objectives, ''])}
                className="flex items-center gap-2 text-sm text-navy-700 hover:text-navy-900 font-medium">
                <Plus size={14} /> Add Objective
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 space-y-5">
          <h2 className="font-semibold text-gray-900 dark:text-white pb-3 border-b border-gray-100 dark:border-gray-700">Timeline & Budget</h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="form-label">Start Date *</label>
              <input {...register('startDate')} type="date" className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
              {errors.startDate && <p className="mt-1 text-xs text-red-500">{errors.startDate.message}</p>}
            </div>
            <div>
              <label className="form-label">End Date *</label>
              <input {...register('endDate')} type="date" className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
              {errors.endDate && <p className="mt-1 text-xs text-red-500">{errors.endDate.message}</p>}
            </div>
            <div>
              <label className="form-label">Budget (₱) *</label>
              <input {...register('budget')} type="number" min="0" step="0.01"
                className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" placeholder="0.00" />
              {errors.budget && <p className="mt-1 text-xs text-red-500">{errors.budget.message}</p>}
            </div>
            <div>
              <label className="form-label">Target Participants *</label>
              <input {...register('targetParticipants')} type="number" min="1"
                className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" placeholder="e.g., 100" />
              {errors.targetParticipants && <p className="mt-1 text-xs text-red-500">{errors.targetParticipants.message}</p>}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <input {...register('isPublic')} type="checkbox" id="isPublic" className="w-4 h-4 text-navy-700 rounded" defaultChecked />
            <label htmlFor="isPublic" className="text-sm text-gray-700 dark:text-gray-300">Show on Public Transparency Portal</label>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="px-5 py-2.5 border border-gray-200 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={mutation.isPending}
            className="px-6 py-2.5 bg-navy-900 text-white rounded-xl text-sm font-semibold hover:bg-navy-800 disabled:opacity-60 transition-colors">
            {mutation.isPending ? 'Creating...' : 'Create Program'}
          </button>
        </div>
      </form>
    </div>
  );
}
