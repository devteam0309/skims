import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Camera, Save, Key } from 'lucide-react';
import { authService } from '../../services/authService';
import useAuthStore from '../../store/authStore';
import { ROLE_LABELS } from '../../utils/constants';
import { formatDate } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { confirm } from '../../utils/confirm';

export default function UserProfile() {
  const { user, updateUser } = useAuthStore();
  const queryClient = useQueryClient();
  const [changingPassword, setChangingPassword] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => authService.getMe().then((r) => r.data.data),
  });

  const updateMutation = useMutation({
    mutationFn: (data) => {
      const fd = new FormData();
      Object.entries(data).forEach(([k, v]) => { if (v !== undefined) fd.append(k, v); });
      return authService.updateProfile(fd);
    },
    onSuccess: (res) => { toast.success('Profile updated'); updateUser(res.data.data); queryClient.invalidateQueries(['profile']); },
    onError: (e) => toast.error(e.message),
  });

  const passwordMutation = useMutation({
    mutationFn: (d) => authService.updatePassword(d),
    onSuccess: () => { toast.success('Password changed successfully'); setChangingPassword(false); },
    onError: (e) => toast.error(e.message),
  });

  const { register, handleSubmit, formState: { errors } } = useForm({ defaultValues: { firstName: user?.firstName, lastName: user?.lastName, contactNumber: user?.contactNumber } });
  const { register: regPwd, handleSubmit: handlePwd, reset: resetPwd } = useForm();

  if (isLoading) return <PageLoader />;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Profile</h1>

      <div className="grid md:grid-cols-3 gap-5">
        {/* Avatar card */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-6 text-center">
          <div className="relative inline-block mb-4">
            <div className="w-24 h-24 rounded-full bg-navy-900 flex items-center justify-center mx-auto">
              {profile?.avatar ? (
                <img src={profile.avatar} alt="" className="w-24 h-24 rounded-full object-cover" />
              ) : (
                <span className="text-gold-500 text-3xl font-black">{user?.firstName?.[0]}{user?.lastName?.[0]}</span>
              )}
            </div>
          </div>
          <p className="font-semibold text-gray-900 dark:text-white">{profile?.firstName} {profile?.lastName}</p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{ROLE_LABELS[profile?.role]}</p>
          {profile?.municipality && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{profile.municipality.name}</p>}
          <div className="mt-4 space-y-1 text-xs text-gray-400 dark:text-gray-500">
            <p>Joined: {formatDate(profile?.createdAt)}</p>
            <p>Last login: {formatDate(profile?.lastLogin)}</p>
          </div>
          <div className={`mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${profile?.isEmailVerified ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${profile?.isEmailVerified ? 'bg-green-500' : 'bg-yellow-500'}`} />
            {profile?.isEmailVerified ? 'Email Verified' : 'Email Unverified'}
          </div>
        </div>

        {/* Edit form */}
        <div className="md:col-span-2 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">Personal Information</h2>
            <form onSubmit={handleSubmit(async (d) => { const r = await confirm.save(); if (r.isConfirmed) updateMutation.mutate(d); })} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                {[['firstName', 'First Name'], ['lastName', 'Last Name']].map(([name, label]) => (
                  <div key={name}>
                    <label className="form-label">{label}</label>
                    <input {...register(name)} className="mt-1 w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
                  </div>
                ))}
              </div>
              <div>
                <label className="form-label">Email Address</label>
                <input value={profile?.email} disabled className="mt-1 w-full px-3 py-2.5 border border-gray-100 dark:border-gray-700 rounded-xl text-sm bg-gray-50 dark:bg-gray-700 text-gray-400 dark:text-gray-500 cursor-not-allowed" />
              </div>
              <div>
                <label className="form-label">Contact Number</label>
                <input {...register('contactNumber', {
                  validate: (v) => !v || /^(09|\+639)\d{9}$/.test(v) || 'Use PH format: 09XXXXXXXXX or +639XXXXXXXXX',
                })} type="tel" placeholder="09XXXXXXXXX" className="mt-1 w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
                {errors.contactNumber && <p className="mt-1 text-xs text-red-500">{errors.contactNumber.message}</p>}
              </div>
              <button type="submit" disabled={updateMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 bg-navy-900 text-white rounded-xl text-sm font-semibold hover:bg-navy-800 disabled:opacity-60 transition-colors">
                <Save size={15} />{updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>

          {/* Change password */}
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-gray-900 dark:text-white">Change Password</h2>
              <button onClick={() => setChangingPassword(!changingPassword)}
                className="flex items-center gap-2 text-sm text-navy-700 font-medium hover:text-navy-900">
                <Key size={14} />{changingPassword ? 'Cancel' : 'Change'}
              </button>
            </div>
            {changingPassword && (
              <form onSubmit={handlePwd(async (d) => { const r = await confirm.password(); if (r.isConfirmed) passwordMutation.mutate(d); })} className="space-y-4">
                {[['currentPassword', 'Current Password'], ['newPassword', 'New Password']].map(([name, label]) => (
                  <div key={name}>
                    <label className="form-label">{label}</label>
                    <input {...regPwd(name)} type="password" required
                      className="mt-1 w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-navy-700" />
                  </div>
                ))}
                <button type="submit" disabled={passwordMutation.isPending}
                  className="px-5 py-2.5 bg-navy-900 text-white rounded-xl text-sm font-semibold hover:bg-navy-800 disabled:opacity-60 transition-colors">
                  {passwordMutation.isPending ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
