import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import User from '../models/User.js';
import Settings from '../models/Settings.js';

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

// ✅ GOOGLE OAUTH STRATEGY
passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_AUTH_CLIENT_ID,
      clientSecret: process.env.GOOGLE_AUTH_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_AUTH_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback',
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        console.log('🔐 Google OAuth: User authenticated');
        console.log('   - Google ID:', profile.id);
        console.log('   - Email:', profile.emails[0]?.value);

        const email = profile.emails[0]?.value?.toLowerCase();
        const googleId = profile.id;

        if (!email) {
          return done(new Error('No email found in Google profile'), null);
        }

        // ✅ FIND: Existing user by Google ID OR email
        let user = await User.findOne({
          $or: [
            { googleId: googleId },
            { email: email }
          ]
        });

        if (user) {
          // ✅ UPDATE: Existing user
          console.log('👤 Found existing user:', user.email);

          // Link Google ID if not already linked
          if (!user.googleId) {
            console.log('🔗 Linking Google account to existing email account');
            user.googleId = googleId;
            user.accountType = user.password ? 'hybrid' : 'google';
          }

          // Update profile info
          user.name = profile.displayName || user.name;
          user.googleProfile = {
            photoURL: profile.photos[0]?.value || null,
            givenName: profile.name?.givenName || null,
            familyName: profile.name?.familyName || null,
            locale: profile._json.locale || null
          };
          user.lastLogin = new Date();

          await user.save();
          console.log('✅ User updated successfully');
        } else {
          // ✅ CREATE: New Google user
          console.log('🆕 Creating new Google user:', email);

          // Generate random password (not used for Google users)
          const randomPassword = Math.random().toString(36).slice(-12) + 
                                Math.random().toString(36).slice(-12) + 
                                Date.now().toString(36);

          user = await User.create({
            name: profile.displayName || email.split('@')[0],
            email: email,
            password: randomPassword,
            googleId: googleId,
            accountType: 'google',
            googleProfile: {
              photoURL: profile.photos[0]?.value || null,
              givenName: profile.name?.givenName || null,
              familyName: profile.name?.familyName || null,
              locale: profile._json.locale || null
            },
            healthSetupCompleted: false,
            isGoogleFitConnected: false,
            lastLogin: new Date()
          });

          // Create default settings
          const defaultSettings = await createDefaultSettings(user._id);
          user.settings = defaultSettings._id;
          await user.save();

          console.log('✅ New Google user created:', user.email);
        }

        return done(null, user);
      } catch (error) {
        console.error('❌ Google OAuth error:', error);
        return done(error, null);
      }
    }
  )
);

// Serialize user for session (not needed for JWT but required by Passport)
passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

export default passport;