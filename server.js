import bcrypt from 'bcryptjs';
import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

dotenv.config();

const app = express();

// --- CORS setup for dynamic localhost origins ---
app.use(cors({
  origin: function(origin, callback) {
    // allow requests with no origin (like Postman or mobile apps)
    if (!origin) return callback(null, true);
    // allow all localhost ports
    if (/^http:\/\/localhost:\d+$/.test(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
}));

// parse JSON bodies
app.use(express.json());

// --- MongoDB connection ---
const MONGO_URI = process.env.MONGO_URI || 'your-mongo-uri-here';
mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

// --- JWT secret ---
const JWT_SECRET = process.env.JWT_SECRET || 'your_jwt_secret';

// --- User Schema ---
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  healthSetupCompleted: { type: Boolean, default: false },
});

const User = mongoose.model('User', userSchema);

// --- Routes ---

// Signup
app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password } = req.body;
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) return res.json({ success: false, message: 'Email already exists' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = await User.create({ name, email, password: hashedPassword });

    const token = jwt.sign({ id: newUser._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, user: newUser, token });
  } catch (err) {
    console.error('Signup error:', err);
    res.json({ success: false, message: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.json({ success: false, message: 'Invalid credentials' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.json({ success: false, message: 'Invalid credentials' });

    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: '7d' });

    res.json({ success: true, user, token });
  } catch (err) {
    console.error('Login error:', err);
    res.json({ success: false, message: 'Server error' });
  }
});

// Test route
app.get('/', (req, res) => {
  res.send('Backend running ✅');
});

// --- Start server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
//end 