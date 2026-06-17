import { useState } from 'react';
import { Link } from 'react-router-dom';
import { authService } from '../../services/authService';
import { toast } from '../../components/ui/toaster';
import { Mail, ArrowLeft } from 'lucide-react';

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
      toast.success('Password reset email sent!');
    } catch (err) {
      toast.error(err.message || 'Failed to send reset email');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-navy-950 to-navy-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-navy-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Mail size={24} className="text-navy-700" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Forgot Password</h1>
          <p className="text-gray-500 text-sm mt-1">Enter your email and we'll send a reset link</p>
        </div>
        {sent ? (
          <div className="text-center">
            <div className="bg-green-50 border border-green-200 rounded-xl p-4 mb-6">
              <p className="text-green-700 text-sm">Reset link sent to <strong>{email}</strong>. Check your inbox.</p>
            </div>
            <Link to="/login" className="text-navy-700 font-semibold text-sm">Back to Login</Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <label className="form-label">Email Address</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required
                className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-navy-900 text-white py-3 rounded-xl font-semibold text-sm hover:bg-navy-800 disabled:opacity-60 transition-all">
              {loading ? 'Sending...' : 'Send Reset Link'}
            </button>
            <Link to="/login" className="flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700 mt-2">
              <ArrowLeft size={14} /> Back to Login
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
