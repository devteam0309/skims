import { useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { KeyRound, AlertCircle } from 'lucide-react';
import { authService } from '../../services/authService';
import { toast } from '../../components/ui/toaster';
import AuthCard from '../../components/layout/AuthCard';
import { Field, control } from '../../components/shared/FormField';
import { PASSWORD_PATTERN, PASSWORD_RULE_TEXT } from '../../utils/constants';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  /*
   * The only check here used to be `password.length < 8`, while User.js requires an uppercase
   * letter, a digit and a special character as well. "password1" cleared the form and was then
   * refused by the server with a raw Mongoose validation message citing a rule the screen had
   * never mentioned — at the end of a reset flow, with the token already spent from the user's
   * point of view.
   */
  const tooShort = password.length > 0 && password.length < 8;
  const failsPolicy = password.length >= 8 && !PASSWORD_PATTERN.test(password);
  const mismatch = confirm.length > 0 && password !== confirm;

  const passwordError = (submitted || tooShort || failsPolicy)
    ? (tooShort ? 'Password must be at least 8 characters'
      : failsPolicy ? 'Include an uppercase letter, a number and a special character'
        : null)
    : null;
  const confirmError = mismatch ? 'Passwords do not match' : null;

  const onSubmit = async (e) => {
    e.preventDefault();
    setSubmitted(true);
    if (!PASSWORD_PATTERN.test(password)) return;
    if (password !== confirm) return;

    setLoading(true);
    try {
      await authService.resetPassword(token, password);
      toast.success('Password reset successfully!');
      navigate('/login');
    } catch (err) {
      toast.error(err.message || 'Failed to reset password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthCard icon={KeyRound} title="Reset Password" subtitle="Enter your new password">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Field
          id="newPassword"
          label="New Password"
          required
          hint={PASSWORD_RULE_TEXT}
          error={passwordError ? { message: passwordError } : undefined}
        >
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            // Without this the browser offers the old password and never prompts to update the
            // saved one — the single place where updating it matters most.
            autoComplete="new-password"
            autoFocus
            className={control}
          />
        </Field>

        <Field
          id="confirmPassword"
          label="Confirm Password"
          required
          error={confirmError ? { message: confirmError } : undefined}
        >
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            className={control}
          />
        </Field>

        {/* A mismatch used to surface only as a toast after pressing the button. */}
        {mismatch && (
          <p className="flex items-center gap-1.5 text-xs text-red-600" role="alert">
            <AlertCircle size={12} aria-hidden="true" className="shrink-0" />
            The two passwords must match.
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-xl bg-navy-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
        >
          {loading ? 'Resetting...' : 'Reset Password'}
        </button>

        <Link to="/login" className="block text-center text-sm text-gray-500 hover:text-gray-700">
          Back to Login
        </Link>
      </form>
    </AuthCard>
  );
}
