import jwt from 'jsonwebtoken';
import Settings from '../models/Settings.js';
import User from '../models/User.js';
import admin from '../config/firebaseAdmin.js';

// Get JWT_SECRET (validation happens at server startup in server.js)
const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'your_jwt_secret') {
    throw new Error('JWT_SECRET environment variable is required and must not be the default value');
  }
  return secret;
};

const ACCESS_TOKEN_EXPIRY = process.env.JWT_EXPIRES_IN || '15m';
const REFRESH_TOKEN_EXPIRY = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

const signToken = (payload, expiresIn) => jwt.sign(payload, getJWTSecret(), { expiresIn });

const buildAuthPayload = (user) => ({
  id: user._id,
  tokenVersion: user.tokenVersion || 0,
});

const sanitizeUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  healthSetupCompleted: user.healthSetupCompleted,
  isGoogleFitConnected: user.isGoogleFitConnected
});

const issueTokens = async (user) => {
  user.tokenVersion = (user.tokenVersion || 0) + 1;
  user.sessionIssuedAt = new Date();
  await user.save();

  const payload = buildAuthPayload(user);

  return {
    accessToken: signToken(payload, ACCESS_TOKEN_EXPIRY),
    refreshToken: signToken(payload, REFRESH_TOKEN_EXPIRY),
  };
};

// -------- SIGNUP --------
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide all fields' });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email already exists' });
    }

    // Create user
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      healthSetupCompleted: false,
      isGoogleFitConnected: false
    });

    // Create default settings
    const defaultSettings = await Settings.create({
      user: user._id,
      language: 'en',
      highContrast: false,
      fontSize: 'medium',
      notifications: {
        enabled: true,
        dailyReminders: true,
        goalAlerts: true,
        healthTips: true
      },
      accessibility: {
        screenReader: false,
        hapticFeedback: true,
        voiceInput: false
      }
    });

    user.settings = defaultSettings._id;
    await user.save();

    const { accessToken, refreshToken } = await issueTokens(user);

    res.status(201).json({
      success: true,
      user: sanitizeUser(user),
      token: accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Signup error:', error);
    res.status(500).json({ success: false, message: 'Server error during signup' });
  }
};

// -------- LOGIN --------
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Please provide email and password' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Email not registered' });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Incorrect password' });
    }

    user.lastLogin = new Date();
    await user.save();

    const { accessToken, refreshToken } = await issueTokens(user);

    res.status(200).json({
      success: true,
      user: sanitizeUser(user),
      token: accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login' });
  }
};

// -------- GET CURRENT USER --------
export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password')
      .populate('healthData')
      .populate('settings');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ success: false, message: 'Error fetching user data' });
  }
};

// -------- REFRESH SESSION --------
export const refreshSession = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ success: false, message: 'Refresh token required' });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, getJWTSecret());
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        // Invalid signature - token was signed with different secret
        console.error('Refresh token signature invalid - likely signed with different JWT_SECRET');
        return res.status(401).json({ 
          success: false, 
          message: 'Invalid token signature. Please login again.',
          errorCode: 'INVALID_SIGNATURE'
        });
      } else if (error.name === 'TokenExpiredError') {
        console.error('Refresh token expired');
        return res.status(401).json({ 
          success: false, 
          message: 'Refresh token expired. Please login again.',
          errorCode: 'TOKEN_EXPIRED'
        });
      }
      throw error;
    }

    const user = await User.findById(decoded.id);

    if (!user || decoded.tokenVersion !== (user.tokenVersion || 0)) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    }

    const { accessToken, refreshToken: newRefreshToken } = await issueTokens(user);

    res.status(200).json({
      success: true,
      user: sanitizeUser(user),
      token: accessToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    console.error('Refresh session error:', error);
    res.status(401).json({ success: false, message: 'Unable to refresh session' });
  }
};

// -------- GOOGLE SIGN-IN --------
export const googleSignIn = async (req, res) => {
  try {
    const { idToken } = req.body;

    // Validate required field
    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: 'ID token is required'
      });
    }

    console.log('🔐 Google Sign-In: Verifying ID token...');

    // Step 1: Verify Firebase ID token using Firebase Admin SDK
    let decodedToken;
    try {
      decodedToken = await admin.auth().verifyIdToken(idToken);
      console.log('✅ Firebase token verified successfully');
      console.log('   - Firebase UID:', decodedToken.uid);
      console.log('   - Email:', decodedToken.email);
    } catch (error) {
      console.error('❌ Firebase token verification failed:', error.message);
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired ID token. Please sign in again.',
        errorCode: 'INVALID_FIREBASE_TOKEN'
      });
    }

    // Step 2: Extract verified data from token (ONLY trust the verified token data)
    const firebaseUid = decodedToken.uid;
    const email = decodedToken.email?.toLowerCase();
    const name = decodedToken.name || email?.split('@')[0] || 'User';

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email not found in ID token. Please ensure your Google account has an email.'
      });
    }

    console.log('📧 Processing sign-in for email:', email);

    // Step 3: Find existing user by Firebase UID OR email
    let user = await User.findOne({
      $or: [
        { firebaseUid: firebaseUid },
        { email: email }
      ]
    });

    if (user) {
      console.log('👤 Found existing user:', user.email);

      // Step 4: Handle account linking/collision scenarios
      
      // Case A: User exists with same Firebase UID (already linked Google account)
      if (user.firebaseUid === firebaseUid) {
        console.log('✅ User already linked to this Google account');
      } 
      // Case B: User exists with same email but no Firebase UID (local account, needs linking)
      else if (!user.firebaseUid) {
        console.log('🔗 Linking Firebase UID to existing local account');
        user.firebaseUid = firebaseUid;
      }
      // Case C: User exists with same email but DIFFERENT Firebase UID (collision!)
      else if (user.firebaseUid !== firebaseUid) {
        console.error('⚠️ Account collision detected!');
        console.error('   - Existing Firebase UID:', user.firebaseUid);
        console.error('   - Attempted Firebase UID:', firebaseUid);
        return res.status(409).json({
          success: false,
          message: 'This email is already associated with a different Google account. Please use the correct Google account or sign in with email/password.',
          errorCode: 'ACCOUNT_COLLISION'
        });
      }

      // Update user info from Google (in case name changed)
      if (name && name !== user.name) {
        console.log('📝 Updating user name:', user.name, '->', name);
        user.name = name;
      }

      // Update last login timestamp
      user.lastLogin = new Date();
      await user.save();
      
      console.log('✅ User updated successfully');
    } else {
      // Step 5: Create new user (first time Google Sign-In)
      console.log('🆕 Creating new user account for:', email);

      // Generate a secure random password (required by schema but won't be used for Google Sign-In)
      const randomPassword = Math.random().toString(36).slice(-12) + 
                            Math.random().toString(36).slice(-12) + 
                            Date.now().toString(36);

      user = await User.create({
        name: name,
        email: email,
        password: randomPassword, // Required by schema, but user won't use it
        firebaseUid: firebaseUid,
        healthSetupCompleted: false,
        isGoogleFitConnected: false,
        lastLogin: new Date()
      });

      console.log('✅ New user created:', user.email);

      // Create default settings for new user
      const defaultSettings = await Settings.create({
        user: user._id,
        language: 'en',
        highContrast: false,
        fontSize: 'medium',
        notifications: {
          enabled: true,
          dailyReminders: true,
          goalAlerts: true,
          healthTips: true
        },
        accessibility: {
          screenReader: false,
          hapticFeedback: true,
          voiceInput: false
        }
      });

      user.settings = defaultSettings._id;
      await user.save();
      
      console.log('✅ Default settings created for new user');
    }

    // Step 6: Issue JWT tokens for application session
    const { accessToken, refreshToken } = await issueTokens(user);

    console.log('✅ Google Sign-In successful - Tokens issued for:', user.email);
    console.log('   - Health setup completed:', user.healthSetupCompleted);
    console.log('   - Google Fit connected:', user.isGoogleFitConnected);

    // Step 7: Return success response
    return res.status(200).json({
      success: true,
      user: sanitizeUser(user),
      token: accessToken,
      refreshToken
    });

  } catch (error) {
    console.error('❌ Google Sign-In error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code
    });

    // Handle specific database errors
    if (error.code === 11000) {
      // Duplicate key error (shouldn't happen with our logic, but just in case)
      const field = Object.keys(error.keyPattern)[0];
      return res.status(409).json({
        success: false,
        message: `An account with this ${field} already exists`,
        errorCode: 'DUPLICATE_KEY'
      });
    }

    if (error.name === 'ValidationError') {
      // Mongoose validation error
      const messages = Object.values(error.errors).map(e => e.message).join(', ');
      return res.status(400).json({
        success: false,
        message: 'Invalid user data: ' + messages,
        errorCode: 'VALIDATION_ERROR'
      });
    }

    // Generic server error
    return res.status(500).json({
      success: false,
      message: 'Server error during Google Sign-In. Please try again.',
      errorCode: 'SERVER_ERROR'
    });
  }
};

// -------- LOGOUT --------
export const logoutUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.lastLogoutAt = new Date();
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    res.status(200).json({ success: true, message: 'Logged out and sessions cleared' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ success: false, message: 'Error during logout' });
  }
};

// -------- UPDATE PROFILE --------
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email } = req.body;

    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });

    if (name) user.name = name;
    if (email) {
      const emailExists = await User.findOne({ email: email.toLowerCase(), _id: { $ne: userId } });
      if (emailExists) {
        return res.status(400).json({ success: false, message: 'Email already in use' });
      }
      user.email = email.toLowerCase();
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        healthSetupCompleted: user.healthSetupCompleted,
        isGoogleFitConnected: user.isGoogleFitConnected
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ success: false, message: 'Error updating profile' });
  }
};