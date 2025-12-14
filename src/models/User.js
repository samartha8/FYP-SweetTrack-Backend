import bcrypt from 'bcrypt';
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { 
    type: String, 
    required: [true, 'Please provide a name'] 
  },
  email: { 
    type: String, 
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    trim: true
  },
  password: { 
    type: String, 
    required: [true, 'Please provide a password'],
    minlength: 6
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
  lastLogin: {
    type: Date
  },
  sessionIssuedAt: {
    type: Date
  },
  lastLogoutAt: {
    type: Date
  },
  tokenVersion: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });


// ========= FIX: async pre-save hook without breaking Mongoose =========
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});


// Compare password
userSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Remove password from JSON output
userSchema.methods.toJSON = function() {
  const userObject = this.toObject();
  delete userObject.password;
  return userObject;
};

export default mongoose.model('User', userSchema);
