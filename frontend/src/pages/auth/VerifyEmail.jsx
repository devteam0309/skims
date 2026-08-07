import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { CheckCircle2, XCircle, Loader2, MailCheck } from 'lucide-react';
import { authService } from '../../services/authService';
import AuthCard from '../../components/layout/AuthCard';

export default function VerifyEmail() {
  const { token } = useParams();
  const [status, setStatus] = useState('loading');
  const called = useRef(false);

  useEffect(() => {
    // React 18 StrictMode mounts effects twice in development; the guard keeps the endpoint from
    // being hit a second time with a token the first call may already have consumed.
    if (called.current) return;
    called.current = true;
    authService.verifyEmail(token)
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  return (
    <AuthCard icon={status === 'loading' ? MailCheck : undefined} title={TITLES[status]}>
      {/*
        The three states swapped silently: a screen reader was told nothing when "Verifying your
        email..." became either outcome, because nothing on the page was a live region. This is
        the whole content of the page, so it announces itself.
      */}
      <div role="status" aria-live="polite" className="text-center">
        {status === 'loading' && (
          <>
            <Loader2 size={32} className="mx-auto mb-4 animate-spin text-navy-700" aria-hidden="true" />
            <p className="text-sm text-gray-500">Verifying your email...</p>
          </>
        )}

        {status === 'success' && (
          <>
            <CheckCircle2 size={56} className="mx-auto mb-4 text-green-500" aria-hidden="true" />
            <p className="mb-6 text-gray-500">Your account has been verified. You may now log in.</p>
            <Link
              to="/login"
              className="inline-block rounded-xl bg-navy-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
            >
              Go to Login
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle size={56} className="mx-auto mb-4 text-red-500" aria-hidden="true" />
            <p className="mb-6 text-gray-500">
              The link is invalid or has expired. Verification links last 24 hours — request a new
              one from the login page.
            </p>
            {/* Previously a bare "Back to Login", which is not the action this state needs:
                the user cannot log in until they have verified. */}
            <Link
              to="/login"
              className="inline-block rounded-xl bg-navy-900 px-6 py-3 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
            >
              Request a new link
            </Link>
          </>
        )}
      </div>
    </AuthCard>
  );
}

const TITLES = {
  loading: 'Verifying Email',
  success: 'Email Verified!',
  error: 'Verification Failed',
};
