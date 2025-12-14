import express from 'express';
import {
  getAuthorizationUrlController,
  handleOAuthCallback,
  connectGoogleFit,
  disconnectGoogleFit,
  syncHealthData,
  getConnectionStatus
} from '../controllers/googleFitController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public route (called by Google OAuth)
router.get('/callback', handleOAuthCallback);

// Protected routes
router.use(protect);

router.get('/authorize', getAuthorizationUrlController);
router.post('/connect', connectGoogleFit);
router.post('/disconnect', disconnectGoogleFit);
router.post('/sync', syncHealthData);
router.get('/status', getConnectionStatus);

export default router;

