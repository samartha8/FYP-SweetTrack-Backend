import express from 'express';
import Groq from 'groq-sdk';

const router = express.Router();

let groq = null;

// ✅ Initialize Groq safely
if (process.env.GROQ_API_KEY?.trim()) {
  try {
    groq = new Groq({
      apiKey: process.env.GROQ_API_KEY.trim(),
    });
    console.log('✅ Groq client initialized');
  } catch (err) {
    console.error('❌ Groq init failed:', err.message);
    groq = null;
  }
} else {
  console.warn('⚠️ GROQ_API_KEY missing - fallback mode active');
}

router.post('/', async (req, res) => {
  try {
    // ✅ Ensure body exists
    if (!req.body) {
      return res.status(400).json({
        success: false,
        message: 'Request body missing',
      });
    }

    const { message, riskLevel } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
      });
    }

    // ✅ Fallback mode (no AI, no crash)
    if (!groq) {
      return res.json({
        success: true,
        reply:
          'I am currently offline. Please maintain a balanced diet, stay active, drink enough water, and monitor your health regularly.',
      });
    }

    const prompt = `
You are SweetTrack AI, a friendly diabetes wellness assistant.

User diabetes risk level: ${riskLevel || 'Unknown'}

User question:
"${message}"

Rules:
- Give general wellness advice only
- No medical diagnosis
- Be short, clear, and supportive
`;

const chat = await groq.chat.completions.create({
  model: 'llama-3.3-70b-versatile',
  messages: [{ role: 'user', content: prompt }],
  temperature: 0.6,
  max_tokens: 300,
});

const reply = chat?.choices?.[0]?.message?.content;

if (!reply) {
  throw new Error('Empty AI response');
}

res.json({
  success: true,
  reply,
});

  } catch (error) {
    console.error('Chatbot error (Groq):', error.message);
    res.json({
      success: true,
      reply:
        'I am having trouble responding right now. Please try again later.',
    });
  }
});

export default router;
