import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Eye, EyeOff, LogIn, Shield } from 'lucide-react';
import { authService } from '../../services/authService';
import useAuthStore from '../../store/authStore';
import { toast } from '../../components/ui/toaster';

const schema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(1, 'Password is required'),
});

// QA helper — shows seeded test accounts on the login page.
// Visible in dev, or in any build where VITE_SHOW_QA_CREDS=true. MUST be OFF (flag unset)
// for the public production build — see go-live checklist (demo accounts use a shared password).
const SHOW_QA_CREDS = import.meta.env.DEV || import.meta.env.VITE_SHOW_QA_CREDS === 'true';
const QA_PASSWORD = 'Admin@123';
const QA_ACCOUNTS = [
  { role: 'Super Admin', email: 'superadmin@skims.gov.ph' },
  { role: 'Provincial Admin', email: 'provincial@skims.gov.ph' },
  { role: 'Municipal Admin · Boac', email: 'municipal@boac.gov.ph' },
  { role: 'SK Chairperson · Boac', email: 'juan@boac.gov.ph' },
  { role: 'SK Treasurer · Boac', email: 'maria@boac.gov.ph' },
  { role: 'SK Chairperson · Sta. Cruz', email: 'pedro@stac.gov.ph' },
  { role: 'SK Secretary · Gasan', email: 'ana@gasan.gov.ph' },
  { role: 'SK Chairperson · Buenavista', email: 'liza@buenavista.gov.ph' },
  { role: 'SK Chairperson · Torrijos', email: 'ramon@torrijos.gov.ph' },
  { role: 'DILG Representative', email: 'dilg@marinduque.gov.ph' },
  { role: 'Public User', email: 'youth@example.com' },
];

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showQA, setShowQA] = useState(false);

  useEffect(() => {
    const reason = searchParams.get('reason');
    if (reason) toast.error(reason);
  }, []);

  const { register, handleSubmit, setValue, formState: { errors } } = useForm({ resolver: zodResolver(schema) });

  const fillCredentials = (email) => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', QA_PASSWORD, { shouldValidate: true });
  };

  const onSubmit = async (data) => {
    setLoading(true);
    try {
      const res = await authService.login(data);
      setAuth(res.data.data.user);
      toast.success('Welcome back, ' + res.data.data.user.firstName + '!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800 flex items-center justify-center p-4">
      <div className="w-full max-w-4xl grid md:grid-cols-2 gap-0 bg-white rounded-2xl shadow-2xl overflow-hidden">
        {/* Left panel */}
        <div className="hidden md:flex flex-col bg-navy-900 p-10 text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-navy-900 to-navy-950 opacity-90" />
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-10">
              <div className="w-12 h-12 rounded-xl overflow-hidden bg-white">
                <img src="/main_logo.jfif" alt="SKIMS" className="w-full h-full object-contain" />
              </div>
              <div>
                <div className="font-bold text-xl">SKIMS</div>
                <div className="text-navy-400 text-xs">v1.0 — Marinduque, Philippines</div>
              </div>
            </div>
            <h1 className="text-3xl font-bold mb-3 leading-tight">
              Sangguniang Kabataan<br />Integrated Management
            </h1>
            <p className="text-navy-300 text-sm mb-8 leading-relaxed">
              Digitizing youth governance across Boac, Buenavista, Gasan, Mogpog, Sta. Cruz, and Torrijos municipalities.
            </p>
            <div className="space-y-3">
              {[
                'Program & Fund Management',
                'Compliance & Document Tracking',
                'Real-time Monitoring & Analytics',
                'Public Transparency Portal',
              ].map((f) => (
                <div key={f} className="flex items-center gap-3 text-sm text-navy-200">
                  <div className="w-5 h-5 bg-gold-500 rounded-full flex items-center justify-center flex-shrink-0">
                    <span className="text-navy-900 text-xs font-bold">✓</span>
                  </div>
                  {f}
                </div>
              ))}
            </div>
          </div>
          <div className="relative z-10 mt-auto">
            <div className="border-t border-navy-800 pt-6 flex items-center gap-2 text-xs text-navy-500">
              <Shield size={12} />
              Secured with JWT Authentication & Role-Based Access
            </div>
          </div>
        </div>

        {/* Right panel */}
        <motion.div
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          className="p-8 lg:p-10 flex flex-col justify-center"
        >
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
            <p className="text-gray-500 text-sm mt-1">Sign in to your SKIMS account</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
              <input
                {...register('email')}
                type="email"
                placeholder="yourname@municipality.gov.ph"
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700 focus:border-transparent transition-all placeholder-gray-400"
              />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="block text-sm font-medium text-gray-700">Password</label>
                <Link to="/forgot-password" className="text-xs text-navy-700 hover:text-navy-900">Forgot password?</Link>
              </div>
              <div className="relative">
                <input
                  {...register('password')}
                  type={showPass ? 'text' : 'password'}
                  placeholder="Enter your password"
                  className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700 focus:border-transparent pr-12 transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {errors.password && <p className="mt-1 text-xs text-red-500">{errors.password.message}</p>}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-navy-900 text-white py-3 rounded-xl font-semibold text-sm hover:bg-navy-800 disabled:opacity-60 transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <><span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />Signing in...</>
              ) : (
                <><LogIn size={16} />Sign In</>
              )}
            </button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-sm text-gray-500">
              Don't have an account?{' '}
              <Link to="/register" className="text-navy-700 font-semibold hover:text-navy-900">Register here</Link>
            </p>
          </div>

          {/* QA test credentials — gated by SHOW_QA_CREDS (off in public production build) */}
          {SHOW_QA_CREDS && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowQA((v) => !v)}
                className="w-full flex items-center justify-center gap-2 text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl py-2.5 hover:bg-amber-100 transition-colors"
              >
                {showQA ? <EyeOff size={14} /> : <Eye size={14} />}
                {showQA ? 'Hide QA test credentials' : 'Show QA test credentials'}
              </button>

              {showQA && (
                <div className="mt-2 p-3 bg-amber-50/60 border border-amber-200 rounded-xl">
                  <p className="text-[11px] text-amber-700 mb-2">
                    QA only — every account uses password <strong>{QA_PASSWORD}</strong>. Click a role to auto-fill.
                  </p>
                  <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
                    {QA_ACCOUNTS.map((a) => (
                      <button
                        key={a.email}
                        type="button"
                        onClick={() => fillCredentials(a.email)}
                        className="w-full text-left px-3 py-1.5 rounded-lg bg-white border border-amber-100 hover:border-amber-300 hover:bg-amber-50 transition-colors"
                      >
                        <span className="block text-xs font-medium text-gray-800">{a.role}</span>
                        <span className="block text-[11px] text-gray-500 font-mono">{a.email}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
