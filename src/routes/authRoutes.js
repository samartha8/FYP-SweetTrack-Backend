import express from 'express';
import passport from '../config/passport.js';
import {
  registerUser,
  loginUser,
  getCurrentUser,
  refreshSession,
  googleCallback,
  logoutUser,
  updateProfile
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// ========================================
// PUBLIC ROUTES (No authentication required)
// ========================================

// Email/Password authentication
router.post('/signup', registerUser);
router.post('/login', loginUser);
router.post('/refresh', refreshSession);

// ========================================
// GOOGLE OAUTH ROUTES (No Firebase)
// ========================================

// Step 1: User initiates Google Sign-In
// Frontend opens: http://192.168.1.76:5000/api/auth/google
router.get(
  '/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    session: false
  })
);

// Step 2: Google redirects here after user signs in
router.get(
  '/google/callback',
  passport.authenticate('google', {
    session: false,
    failureRedirect: '/api/auth/google/error'
  }),
  googleCallback
);

// Error handler for Google OAuth
router.get('/google/error', (req, res) => {
  res.redirect(`diabetesapp://auth/error?message=${encodeURIComponent('Google Sign-In failed')}`);
});

// ========================================
// PROTECTED ROUTES (Authentication required)
// ========================================
router.use(protect); // Middleware: All routes below need valid JWT

router.get('/me', getCurrentUser);
router.post('/logout', logoutUser);
router.put('/profile', updateProfile);

export default router;