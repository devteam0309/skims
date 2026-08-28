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
} = require('../controllers/authController');

// provincial_admin oversees the whole province and public_user is not tied to an LGU; every
// other self-assignable role is municipality-bound.
const MUNICIPALITY_FREE_ROLES = ['provincial_admin', 'public_user'];

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
  body('municipality').custom((value, { req }) => {
    // An omitted role becomes public_user in the controller, so it must read as municipality-free
    // here too — `body('role').not().isIn(...)` treats undefined as "not in the list" and would
    // have demanded a municipality from every plain citizen sign-up.
    const role = req.body.role || 'public_user';
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
