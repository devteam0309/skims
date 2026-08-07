import { useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { Camera, Save, Key, X } from 'lucide-react';
import { authService } from '../../services/authService';
import useAuthStore from '../../store/authStore';
import { ROLE_LABELS } from '../../utils/constants';
import { formatDate, formatFileSize } from '../../utils/formatters';
import { toast } from '../../components/ui/toaster';
import { PageLoader } from '../../components/shared/LoadingSpinner';
import { Field, control } from '../../components/shared/FormField';
import { confirm } from '../../utils/confirm';

/*
 * The avatar goes through the same multer instance as document uploads
 * (backend/src/routes/auth.js -> upload.single('avatar')), so the same ceiling and extension list
 * apply. Images only here, since the destination is an <img>.
 */
const AVATAR_ACCEPT = '.jpg,.jpeg,.png,.gif';
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;

/*
 * Stated because User.js enforces it on save, and does so more strictly than the register route
 * validator: the model also requires a special character. A user changing their password with
 * "Password1" satisfies the rule they were shown at sign-up and is then refused by a raw Mongoose
 * validation message. The form now states what the model actually demands.
 */
const PASSWORD_RULE = 'At least 8 characters, with an uppercase letter, a number and a special character.';

export default function UserProfile() {
  const { user, updateUser } = useAuthStore();
  const queryClient = useQueryClient();
  const [changingPassword, setChangingPassword] = useState(false);
  const [avatarFile, setAvatarFile] = useState(null);
  const avatarInputRef = useRef(null);

  const { data: profile, isLoading } = useQuery({
    queryKey: ['profile'],
    queryFn: () => authService.getMe().then((r) => r.data.data),
  });

  const updateMutation = useMutation({
    /*
     * Deliberately not toFormData: that helper drops blanks, and here a blank is meaningful.
     * Clearing your contact number has to reach the server as an empty value, otherwise the field
     * is simply absent from the body and updateProfile leaves the old number in place — the box
     * looks cleared until the next reload puts it back.
     */
    mutationFn: ({ avatar, ...values }) => {
      const fd = new FormData();
      Object.entries(values).forEach(([k, v]) => fd.append(k, v ?? ''));
      if (avatar) fd.append('avatar', avatar);
      return authService.updateProfile(fd);
    },
    onSuccess: (res) => {
      toast.success('Profile updated');
      updateUser(res.data.data);
      setAvatarFile(null);
      queryClient.invalidateQueries(['profile']);
    },
    onError: (e) => toast.error(e.message || 'Update failed'),
  });

  const passwordMutation = useMutation({
    mutationFn: (d) => authService.updatePassword(d),
    onSuccess: () => {
      toast.success('Password changed successfully');
      setChangingPassword(false);
      // The reset was destructured but never called, so the old and new passwords stayed in the
      // form state and reappeared the next time the panel was opened.
      resetPwd();
    },
    onError: (e) => toast.error(e.message || 'Password change failed'),
  });

  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { firstName: user?.firstName, lastName: user?.lastName, contactNumber: user?.contactNumber },
  });
  const { register: regPwd, handleSubmit: handlePwd, reset: resetPwd, formState: { errors: pwdErrors } } = useForm();

  const pickAvatar = (file) => {
    if (!file) return;
    const ext = `.${file.name.split('.').pop()?.toLowerCase()}`;
    if (!AVATAR_ACCEPT.split(',').includes(ext)) {
      return toast.error(`Choose a ${AVATAR_ACCEPT} image.`);
    }
    if (file.size > MAX_AVATAR_BYTES) {
      return toast.error(`That image is ${formatFileSize(file.size)} — the limit is ${formatFileSize(MAX_AVATAR_BYTES)}.`);
    }
    setAvatarFile(file);
  };

  const onSubmitProfile = async (values) => {
    const r = await confirm.save();
    if (!r.isConfirmed) return;
    updateMutation.mutate(avatarFile ? { ...values, avatar: avatarFile } : values);
  };

  if (isLoading) return <PageLoader />;

  // Shown immediately rather than after a round trip, so the choice is visibly taken.
  const avatarPreview = avatarFile ? URL.createObjectURL(avatarFile) : profile?.avatar;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <h1 className="page-title">My Profile</h1>

      <div className="grid gap-5 md:grid-cols-3">
        <section className="rounded-xl border border-gray-200 bg-white p-6 text-center dark:border-gray-700 dark:bg-gray-800">
          <div className="relative mx-auto mb-4 inline-block">
            <span className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-navy-900">
              {avatarPreview ? (
                <img src={avatarPreview} alt="" className="h-24 w-24 rounded-full object-cover" />
              ) : (
                <span aria-hidden="true" className="text-3xl font-black text-gold-500">
                  {user?.firstName?.[0]}{user?.lastName?.[0]}
                </span>
              )}
            </span>

            {/*
              The backend has always accepted an avatar — routes/auth.js runs upload.single('avatar')
              and updateProfile even deletes the previous image from Cloudinary — but nothing in the
              UI ever sent a file, so the feature was unreachable. The Camera icon was imported and
              never rendered, which is the leftover of that intent.
            */}
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              aria-label="Change profile photo"
              title="Change profile photo"
              className="absolute bottom-0 right-0 rounded-full border-2 border-white bg-navy-800 p-1.5 text-white transition-colors hover:bg-navy-700 dark:border-gray-800"
            >
              <Camera size={14} aria-hidden="true" />
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              hidden
              accept={AVATAR_ACCEPT}
              onChange={(e) => pickAvatar(e.target.files?.[0])}
            />
          </div>

          {avatarFile && (
            <p className="mb-3 flex items-center justify-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <span className="truncate">New photo selected</span>
              <button
                type="button"
                onClick={() => setAvatarFile(null)}
                aria-label="Discard selected photo"
                className="rounded p-0.5 text-gray-400 hover:text-red-600 dark:hover:text-red-400"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </p>
          )}

          <p className="font-semibold text-gray-900 dark:text-white">{profile?.firstName} {profile?.lastName}</p>
          <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">{ROLE_LABELS[profile?.role]}</p>
          {profile?.municipality && <p className="meta-text mt-1">{profile.municipality.name}</p>}

          <dl className="mt-4 space-y-1">
            <div>
              <dt className="sr-only">Joined</dt>
              <dd className="meta-text">Joined: {formatDate(profile?.createdAt)}</dd>
            </div>
            <div>
              <dt className="sr-only">Last login</dt>
              <dd className="meta-text">Last login: {formatDate(profile?.lastLogin)}</dd>
            </div>
          </dl>

          <p className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${
            profile?.isEmailVerified
              ? 'bg-green-100 text-green-700 dark:bg-emerald-500/15 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
          }`}>
            <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${profile?.isEmailVerified ? 'bg-green-500' : 'bg-amber-500'}`} />
            {profile?.isEmailVerified ? 'Email Verified' : 'Email Unverified'}
          </p>
        </section>

        <div className="space-y-4 md:col-span-2">
          <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <h2 className="section-heading mb-4">Personal Information</h2>

            <form onSubmit={handleSubmit(onSubmitProfile)} noValidate className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="firstName" label="First Name" error={errors.firstName}>
                  <input {...register('firstName', { required: 'First name is required' })} className={control} />
                </Field>
                <Field id="lastName" label="Last Name" error={errors.lastName}>
                  <input {...register('lastName', { required: 'Last name is required' })} className={control} />
                </Field>
              </div>

              <Field id="email" label="Email Address" hint="Contact an administrator to change your email.">
                <input
                  value={profile?.email || ''}
                  disabled
                  readOnly
                  className="mt-1 w-full cursor-not-allowed rounded-xl border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-700 dark:text-gray-400"
                />
              </Field>

              <Field id="contactNumber" label="Contact Number" optional error={errors.contactNumber}>
                <input
                  {...register('contactNumber', {
                    validate: (v) => !v || /^(09|\+639)\d{9}$/.test(v) || 'Use PH format: 09XXXXXXXXX or +639XXXXXXXXX',
                  })}
                  type="tel"
                  placeholder="09XXXXXXXXX"
                  className={control}
                />
              </Field>

              <button
                type="submit"
                disabled={updateMutation.isPending}
                className="flex items-center gap-2 rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
              >
                <Save size={15} aria-hidden="true" />
                {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="section-heading">Change Password</h2>
              <button
                type="button"
                onClick={() => { setChangingPassword((v) => !v); resetPwd(); }}
                aria-expanded={changingPassword}
                className="flex items-center gap-2 text-sm font-medium text-navy-700 transition-colors hover:text-navy-900 dark:text-navy-300 dark:hover:text-navy-200"
              >
                <Key size={14} aria-hidden="true" />{changingPassword ? 'Cancel' : 'Change'}
              </button>
            </div>

            {changingPassword && (
              <form
                onSubmit={handlePwd(async (d) => { const r = await confirm.password(); if (r.isConfirmed) passwordMutation.mutate(d); })}
                noValidate
                className="space-y-4"
              >
                <Field id="currentPassword" label="Current Password" required error={pwdErrors.currentPassword}>
                  <input
                    {...regPwd('currentPassword', { required: 'Enter your current password' })}
                    type="password"
                    // Without these the browser cannot tell the two fields apart, so it offers to
                    // save the old password and never prompts to update the stored one.
                    autoComplete="current-password"
                    className={control}
                  />
                </Field>

                <Field id="newPassword" label="New Password" required hint={PASSWORD_RULE} error={pwdErrors.newPassword}>
                  <input
                    {...regPwd('newPassword', {
                      required: 'Enter a new password',
                      minLength: { value: 8, message: 'Password must be at least 8 characters' },
                      validate: (v) =>
                        /^(?=.*[A-Z])(?=.*[0-9])(?=.*[^A-Za-z0-9])/.test(v) ||
                        'Include an uppercase letter, a number and a special character',
                    })}
                    type="password"
                    autoComplete="new-password"
                    className={control}
                  />
                </Field>

                <button
                  type="submit"
                  disabled={passwordMutation.isPending}
                  className="rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
                >
                  {passwordMutation.isPending ? 'Updating...' : 'Update Password'}
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
