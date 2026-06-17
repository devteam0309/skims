import { useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { authService } from '../../services/authService';
import { CheckCircle2, XCircle } from 'lucide-react';

export default function VerifyEmail() {
  const { token } = useParams();
  const [status, setStatus] = useState('loading');
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;
    authService.verifyEmail(token)
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-950 to-navy-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-10 w-full max-w-md text-center">
        {status === 'loading' && <p className="text-gray-500">Verifying your email...</p>}
        {status === 'success' && (
          <>
            <CheckCircle2 size={56} className="text-green-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Email Verified!</h1>
            <p className="text-gray-500 mb-6">Your account has been verified. You may now log in.</p>
            <Link to="/login" className="bg-navy-900 text-white px-6 py-3 rounded-xl font-semibold hover:bg-navy-800 transition-colors">
              Go to Login
            </Link>
          </>
        )}
        {status === 'error' && (
          <>
            <XCircle size={56} className="text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Verification Failed</h1>
            <p className="text-gray-500 mb-6">The link is invalid or has expired. Please request a new verification email.</p>
            <Link to="/login" className="text-navy-700 font-semibold hover:underline">Back to Login</Link>
          </>
        )}
      </div>
    </div>
  );
}
