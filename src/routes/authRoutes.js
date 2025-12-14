import express from 'express';
import {
  registerUser,
  loginUser,
  googleSignIn,
  getCurrentUser,
  updateProfile,
  refreshSession,
  logoutUser
} from '../controllers/authController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public routes
router.post('/signup', registerUser);
router.post('/login', loginUser);
router.post('/google-signin', googleSignIn);
router.post('/refresh', refreshSession);

// Protected routes
router.use(protect);
router.get('/me', getCurrentUser);
router.put('/profile', updateProfile);
router.post('/logout', logoutUser);
// Note: Google Fit routes moved to /api/google-fit

export default router;
