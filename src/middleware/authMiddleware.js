import jwt from 'jsonwebtoken';
import User from '../models/User.js';

// Get JWT_SECRET (validation happens at server startup in server.js)
const getJWTSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret === 'your_jwt_secret') {
    throw new Error('JWT_SECRET environment variable is required and must not be the default value');
  }
  return secret;
};

// @desc    Protect routes - verify JWT token
// @access  Private
export const protect = async (req, res, next) => {
  let token;

  // Check for token in Authorization header
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // Check for token in cookies (if using cookies)
  // else if (req.cookies && req.cookies.token) {
  //   token = req.cookies.token;
  // }

  if (!token) {
    console.warn('🔓 Auth: No token provided in header');
    return res.status(401).json({
      success: false,
      message: 'Not authorized, no token provided'
    });
  }

  try {
    // Verify token - this will throw if signature is invalid or token is expired
    const decoded = jwt.verify(token, getJWTSecret());

    // Get user from token (exclude password)
    req.user = await User.findById(decoded.id).select('-password');

    // Validate token version to invalidate old sessions
    if (!req.user) {
      console.warn(`🔓 Auth: User not found for ID ${decoded.id}`);
      return res.status(401).json({
        success: false,
        message: 'User found in token but missing from database. Please login again.'
      });
    }

    if (decoded.tokenVersion !== (req.user.tokenVersion || 0)) {
      console.warn(`🔓 Auth: Version mismatch for ${req.user.email}. Token: ${decoded.tokenVersion}, DB: ${req.user.tokenVersion || 0}`);
      return res.status(401).json({
        success: false,
        message: 'Session expired (version mismatch). Please login again.'
      });
    }

    next();
  } catch (error) {
    // Distinguish between different JWT errors
    if (error.name === 'JsonWebTokenError') {
      // Invalid signature - token was signed with different secret
      console.error('Token signature invalid - likely signed with different JWT_SECRET');
      return res.status(401).json({
        success: false,
        message: 'Invalid token signature. Please login again.',
        errorCode: 'INVALID_SIGNATURE'
      });
    } else if (error.name === 'TokenExpiredError') {
      console.error('Token expired');
      return res.status(401).json({
        success: false,
        message: 'Token expired. Please refresh your session.',
        errorCode: 'TOKEN_EXPIRED'
      });
    } else {
      console.error('Token verification error:', error);
      return res.status(401).json({
        success: false,
        message: 'Not authorized, token failed'
      });
    }
  }
};

// @desc    Optional auth - verify token if present but don't require it
// @access  Optional
export const optionalAuth = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (token) {
    try {
      const decoded = jwt.verify(token, getJWTSecret());
      const user = await User.findById(decoded.id).select('-password');
      if (user && decoded.tokenVersion === (user.tokenVersion || 0)) {
        req.user = user;
      } else {
        req.user = null;
      }
    } catch (error) {
      // Token invalid but continue without user
      req.user = null;
    }
  }

  next();
};
