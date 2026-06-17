import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { authService } from '../../services/authService';
import { toast } from '../../components/ui/toaster';
import { KeyRound } from 'lucide-react';

export default function ResetPassword() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return toast.error('Passwords do not match');
    if (password.length < 8) return toast.error('Password must be at least 8 characters');
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
    <div className="min-h-screen bg-gradient-to-br from-navy-950 to-navy-900 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-navy-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <KeyRound size={24} className="text-navy-700" />
          </div>
          <h1 className="text-2xl font-bold">Reset Password</h1>
          <p className="text-gray-500 text-sm mt-1">Enter your new password</p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          {[['New Password', password, setPassword], ['Confirm Password', confirm, setConfirm]].map(([label, val, setter]) => (
            <div key={label}>
              <label className="form-label">{label}</label>
              <input type="password" value={val} onChange={(e) => setter(e.target.value)} required
                className="mt-1 w-full px-4 py-3 border border-gray-200 rounded-xl text-sm text-gray-900 bg-white outline-none focus:ring-2 focus:ring-navy-700" />
            </div>
          ))}
          <button type="submit" disabled={loading}
            className="w-full bg-navy-900 text-white py-3 rounded-xl font-semibold hover:bg-navy-800 disabled:opacity-60 transition-all">
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </form>
      </div>
    </div>
  );
}
