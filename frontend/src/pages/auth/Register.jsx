import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { Eye, EyeOff, UserPlus, AlertCircle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { authService } from '../../services/authService';
import { municipalityService } from '../../services/documentService';
import ComboInput from '../../components/shared/ComboInput';
import { ProofPicker } from '../../components/shared/Attachments';
import { calculateAge, YOUTH_MIN_AGE, YOUTH_MAX_AGE } from '../../utils/formatters';

// Mirrors the suggestions offered in the youth registry itself.
const GENDER_SUGGESTIONS = ['Male', 'Female', 'LGBTQIA+'];
import {
  ROLE_LABELS, SELF_ASSIGNABLE_ROLES, PASSWORD_PATTERN, PASSWORD_RULE_TEXT,
  SEAT_ROLES, VERIFICATION_REQUIRED_ROLES, VERIFICATION_DOCUMENT_TYPES,
} from '../../utils/constants';
import { toast } from '../../components/ui/toaster';

// Mirrors MUNICIPALITY_FREE_ROLES in backend/src/routes/auth.js. DILG was missing here, so the form
// demanded a municipality the server does not want for provincial oversight.
const MUNICIPALITY_FREE_ROLES = ['provincial_admin', 'dilg_representative'];

// Youth record their barangay too, but it is optional for them; the three SK offices must name one.
const BARANGAY_ROLES = [...SEAT_ROLES, 'youth'];

const schema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Invalid email'),
  /*
   * The rule here was `(?=.*[A-Z])(?=.*[0-9])` — uppercase and a digit — matching the register
   * route's validator but not User.js, which also requires a special character and runs last.
   * "Password1" therefore satisfied both the form and the route, and was rejected on save with
   * "must contain ... one special character": a requirement the form never mentioned, at the end
   * of a sign-up. Verified against the API before changing.
   */
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(PASSWORD_PATTERN, 'Include an uppercase letter, a number and a special character'),
  confirmPassword: z.string(),
  role: z.string().min(1, 'Please select a role'),
  municipality: z.string().optional(),
  barangay: z.string().optional(),
  // Only asked for, and only required, when registering as a youth member.
  birthDate: z.string().optional(),
  gender: z.string().optional(),
  contactNumber: z.string().optional().refine((v) => !v || /^(09|\+639)\d{9}$/.test(v), {
    message: 'Use PH format: 09XXXXXXXXX or +639XXXXXXXXX',
  }),
})
  .refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] })
  /*
   * The municipality chosen here becomes the account's home municipality, and every scoped query
   * in the system keys off it. Leaving it blank used to be allowed, which produced an account
   * that signed in successfully and then found every list empty — programs, budgets, youth — with
   * nothing on screen explaining why. Required for every municipality-bound role.
   */
  .refine((d) => MUNICIPALITY_FREE_ROLES.includes(d.role) || !!d.municipality, {
    message: 'Select your municipality',
    path: ['municipality'],
  })
  /*
   * An SK officer's barangay decides which records the account can see, and the seat it holds — one
   * chairperson, one treasurer and one secretary per barangay. Required for those three offices.
   */
  .refine((d) => !SEAT_ROLES.includes(d.role) || !!d.barangay, {
    message: 'Select your barangay',
    path: ['barangay'],
  })
  /*
   * A youth sign-up also creates their entry in the Katipunan ng Kabataan registry, which needs a
   * birth date and gender. Checked here so the two fields are flagged inline rather than coming
   * back as a server error after the account has already been attempted.
   */
  .refine((d) => d.role !== 'youth' || !!d.birthDate, {
    message: 'Enter your birth date',
    path: ['birthDate'],
  })
  .refine((d) => d.role !== 'youth' || !!d.gender, {
    message: 'Enter your gender',
    path: ['gender'],
  })
  .refine((d) => {
    if (d.role !== 'youth' || !d.birthDate) return true;
    const age = calculateAge(d.birthDate);
    return age !== null && age >= YOUTH_MIN_AGE && age <= YOUTH_MAX_AGE;
  }, {
    message: `Youth membership is for ages ${YOUTH_MIN_AGE} to ${YOUTH_MAX_AGE}`,
    path: ['birthDate'],
  });

/*
 * Only roles the backend will actually grant. This once listed every role except super_admin,
 * including provincial_admin and municipal_admin, which authController quietly turned into
 * public_user — the registrant chose one account type and silently received another. The server
 * now answers 400 for anything outside this list, so the two sides cannot drift apart unnoticed.
 */
const SELECTABLE_ROLES = SELF_ASSIGNABLE_ROLES.map((value) => [value, ROLE_LABELS[value]]);

const inputClass =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-navy-700 focus:ring-2 focus:ring-navy-700/20 aria-[invalid=true]:border-red-500';

export default function Register() {
  const navigate = useNavigate();
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const { data: munData } = useQuery({
    queryKey: ['municipalities-public'],
    queryFn: () => municipalityService.getAll().then((r) => r.data.data),
  });

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm({ resolver: zodResolver(schema) });
  const role = watch('role');
  const municipality = watch('municipality');
  const barangay = watch('barangay');
  const needsMunicipality = role && !MUNICIPALITY_FREE_ROLES.includes(role);
  const isYouth = role === 'youth';
  const asksBarangay = BARANGAY_ROLES.includes(role) && Boolean(municipality);
  const needsDocuments = VERIFICATION_REQUIRED_ROLES.includes(role);
  const isSeat = SEAT_ROLES.includes(role);
  const [documents, setDocuments] = useState([]);
  const [documentsError, setDocumentsError] = useState('');

  /*
   * The barangay list follows the municipality: choosing Boac offers Boac's barangays and nothing
   * else. For an SK office it also carries each barangay's seat — a barangay whose chairperson (or
   * treasurer, or secretary) is already registered or awaiting approval cannot be chosen again.
   */
  const { data: barangays = [], isFetching: loadingBarangays } = useQuery({
    queryKey: ['register-barangays', municipality, isSeat ? role : 'any'],
    queryFn: () => municipalityService.getBarangays(municipality, isSeat ? { role } : undefined)
      .then((r) => r.data.data),
    enabled: asksBarangay,
  });

  // A barangay belongs to one municipality and, for an office, may be taken: clear a choice that
  // no longer fits rather than submit a pairing the server will refuse.
  useEffect(() => {
    if (!barangay) return;
    if (!asksBarangay) { setValue('barangay', ''); return; }
    if (!barangays.length) return;
    const still = barangays.find((b) => b._id === barangay);
    if (!still || (still.seatStatus && still.seatStatus !== 'vacant')) setValue('barangay', '');
  }, [asksBarangay, barangays, barangay, setValue]);

  const onSubmit = async (data) => {
    // Destructured only to keep it out of the payload — the API has no use for the confirmation.
    // eslint-disable-next-line no-unused-vars
    const { confirmPassword, ...payload } = data;
    if (needsDocuments && documents.length === 0) {
      setDocumentsError('Attach at least one: a valid government ID, your KK ID, or proof of residency.');
      return;
    }
    setDocumentsError('');
    setLoading(true);
    try {
      /*
       * Multipart, because the identity documents travel with the application. Youth attach none and
       * are sent the same way; the server reads both shapes.
       */
      const body = new FormData();
      Object.entries(payload).forEach(([k, v]) => { if (v !== undefined && v !== '') body.append(k, v); });
      if (needsDocuments) {
        documents.forEach(({ file, type }) => {
          body.append('verificationDocuments', file);
          body.append('documentTypes', type);
        });
      }
      await authService.register(body);
      toast.success('Registration successful! Please check your email to verify your account.');
      navigate('/login');
    } catch (err) {
      toast.error(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  /** Field error, wired to the input via aria-describedby so it is announced, not just seen. */
  const Error = ({ name }) =>
    errors[name] ? (
      <p id={`${name}-error`} className="field-error" role="alert">
        <AlertCircle size={12} aria-hidden="true" className="shrink-0" />
        {errors[name].message}
      </p>
    ) : null;

  /** aria-* wiring shared by every control. */
  const a11y = (name, hintId) => ({
    id: name,
    'aria-invalid': errors[name] ? 'true' : undefined,
    'aria-describedby': [errors[name] ? `${name}-error` : null, hintId].filter(Boolean).join(' ') || undefined,
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-navy-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="bg-navy-900 px-8 py-6 text-white">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 overflow-hidden rounded-lg bg-white">
              <img src="/main_logo.jfif" alt="" className="h-full w-full object-contain" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">SKIMS Registration</h1>
              {/* navy-400 on navy-900 fell below AA; navy-200 reads cleanly. */}
              <p className="text-xs text-navy-200">Create your account</p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-4 p-8">
          <p className="meta-text">
            Fields are required unless marked optional.
          </p>

          <div className="grid grid-cols-2 gap-4">
            {[['firstName', 'First Name', 'given-name'], ['lastName', 'Last Name', 'family-name']].map(([name, label, ac]) => (
              <div key={name}>
                {/* htmlFor/id pairs: labels were previously unassociated, so clicking one did
                    not focus its field and screen readers announced an unlabelled control. */}
                <label htmlFor={name} className="form-label">{label}</label>
                <input {...register(name)} {...a11y(name)} autoComplete={ac} className={inputClass} />
                <Error name={name} />
              </div>
            ))}
          </div>

          <div>
            <label htmlFor="email" className="form-label">Email Address</label>
            <input {...register('email')} {...a11y('email', 'email-hint')} type="email" autoComplete="email" className={inputClass} />
            <p id="email-hint" className="field-hint">We send your verification link here — you cannot sign in until it is confirmed.</p>
            <Error name="email" />
          </div>

          <div>
            <label htmlFor="role" className="form-label">Role</label>
            <select {...register('role')} {...a11y('role', 'role-hint')} className={inputClass}>
              <option value="">Select your role...</option>
              {SELECTABLE_ROLES.map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
            <p id="role-hint" className="field-hint">
              Every account except a youth member&rsquo;s is reviewed by the system administrator before it can be used.
            </p>
            <Error name="role" />
          </div>

          {isYouth && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="birthDate" className="form-label">Birth Date</label>
                <input {...register('birthDate')} {...a11y('birthDate', 'birthDate-hint')} type="date" className={inputClass} />
                <p id="birthDate-hint" className="field-hint">
                  SK membership is for ages {YOUTH_MIN_AGE}–{YOUTH_MAX_AGE}.
                </p>
                <Error name="birthDate" />
              </div>
              <div>
                <label htmlFor="gender" className="form-label">Gender</label>
                {/* Free text with suggestions, matching the registry itself — an entry outside the
                    usual two is recorded as written rather than filed under "other". */}
                <ComboInput
                  {...register('gender')}
                  {...a11y('gender')}
                  options={GENDER_SUGGESTIONS}
                  placeholder="Select or type..."
                  className={inputClass}
                />
                <Error name="gender" />
              </div>
            </div>
          )}

          {needsMunicipality && (
            <div>
              <label htmlFor="municipality" className="form-label">Municipality</label>
              <select {...register('municipality')} {...a11y('municipality')} className={inputClass}>
                <option value="">Select municipality...</option>
                {munData?.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
              </select>
              <Error name="municipality" />
            </div>
          )}

          {BARANGAY_ROLES.includes(role) && (
            <div>
              <label htmlFor="barangay" className="form-label">
                Barangay {isYouth && <span className="font-normal text-gray-500">(optional)</span>}
              </label>
              <select
                {...register('barangay')}
                {...a11y('barangay', 'barangay-hint')}
                disabled={!municipality || loadingBarangays}
                className={inputClass}
              >
                <option value="">
                  {!municipality ? 'Select a municipality first' : loadingBarangays ? 'Loading barangays…' : 'Select barangay...'}
                </option>
                {barangays.map((b) => {
                  const taken = b.seatStatus && b.seatStatus !== 'vacant';
                  return (
                    <option key={b._id} value={b._id} disabled={taken}>
                      {b.name}{taken ? ` — ${ROLE_LABELS[role]} ${b.seatStatus === 'pending' ? 'awaiting approval' : 'already registered'}` : ''}
                    </option>
                  );
                })}
              </select>
              <p id="barangay-hint" className="field-hint">
                {isSeat
                  ? `Each barangay has one ${ROLE_LABELS[role]}. Barangays whose position is already taken cannot be chosen.`
                  : 'Only barangays of the municipality you chose are listed.'}
              </p>
              <Error name="barangay" />
            </div>
          )}

          {needsDocuments && (
            <fieldset>
              <legend className="form-label">Identity or residency proof</legend>
              <p className="field-hint mb-2">
                Upload at least one: a valid government-issued ID, your Katipunan ng Kabataan (KK) ID, or
                proof of residency. The system administrator checks it before approving your account; it is
                not shown to anyone else.
              </p>
              <ProofPicker
                id="verification-documents"
                value={documents}
                onChange={(next) => { setDocuments(next); if (next.length) setDocumentsError(''); }}
                typeOptions={VERIFICATION_DOCUMENT_TYPES}
                freeText={false}
                max={3}
                onReject={(msg) => setDocumentsError(msg)}
              />
              {documentsError && (
                <p className="field-error" role="alert">
                  <AlertCircle size={12} aria-hidden="true" className="shrink-0" />
                  {documentsError}
                </p>
              )}
            </fieldset>
          )}

          <div>
            <label htmlFor="contactNumber" className="form-label">
              Contact Number <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <input {...register('contactNumber')} {...a11y('contactNumber')} type="tel" autoComplete="tel" placeholder="09XXXXXXXXX" className={inputClass} />
            <Error name="contactNumber" />
          </div>

          <div>
            <label htmlFor="password" className="form-label">Password</label>
            <div className="relative">
              <input
                {...register('password')}
                {...a11y('password', 'password-hint')}
                type={showPass ? 'text' : 'password'}
                autoComplete="new-password"
                className={`${inputClass} pr-10`}
              />
              <button
                type="button"
                onClick={() => setShowPass(!showPass)}
                aria-label={showPass ? 'Hide password' : 'Show password'}
                aria-pressed={showPass}
                className="absolute right-3 top-1/2 mt-0.5 -translate-y-1/2 text-gray-500 hover:text-gray-700"
              >
                {showPass ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}
              </button>
            </div>
            {/* Requirements stated up front rather than only after a rejected submit — the
                cheapest possible way to prevent the error in the first place. */}
            <p id="password-hint" className="field-hint">{PASSWORD_RULE_TEXT}</p>
            <Error name="password" />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="form-label">Confirm Password</label>
            <input
              {...register('confirmPassword')}
              {...a11y('confirmPassword')}
              type={showPass ? 'text' : 'password'}
              autoComplete="new-password"
              className={inputClass}
            />
            <Error name="confirmPassword" />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-navy-900 py-3 text-sm font-semibold text-white transition-colors hover:bg-navy-800 disabled:opacity-60"
          >
            {loading
              ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              : <UserPlus size={16} aria-hidden="true" />}
            {loading ? 'Creating Account...' : 'Create Account'}
          </button>

          <p className="text-center text-sm text-gray-600">
            Already have an account?{' '}
            <Link to="/login" className="font-semibold text-navy-700 hover:underline">Sign in</Link>
          </p>
        </form>
      </motion.div>
    </div>
  );
}
