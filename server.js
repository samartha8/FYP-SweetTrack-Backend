import 'dotenv/config';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import passport from './src/config/passport.js';
import cron from 'node-cron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env'), override: true });

// ========================================
// VALIDATION: Check required environment variables
// ========================================
if (!process.env.MONGO_URI) {
  console.error('❌ MONGO_URI not set in .env');
  process.exit(1);
}

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('❌ JWT_SECRET must be at least 32 characters');
  console.error('   Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"');
  process.exit(1);
}

if (!process.env.GOOGLE_AUTH_CLIENT_ID || !process.env.GOOGLE_AUTH_CLIENT_SECRET) {
  console.warn('⚠️  Google OAuth (Login) not configured - Google Sign-In will not work');
  console.warn('   Add GOOGLE_AUTH_CLIENT_ID and GOOGLE_AUTH_CLIENT_SECRET to .env');
} else {
  console.log('✅ Google OAuth (Login) configured');
  console.log('   - Client ID:', process.env.GOOGLE_AUTH_CLIENT_ID.substring(0, 30) + '...');
  console.log('   - Redirect URI:', process.env.GOOGLE_AUTH_REDIRECT_URI);
}

// Google Fit (Wellness) Integration Check
if (!process.env.GOOGLE_FIT_CLIENT_ID || !process.env.GOOGLE_FIT_CLIENT_SECRET) {
  console.warn('⚠️  Google Fit (Wellness) not configured');
} else {
  console.log('✅ Google Fit (Wellness) configured');
  console.log('   - Client ID:', process.env.GOOGLE_FIT_CLIENT_ID.substring(0, 30) + '...');
  console.log('   - Redirect URI:', process.env.GOOGLE_FIT_REDIRECT_URI);
}

// ========================================
// IMPORT ROUTES
// ========================================
import authRoutes from './src/routes/authRoutes.js';
import googleFitRoutes from './src/routes/googleFitRoutes.js';
import healthRoutes from './src/routes/healthRoutes.js';
import settingsRoutes from './src/routes/settingsRoutes.js';
import mealRoutes from './src/routes/mealRoutes.js';
import notificationRoutes from './src/routes/notificationRoutes.js';
import chatbotRoutes from './src/routes/chatbotRoutes.js';
import diabetesRoutes from './src/routes/diabetesRoutes.js';
import recordRoutes from './src/routes/recordRoutes.js';
import rewardsRoutes from './src/routes/rewardsRoutes.js';
import wellnessRoutes from './src/routes/wellnessRoutes.js';
import { evaluateGoalsForAllUsers } from './src/controllers/notificationController.js';
import { backgroundSyncGoogleFit } from './src/controllers/googleFitController.js';

const app = express();
// ... (omitting middleware for brevity as standard replace tool usage)
// ...
// ... (I will use multi_replace for this if standard fails or I need to be precise)

// I will actually use a smaller chunk to be safe with standard replace_file_content


// ========================================
// MIDDLEWARE
// ========================================

// CORS configuration - More permissive for development
// CORS configuration - Explicit origins for credentials support
const allowedOrigins = [
  'http://localhost:8081',
  'http://localhost:19000',
  'http://localhost:19006',
  'https://domain-recant-urgency.ngrok-free.dev'
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl)
      if (!origin) return callback(null, true);
      if (allowedOrigins.indexOf(origin) !== -1 || origin.includes('ngrok-free.dev')) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'ngrok-skip-browser-warning'],
  })
);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Request Logger & Ngrok Skip Warning
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin) || (origin && origin.includes('ngrok-free.dev'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  
  res.setHeader('ngrok-skip-browser-warning', 'true');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, ngrok-skip-browser-warning');
    return res.sendStatus(200);
  }
  
  console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${req.path}`);
  next();
});

// Initialize Passport (for Google OAuth)
app.use(passport.initialize());

// Static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ========================================
// MONGODB CONNECTION
// ========================================
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log('✅ MongoDB connected successfully');
    console.log('   - Database:', mongoose.connection.name);
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  });

// ========================================
// ROUTES
// ========================================

// Health check endpoint
app.get('/api/status', (req, res) => {
  res.json({
    success: true,
    message: '✅ SweetTrack Backend is ONLINE',
    timestamp: new Date().toISOString(),
    env: process.env.NODE_ENV || 'development'
  });
});

app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'SweetTrack Backend API is running ✅',
    version: '2.0.0',
    authentication: 'MongoDB + Google OAuth (No Firebase)',
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: {
        signup: 'POST /api/auth/signup',
        login: 'POST /api/auth/login',
        googleOAuth: 'GET /api/auth/google',
        googleCallback: 'GET /api/auth/google/callback',
        refresh: 'POST /api/auth/refresh',
        me: 'GET /api/auth/me',
        logout: 'POST /api/auth/logout'
      },
      health: 'POST /api/health',
      settings: '/api/settings',
      googleFit: '/api/google-fit',
      meals: '/api/meals',
      notifications: '/api/notifications',
      chatbot: '/api/chatbot'
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
app.use('/api/chatbot', chatbotRoutes);
app.use('/api/diabetes', diabetesRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/rewards', rewardsRoutes);
app.use('/api/wellness', wellnessRoutes);

// ========================================
// ERROR HANDLING
// ========================================

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.path}`,
  });
});

// ========================================
// START SERVER
// ========================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n========================================');
  console.log('🚀 SweetTrack Backend Server Started');
  console.log('========================================');
  console.log(`📡 Port: ${PORT}`);
  console.log(`🔗 Local: http://localhost:${PORT}`);
  console.log(`🔗 Network: http://192.168.1.136:${PORT}`);
  console.log(`🔐 Google OAuth: http://192.168.1.136:${PORT}/api/auth/google`);
  console.log('========================================\n');
});

// ========================================
// BACKGROUND JOBS
// ========================================

// Goal reminders at practical daily checkpoints: morning, afternoon, and evening.
cron.schedule('0 9,14,20 * * *', async () => {
  try {
    await evaluateGoalsForAllUsers();
  } catch (err) {
    console.error('❌ Goal evaluation job failed:', err);
  }
}, {
  timezone: process.env.REMINDER_TIMEZONE || 'Asia/Kathmandu'
});

// Google Fit sync every 30 minutes
cron.schedule('*/30 * * * *', async () => {
  try {
    await backgroundSyncGoogleFit();
  } catch (err) {
    console.error('❌ Google Fit background sync failed:', err);
  }
});

// ========================================
// PROCESS HANDLERS
// ========================================

// Handle unhandled promise rejections
process.on('unhandledRejection', err => {
  console.error('❌ Unhandled Rejection:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('👋 SIGTERM received. Shutting down gracefully...');
  mongoose.connection.close();
  process.exit(0);
});
