import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Eye, EyeOff, UserPlus } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { authService } from '../../services/authService';
import { municipalityService } from '../../services/documentService';
import { ROLE_LABELS } from '../../utils/constants';
import { toast } from '../../components/ui/toaster';

const schema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').regex(/(?=.*[A-Z])(?=.*[0-9])/, 'Must contain uppercase and number'),
  confirmPassword: z.string(),
  role: z.string().min(1, 'Please select a role'),
  municipality: z.string().optional(),
  contactNumber: z.string().optional().refine((v) => !v || /^(09|\+639)\d{9}$/.test(v), {
    message: 'Use PH format: 09XXXXXXXXX or +639XXXXXXXXX',
  }),
}).refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

const ALLOWED_ROLES = Object.entries(ROLE_LABELS).filter(([k]) => k !== 'super_admin');

export default function Register() {
  const navigate = useNavigate();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: munData } = useQuery({
    queryKey: ['municipalities-public'],
    queryFn: () => municipalityService.getAll().then((r) => r.data.data),
  });

  const { register, handleSubmit, watch, formState: { errors } } = useForm({ resolver: zodResolver(schema) });
  const role = watch('role');
  const needsMunicipality = role && role !== 'provincial_admin' && role !== 'public_user';

  const onSubmit = async (data) => {
    const { confirmPassword, ...payload } = data;
    setLoading(true);
    try {
      await authService.register(payload);
      toast.success('Registration successful! Please check your email to verify your account.');
      navigate('/login');
    } catch (err) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-950 to-navy-900 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden"
      >
        <div className="bg-navy-900 px-8 py-6 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-white">
              <img src="/main_logo.jfif" alt="SKIMS" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="font-bold text-lg">SKIMS Registration</h1>
              <p className="text-navy-400 text-xs">Create your account</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {[['firstName', 'First Name'], ['lastName', 'Last Name']].map(([name, label]) => (
              <div key={name}>
                <label className="form-label">{label}</label>
                <input {...register(name)} className="mt-1 w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700 focus:border-transparent placeholder-gray-400" />
                {errors[name] && <p className="mt-1 text-xs text-red-500">{errors[name].message}</p>}
              </div>
            ))}
          </div>

          <div>
            <label className="form-label">Email Address</label>
            <input {...register('email')} type="email" className="mt-1 w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700 focus:border-transparent placeholder-gray-400" />
            {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
          </div>

          <div>
            <label className="form-label">Role</label>
            <select {...register('role')} className="mt-1 w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700">
              <option value="">Select your role...</option>
              {ALLOWED_ROLES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            {errors.role && <p className="mt-1 text-xs text-red-500">{errors.role.message}</p>}
          </div>

          {needsMunicipality && (
            <div>
              <label className="form-label">Municipality</label>
              <select {...register('municipality')} className="mt-1 w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700">
                <option value="">Select municipality...</option>
                {munData?.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="form-label">Contact Number (optional)</label>
            <input {...register('contactNumber')} type="tel" placeholder="09XXXXXXXXX" className="mt-1 w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700 focus:border-transparent placeholder-gray-400" />
            {errors.contactNumber && <p className="mt-1 text-xs text-red-500">{errors.contactNumber.message}</p>}
          </div>

          {[['password', 'Password'], ['confirmPassword', 'Confirm Password']].map(([name, label]) => (
            <div key={name}>
              <label className="form-label">{label}</label>
              <div className="relative mt-1">
                <input {...register(name)} type={showPass ? 'text' : 'password'}
                  className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700 pr-10 focus:border-transparent placeholder-gray-400" />
                {name === 'password' && (
                  <button type="button" onClick={() => setShowPass(!showPass)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                )}
              </div>
              {errors[name] && <p className="mt-1 text-xs text-red-500">{errors[name].message}</p>}
            </div>
          ))}

          <button type="submit" disabled={loading}
            className="w-full bg-navy-900 text-white py-3 rounded-xl font-semibold text-sm hover:bg-navy-800 disabled:opacity-60 transition-all flex items-center justify-center gap-2 mt-2">
            {loading ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <UserPlus size={16} />}
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>

          <p className="text-center text-sm text-gray-500">
            Already have an account? <Link to="/login" className="text-navy-700 font-semibold">Sign in</Link>
          </p>
        </form>
      </motion.div>
    </div>
  );
}
