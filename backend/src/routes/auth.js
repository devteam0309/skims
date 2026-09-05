const express = require('express');
const router = express.Router();
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const upload = require('../middleware/fileUpload');
const validate = require('../middleware/validate');
const {
  register, login, logout, getMe, updateProfile,
  updatePassword, verifyEmail, forgotPassword, resetPassword, resendVerification,
  refreshAccessToken,
  SELF_ASSIGNABLE_ROLES,
} = require('../controllers/authController');

/*
 * Roles that belong to no single LGU. provincial_admin oversees the whole province, and
 * dilg_representative is provincial oversight too — it reads across all four municipalities and
 * the seeded account deliberately has none, so demanding one at registration contradicted the
 * role. Every other self-assignable role is municipality-bound.
 */
const MUNICIPALITY_FREE_ROLES = ['provincial_admin', 'dilg_representative'];

const registerValidation = validate([
  body('firstName').trim().notEmpty().withMessage('First name is required').isLength({ max: 50 }),
  body('lastName').trim().notEmpty().withMessage('Last name is required').isLength({ max: 50 }),
  body('email').isEmail().withMessage('Valid email address is required').normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[A-Z])(?=.*[0-9])/).withMessage('Password must contain an uppercase letter and a number'),
  body('contactNumber').optional({ checkFalsy: true })
    .matches(/^(09|\+639)\d{9}$/).withMessage('Use PH format: 09XXXXXXXXX or +639XXXXXXXXX'),
  // A municipality is what every scoped query keys off. Registering without one produced an
  // account that could sign in and then see nothing at all, with no explanation — so it is
  // required for every role that is municipality-bound, and rejected for those that are not.
  /*
   * A youth registration also creates their registry record, which needs a birth date and gender.
   * Validated here so a bad payload is rejected before the User is created and rolled back.
   */
  body('birthDate')
    .if((value, { req }) => req.body.role === 'youth')
    .isISO8601().withMessage('A valid birth date is required'),
  body('gender')
    .if((value, { req }) => req.body.role === 'youth')
    .trim().notEmpty().withMessage('Gender is required')
    .isLength({ max: 40 }).withMessage('Gender must be 40 characters or fewer'),

  /*
   * Validated here as well as in the controller so the message names the real problem. Without
   * it, omitting the role fell through to the municipality rule below and came back as
   * "Municipality is required" — technically true, and useless for working out what to fix.
   */
  body('role')
    .exists({ checkFalsy: true }).withMessage('Select the type of account you are registering for')
    .bail()
    .isIn(SELF_ASSIGNABLE_ROLES)
    .withMessage('That account type cannot be self-registered. Ask an administrator to assign it.'),

  body('municipality').custom((value, { req }) => {
    /*
     * An omitted role is rejected by the controller, so there is no fallback to reason about here
     * any more. Only skip the municipality requirement for a role that genuinely has none —
     * an unrecognised role falls through to "municipality required", which is the safe way round:
     * the controller refuses it a moment later regardless.
     */
    const { role } = req.body;
    if (!MUNICIPALITY_FREE_ROLES.includes(role) && !value) throw new Error('Municipality is required');
    if (value && !/^[a-f\d]{24}$/i.test(String(value))) throw new Error('Select a valid municipality');
    return true;
  }),
]);

// normalizeEmail() MUST match registerValidation above. Register normalizes (which strips Gmail
// dots and +tags and lowercases) before storing, so any lookup that skips it will miss the record:
// registering "john.doe@gmail.com" stores "johndoe@gmail.com", and logging in with the address the
// user actually typed then fails as "Invalid credentials" despite a correct password.
const loginValidation = validate([
  body('email').isEmail().withMessage('Valid email address is required').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required'),
]);

// Same reason: these look users up by email and must normalize identically.
const emailLookupValidation = validate([
  body('email').isEmail().withMessage('Valid email address is required').normalizeEmail(),
]);

const rateLimit = require('express-rate-limit');

const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many email requests, please try again later.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Too many login attempts from this IP, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', registerValidation, register);
router.post('/login', loginLimiter, loginValidation, login);
router.post('/refresh', refreshAccessToken);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.put('/me', protect, upload.single('avatar'), updateProfile);
router.put('/password', protect, updatePassword);
router.get('/verify-email/:token', verifyEmail);
router.post('/forgot-password', emailLimiter, emailLookupValidation, forgotPassword);
router.post('/resend-verification', emailLimiter, emailLookupValidation, resendVerification);
router.put('/reset-password/:token', resetPassword);

module.exports = router;
