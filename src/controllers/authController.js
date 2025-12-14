import jwt from 'jsonwebtoken';
import Settings from '../models/Settings.js';
import User from '../models/User.js';

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
    const { idToken, email, name, photoURL } = req.body;

    if (!idToken || !email) {
      return res.status(400).json({ 
        success: false, 
        message: 'ID token and email are required' 
      });
    }

    console.log('🔐 Google Sign-In attempt for:', email);

    // Find or create user
    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      // Existing user - update name if provided and different
      if (name && name !== user.name) {
        user.name = name;
      }
      // Update last login time
      user.lastLogin = new Date();
      await user.save();
      console.log('✅ Existing user updated:', user.email);
    } else {
      // New user - create account
      // Generate a random password (user won't need it for Google Sign-In)
      const randomPassword = Math.random().toString(36).slice(-12) + Math.random().toString(36).slice(-12);
      
      user = await User.create({
        name: name || email.split('@')[0],
        email: email.toLowerCase(),
        password: randomPassword, // Required by schema, but won't be used for Google Sign-In
        healthSetupCompleted: false,
        isGoogleFitConnected: false,
        lastLogin: new Date()
      });

      console.log('✅ New user created in database:', user.email);

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
      console.log('✅ Default settings created for user:', user.email);
    }

    // Issue tokens
    const { accessToken, refreshToken } = await issueTokens(user);

    console.log('✅ Google Sign-In successful. Tokens issued for:', user.email);

    res.status(200).json({
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
      name: error.name
    });
    
    // Handle duplicate email error
    if (error.code === 11000 || error.message.includes('duplicate')) {
      return res.status(409).json({ 
        success: false, 
        message: 'An account with this email already exists' 
      });
    }
    
    // Handle validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid user data: ' + Object.values(error.errors).map(e => e.message).join(', ')
      });
    }
    
    res.status(500).json({ 
      success: false, 
      message: 'Server error during Google Sign-In. Please try again.' 
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
