import express from 'express';

const router = express.Router();

// Minimal placeholder auth routes. Replace with real implementations.
const notImplemented = (req, res) => {
  res.status(501).json({ success: false, message: 'Auth endpoint not implemented on backend.' });
};

router.post('/login', notImplemented);
router.post('/signup', notImplemented);
router.post('/refresh', notImplemented);
router.post('/google-signin', notImplemented);
router.post('/logout', notImplemented);

export default router;
