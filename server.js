// server.js - Main backend server file
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Fix __dirname for ES modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Load environment variables ---
dotenv.config({ path: path.join(__dirname, '.env'), override: true });

// --- Check required env vars ---
if (!process.env.MONGO_URI) {
  console.error('❌ MONGO_URI not set in .env');
  process.exit(1);
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET === 'your_jwt_secret') {
  console.error('❌ JWT_SECRET not set or using default value in .env');
  console.error('   Please set a secure random JWT_SECRET in your .env file');
  process.exit(1);
}

// Check Google OAuth configuration (optional - won't fail if not set)
if (!process.env.GOOGLE_CLIENT_ID) {
  console.warn('⚠️  GOOGLE_CLIENT_ID not set - Google Fit features will not work');
  console.warn('   Add GOOGLE_CLIENT_ID to backend/.env to enable Google Fit');
} else {
  console.log('✅ Google OAuth configured (Client ID:', process.env.GOOGLE_CLIENT_ID.substring(0, 20) + '...)');
}

// --- Import routes ---
import authRoutes from './src/routes/authRoutes.js';
import googleFitRoutes from './src/routes/googleFitRoutes.js';
import healthRoutes from './src/routes/healthRoutes.js';
import settingsRoutes from './src/routes/settingsRoutes.js';
import mealRoutes from './src/routes/mealRoutes.js';
import notificationRoutes from './src/routes/notificationRoutes.js';
import cron from 'node-cron';
import { evaluateGoalsForAllUsers } from './src/controllers/notificationController.js';
import { backgroundSyncGoogleFit } from './src/controllers/googleFitController.js';

const app = express();

// --- Middleware ---

// CORS setup for localhost and mobile apps
app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // Postman / mobile apps
    if (/^http:\/\/localhost:\d+$/.test(origin)) return callback(null, true);
    if (/^http:\/\/10\.0\.2\.2:\d+$/.test(origin)) return callback(null, true); // Android emulator
    if (/^http:\/\/192\.168\.\d+\.\d+:\d+$/.test(origin)) return callback(null, true); // LAN devices
    callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
}));

// Parse JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static assets for uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// --- MongoDB connection ---
const MONGO_URI = process.env.MONGO_URI;

mongoose.connect(MONGO_URI)
  .then(() => console.log('✅ MongoDB connected successfully'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// --- Routes ---

// Health check
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SweetTrack Backend API is running ✅',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      health: '/api/health',
      settings: '/api/settings',
      googleFit: '/api/google-fit',
      meals: '/api/meals',
      notifications: '/api/notifications',
    }
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/google-fit', googleFitRoutes);
app.use('/api/meals', mealRoutes);
app.use('/api/notifications', notificationRoutes);

// --- Error handling middleware ---
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error'
  });
});

// --- 404 handler ---
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found'
  });
});

// --- Start server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 API available at http://localhost:${PORT}/api`);
  console.log(`🔗 Health check: http://localhost:${PORT}/`);
});

// Background goal evaluation every 10 minutes
cron.schedule('*/10 * * * *', async () => {
  try {
    await evaluateGoalsForAllUsers();
  } catch (err) {
    console.error('Goal evaluation job failed:', err);
  }
});

// Background Google Fit sync every 30 minutes
cron.schedule('*/30 * * * *', async () => {
  try {
    await backgroundSyncGoogleFit();
  } catch (err) {
    console.error('Google Fit background sync failed:', err);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});
