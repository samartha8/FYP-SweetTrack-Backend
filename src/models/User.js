import bcrypt from 'bcrypt';
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema(
  {
    name: { 
      type: String, 
      required: [true, 'Please provide a name'] 
    },

    email: { 
      type: String, 
      required: [true, 'Please provide an email'],
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },

    password: { 
      type: String,
      required: function () {
        // Required only for email-based accounts
        return this.accountType === 'email';
      },
      minlength: 6
    },

    // Google Sign-In
    googleId: {
      type: String,
      unique: true,
      sparse: true,
      index: true
    },

    accountType: {
      type: String,
      enum: ['email', 'google', 'hybrid'],
      default: 'email'
    },

    googleProfile: {
      photoURL: String,
      locale: String,
      givenName: String,
      familyName: String
    },

    healthSetupCompleted: { 
      type: Boolean, 
      default: false 
    },

    isGoogleFitConnected: {
      type: Boolean,
      default: false
    },

    healthData: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Health' 
    },

    settings: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Settings'
    },

    lastLogin: Date,
    sessionIssuedAt: Date,
    lastLogoutAt: Date,

    tokenVersion: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

/**
 * 🔐 Hash password before saving
 * - Skips Google users
 * - Safe for async/await
 */
userSchema.pre('save', async function () {
  if (!this.isModified('password') || !this.password) return;

  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

/**
 * 🔑 Compare password (email login only)
 */
userSchema.methods.matchPassword = async function (enteredPassword) {
  if (!this.password) return false;
  return bcrypt.compare(enteredPassword, this.password);
};

/**
 * 🧹 Remove sensitive fields from JSON output
 */
userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  delete obj.__v;
  return obj;
};

export default mongoose.model('User', userSchema);
