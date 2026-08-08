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

const registerValidation = validate([
  body('firstName').trim().notEmpty().withMessage('First name is required').isLength({ max: 50 }),
  body('lastName').trim().notEmpty().withMessage('Last name is required').isLength({ max: 50 }),
  body('email').isEmail().withMessage('Valid email address is required').normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/^(?=.*[A-Z])(?=.*[0-9])/).withMessage('Password must contain an uppercase letter and a number'),
  body('contactNumber').optional({ checkFalsy: true })
    .matches(/^(09|\+639)\d{9}$/).withMessage('Use PH format: 09XXXXXXXXX or +639XXXXXXXXX'),
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
