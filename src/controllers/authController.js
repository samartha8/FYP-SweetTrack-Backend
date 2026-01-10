import jwt from 'jsonwebtoken';
import Settings from '../models/Settings.js';
import User from '../models/User.js';

const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('JWT_SECRET must be at least 32 characters');
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
  isGoogleFitConnected: user.isGoogleFitConnected,
  accountType: user.accountType,
  googleProfile: user.googleProfile,
  healthData: user.healthData // Include nested health data
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

const createDefaultSettings = async (userId) => {
  return await Settings.create({
    user: userId,
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
};

// ========================================
// SIGNUP (Email/Password)
// ========================================
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all fields'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase(),
      password,
      accountType: 'email',
      healthSetupCompleted: false,
      isGoogleFitConnected: false
    });

    const defaultSettings = await createDefaultSettings(user._id);
    user.settings = defaultSettings._id;
    await user.save();

    const { accessToken, refreshToken } = await issueTokens(user);

    console.log('✅ User registered:', user.email);

    res.status(201).json({
      success: true,
      user: sanitizeUser(user),
      token: accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('❌ Signup error:', error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Email already registered'
      });
    }
    res.status(500).json({
      success: false,
      message: 'Server error during signup'
    });
  }
};

// ========================================
// LOGIN (Email/Password)
// ========================================
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide email and password'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() })
      .populate('healthData') // Populate health data
      .populate('settings');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    if (user.accountType === 'google' && !user.password) {
      return res.status(401).json({
        success: false,
        message: 'This account uses Google Sign-In. Please sign in with Google.'
      });
    }

    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password'
      });
    }

    user.lastLogin = new Date();
    await user.save();

    const { accessToken, refreshToken } = await issueTokens(user);

    console.log('✅ User logged in:', user.email);

    res.status(200).json({
      success: true,
      user: sanitizeUser(user),
      token: accessToken,
      refreshToken
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// ========================================
// GET CURRENT USER
// ========================================
export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select('-password')
      .populate('healthData')
      .populate('settings');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({ success: true, user });
  } catch (error) {
    console.error('❌ Get current user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user data'
    });
  }
};

// ========================================
// REFRESH SESSION
// ========================================
export const refreshSession = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token required'
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, getJWTSecret());
    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          message: 'Invalid token signature',
          errorCode: 'INVALID_SIGNATURE'
        });
      } else if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          message: 'Refresh token expired',
          errorCode: 'TOKEN_EXPIRED'
        });
      }
      throw error;
    }

    const user = await User.findById(decoded.id)
      .populate('healthData') // Populate health data
      .populate('settings');

    if (!user || decoded.tokenVersion !== (user.tokenVersion || 0)) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired session'
      });
    }

    const { accessToken, refreshToken: newRefreshToken } = await issueTokens(user);

    res.status(200).json({
      success: true,
      user: sanitizeUser(user),
      token: accessToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    console.error('❌ Refresh session error:', error);
    res.status(401).json({
      success: false,
      message: 'Unable to refresh session'
    });
  }
};

// ========================================
// GOOGLE CALLBACK (Called by Passport after OAuth)
// ========================================
export const googleCallback = async (req, res) => {
  try {
    // User attached by Passport after successful Google OAuth
    const user = req.user;

    if (!user) {
      console.error('❌ No user found after Google OAuth');
      return res.redirect(`diabetesapp://auth/error?message=${encodeURIComponent('Authentication failed')}`);
    }

    // Issue JWT tokens
    const { accessToken, refreshToken } = await issueTokens(user);

    console.log('✅ Google Sign-In successful:', user.email);
    console.log('   - Account type:', user.accountType);
    console.log('   - Health setup completed:', user.healthSetupCompleted);

    // Redirect back to app with tokens
    const redirectUrl = `diabetesapp://auth/callback?token=${encodeURIComponent(accessToken)}&refreshToken=${encodeURIComponent(refreshToken)}&needsHealthSetup=${!user.healthSetupCompleted}`;

    res.redirect(redirectUrl);
  } catch (error) {
    console.error('❌ Google callback error:', error);
    res.redirect(`diabetesapp://auth/error?message=${encodeURIComponent('Server error')}`);
  }
};

// ========================================
// LOGOUT
// ========================================
export const logoutUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.lastLogoutAt = new Date();
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('❌ Logout error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during logout'
    });
  }
};

// ========================================
// UPDATE PROFILE
// ========================================
export const updateProfile = async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, email } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    if (name) user.name = name;
    if (email) {
      const emailExists = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: userId }
      });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use'
        });
      }
      user.email = email.toLowerCase();
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: sanitizeUser(user)
    });
  } catch (error) {
    console.error('❌ Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile'
    });
  }
};