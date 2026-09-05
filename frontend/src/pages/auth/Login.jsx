import { useState, useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, useReducedMotion } from 'framer-motion';
import { Eye, EyeOff, LogIn, Shield, Check, AlertCircle } from 'lucide-react';
import { authService } from '../../services/authService';
import useAuthStore from '../../store/authStore';
import { toast } from '../../components/ui/toaster';
import { Field, control } from '../../components/shared/FormField';
import { LOGIN_NOTICES } from '../../utils/constants';

const schema = z.object({
  email: z.string().min(1, 'Email is required').email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required'),
});

// QA helper — shows seeded test accounts on the login page.
// Visible in dev, or in any build where VITE_SHOW_QA_CREDS=true. MUST be OFF (flag unset)
// for the public production build — see go-live checklist (demo accounts use a shared password).
const SHOW_QA_CREDS = import.meta.env.DEV || import.meta.env.VITE_SHOW_QA_CREDS === 'true';
// Gate the data itself behind the build flag (not just the UI) so the seeded emails and the
// shared QA password are dead-code-eliminated from the public production bundle. When
// SHOW_QA_CREDS folds to a static `false` at build time, esbuild drops the unreachable branch.
const QA_PASSWORD = SHOW_QA_CREDS ? 'Admin@123' : '';
const QA_ACCOUNTS = SHOW_QA_CREDS ? [
  { role: 'Super Admin', email: 'superadmin@skims.gov.ph' },
  { role: 'Provincial Admin', email: 'provincial@skims.gov.ph' },
  { role: 'Municipal Admin · Boac', email: 'municipal@boac.gov.ph' },
  { role: 'SK Chairperson · Boac', email: 'juan@boac.gov.ph' },
  { role: 'SK Treasurer · Boac', email: 'maria@boac.gov.ph' },
  { role: 'SK Chairperson · Sta. Cruz', email: 'pedro@stac.gov.ph' },
  { role: 'SK Secretary · Gasan', email: 'ana@gasan.gov.ph' },
  { role: 'DILG Representative', email: 'dilg@marinduque.gov.ph' },
  /*
   * Two sample youth, not all forty. Every seeded member has their own login on the same password,
   * but listing them would bury the staff accounts this panel exists to show — and it is currently
   * switched on for the public production site. The rest follow the same pattern:
   * firstname.lastname@example.com, as shown in the youth registry.
   *
   * Two rather than one, and deliberately from different municipalities: a single youth account
   * cannot demonstrate isolation. Signed in as each in turn, neither sees the other's programs,
   * which is the check a reviewer actually needs to make from the youth side.
   */
  { role: 'Youth Member · Boac', email: 'jose.santos@example.com' },
  { role: 'Youth Member · Mogpog', email: 'antonio.torres@example.com' },
] : [];

const FEATURES = [
  'Program & Fund Management',
  'Compliance & Document Tracking',
  'Real-time Monitoring & Analytics',
  'Public Transparency Portal',
];

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setAuth } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showQA, setShowQA] = useState(false);
  /*
   * The sign-in failure, kept on the page rather than only in a toast. A toast is transient by
   * design and this one competed with a full page reload the interceptor used to trigger, so the
   * reason a sign-in failed could vanish before it was read. This stays until the next attempt.
   */
  const [signInError, setSignInError] = useState('');
  const reduceMotion = useReducedMotion();

  /*
   * `reason` is resolved against a fixed map rather than displayed as given. It used to be
   * rendered verbatim, and it is only ever set by the API client after a failed token refresh —
   * so the free-text pass-through bought nothing, while letting anyone hand out a link that puts
   * an arbitrary message in the app's own error toast on the real domain.
   */
  useEffect(() => {
    const notice = LOGIN_NOTICES[searchParams.get('reason')];
    if (notice) toast.error(notice);
  }, [searchParams]);

  const { register, handleSubmit, setValue, setFocus, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
  });

  const fillCredentials = (email) => {
    setValue('email', email, { shouldValidate: true });
    setValue('password', QA_PASSWORD, { shouldValidate: true });
  };

  const onSubmit = async (data) => {
    setLoading(true);
    setSignInError('');
    try {
      const res = await authService.login(data);
      setAuth(res.data.data.user);
      toast.success(`Welcome back, ${res.data.data.user.firstName}!`);
      navigate('/dashboard');
    } catch (err) {
      const message = err.message || 'Login failed. Please check your credentials.';
      setSignInError(message);
      toast.error(message);
      // Returning focus to the form means the next attempt does not start with a hunt for the
      // field; the toast is transient, and the banner above carries the reason regardless.
      setFocus('password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-950 via-navy-900 to-navy-800 p-4">
      <div className="grid w-full max-w-4xl overflow-hidden rounded-2xl bg-white shadow-2xl md:grid-cols-2">
        <div className="relative hidden flex-col overflow-hidden bg-navy-900 p-10 text-white md:flex">
          <div className="absolute inset-0 bg-gradient-to-br from-navy-900 to-navy-950 opacity-90" />
          <div className="relative z-10">
            <div className="mb-10 flex items-center gap-3">
              <span className="h-12 w-12 overflow-hidden rounded-xl bg-white">
                <img src="/main_logo.jfif" alt="" className="h-full w-full object-contain" />
              </span>
              <div>
                <div className="text-xl font-bold">SKIMS</div>
                <div className="text-xs text-navy-400">v1.0 — Marinduque, Philippines</div>
              </div>
            </div>

            {/* The system's full name. The heading previously read "Integrated Management",
                dropping "Program and Fund" — the two things the platform actually manages. */}
            <h1 className="mb-3 text-3xl font-bold leading-tight">
              Sangguniang Kabataan<br />Integrated Program and Fund<br />Management System
            </h1>
            <p className="mb-8 text-sm leading-relaxed text-navy-300">
              Digitizing youth governance across Boac, Gasan, Mogpog, and Sta. Cruz municipalities.
            </p>

            <ul className="space-y-3">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3 text-sm text-navy-200">
                  {/* Was a "✓" character in a span, which screen readers read aloud as
                      "check mark" before every item. */}
                  <span aria-hidden="true" className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gold-500">
                    <Check size={12} className="text-navy-900" strokeWidth={3} />
                  </span>
                  {f}
                </li>
              ))}
            </ul>
          </div>

          <div className="relative z-10 mt-auto">
            <p className="flex items-center gap-2 border-t border-navy-800 pt-6 text-xs text-navy-500">
              <Shield size={12} aria-hidden="true" />
              Secured with JWT Authentication &amp; Role-Based Access
            </p>
          </div>
        </div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={reduceMotion ? { duration: 0 } : undefined}
          className="flex flex-col justify-center p-8 lg:p-10"
        >
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Welcome back</h2>
            <p className="mt-1 text-sm text-gray-500">Sign in to your SKIMS account</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
            {/* role="alert" so it is announced, not only seen. */}
            {signInError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
                <span>{signInError}</span>
              </div>
            )}
            <Field id="email" label="Email Address" required error={errors.email}>
              <input
                {...register('email')}
                type="email"
                autoComplete="email"
                placeholder="yourname@municipality.gov.ph"
                className={control}
              />
            </Field>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                  Password
                </label>
                <Link to="/forgot-password" className="text-xs text-navy-700 hover:underline">
                  Forgot password?
                </Link>
              </div>
              <div className="relative">
                <input
                  {...register('password')}
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  aria-invalid={errors.password ? 'true' : undefined}
                  aria-describedby={errors.password ? 'password-error' : undefined}
                  className={`${control} mt-0 pr-12`}
                />
                <button
                  type="button"
                  onClick={() => setShowPass((v) => !v)}
                  // Announced as an unlabelled button, and its state was invisible to anyone
                  // not looking at the icon.
                  aria-label={showPass ? 'Hide password' : 'Show password'}
                  aria-pressed={showPass}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPass ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
                </button>
              </div>
              {errors.password && (
                <p id="password-error" className="field-error" role="alert">
                  {errors.password.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-navy-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
            >
              {loading ? (
                <>
                  <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                  Signing in...
                </>
              ) : (
                <><LogIn size={16} aria-hidden="true" />Sign In</>
              )}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-500">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="font-semibold text-navy-700 hover:underline">Register here</Link>
          </p>

          {SHOW_QA_CREDS && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => setShowQA((v) => !v)}
                aria-expanded={showQA}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 py-2.5 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-100"
              >
                {showQA ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                {showQA ? 'Hide QA test credentials' : 'Show QA test credentials'}
              </button>

              {showQA && (
                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <p className="mb-2 text-[11px] text-amber-700">
                    QA only — every account uses password <strong>{QA_PASSWORD}</strong>. Click a role to auto-fill.
                  </p>
                  <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
                    {QA_ACCOUNTS.map((a) => (
                      <li key={a.email}>
                        <button
                          type="button"
                          onClick={() => fillCredentials(a.email)}
                          aria-label={`Fill credentials for ${a.role}`}
                          className="w-full rounded-lg border border-amber-100 bg-white px-3 py-1.5 text-left transition-colors hover:border-amber-300 hover:bg-amber-50"
                        >
                          <span className="block text-xs font-medium text-gray-800">{a.role}</span>
                          <span className="block font-mono text-[11px] text-gray-500">{a.email}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
