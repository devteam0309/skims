import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, ArrowLeft } from 'lucide-react';
import { authService } from '../../services/authService';
import { toast } from '../../components/ui/toaster';
import AuthCard from '../../components/layout/AuthCard';
import { Field, control } from '../../components/shared/FormField';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await authService.forgotPassword(email);
      setSent(true);
    } catch (err) {
      toast.error(err.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard
      icon={Mail}
      title="Forgot Password"
      subtitle="Enter your email and we'll send a reset link"
    >
      {sent ? (
        <div className="text-center">
          {/*
            The server deliberately answers "If that email is registered, a password reset link
            has been sent" for every address, so it cannot be used to discover who holds an
            account. This screen used to reply "Reset link sent to <address>. Check your inbox." —
            a definite claim the server had pointedly refused to make, which also left anyone who
            mistyped their address waiting for mail that was never going to arrive.
          */}
          <div role="status" className="mb-6 rounded-xl border border-green-200 bg-green-50 p-4 text-left">
            <p className="text-sm text-green-800">
              If <strong className="break-all">{email}</strong> is registered, a reset link is on its way.
            </p>
            <p className="mt-2 text-xs text-green-700">
              It can take a few minutes. Check your spam folder, and contact your administrator if
              nothing arrives.
            </p>
          </div>
          <Link to="/login" className="text-sm font-semibold text-navy-700 hover:underline">
            Back to Login
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <Field id="email" label="Email Address" required>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              autoFocus
              placeholder="yourname@municipality.gov.ph"
              className={control}
            />
          </Field>

          <button
            type="submit"
            disabled={loading || !email}
            className="w-full rounded-xl bg-navy-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>

          <Link to="/login" className="mt-2 flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700">
            <ArrowLeft size={14} aria-hidden="true" /> Back to Login
          </Link>
        </form>
      )}
    </AuthCard>
  );
}
