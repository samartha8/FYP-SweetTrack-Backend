import express from 'express';
import Groq from 'groq-sdk';
import { optionalAuth } from '../middleware/authMiddleware.js';
import DiabetesPrediction from '../models/DiabetesPrediction.js';

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

router.post('/', optionalAuth, async (req, res) => {
  try {
    // ✅ Ensure body exists
    if (!req.body) {
      return res.status(400).json({
        success: false,
        message: 'Request body missing',
      });
    }

    const { message, riskLevel, history, userName, language } = req.body;
    console.log('🤖 Chatbot Request:', { message, language, userName });

    if (!message || typeof message !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'Message is required',
      });
    }

    // ✅ Language-aware Fallback
    if (!groq) {
      const fallbacks = {
        en: 'I am currently offline. Please maintain a balanced diet, stay active, drink enough water, and monitor your health regularly.',
        ne: 'म अहिले अफलाइन छु। कृपया सन्तुलित आहार कायम राख्नुहोस्, सक्रिय रहनुहोस्, पर्याप्त पानी पिउनुहोस्, र नियमित रूपमा आफ्नो स्वास्थ्यको निगरानी गर्नुहोस्।',
        ja: '現在オフラインです。バランスの取れた食事を心がけ、活動的に過ごし、水分を十分に摂り、定期的に健康状態を確認してください。'
      };
      return res.json({
        success: true,
        reply: fallbacks[language] || fallbacks.en,
      });
    }

    // ✅ Fetch Latest Health Analysis if user is logged in
    let healthContext = "No recent health analysis available.";
    if (req.user) {
      try {
        const latestPrediction = await DiabetesPrediction.findOne({ user: req.user._id }).sort({ createdAt: -1 });
        if (latestPrediction) {
          healthContext = `
Latest Diabetes Risk Analysis:
- Risk Level: ${latestPrediction.riskLevel}
- Risk Score: ${latestPrediction.riskScore}/100
- Key Insights: ${latestPrediction.insights.join(', ')}
- Analyzed Factors: ${Object.entries(latestPrediction.inputData || {})
            .filter(([_, v]) => v !== undefined && v !== null)
            .map(([k, v]) => `${k}: ${v}`).join(', ')}
`;
        }
      } catch (err) {
        console.error('Error fetching health context for chatbot:', err);
      }
    }

    const systemPrompt = `
STRICT DOMAIN RULES (CRITICAL):
1. **YOU ARE A HEALTH AND DIABETES ONLY ASSISTANT.** 
2. **ABSORUTELY FORBIDDEN TOPICS**: Geography, politics, history (World Wars), schools (Herald), celebrities, sports, general entertainment, or "fictional scenarios".
3. **MANDATORY REFUSAL**: If a user asks ANY question not directly related to health, wellness, nutrition, exercise, or diabetes, you MUST say:
   - English: "I am sorry, but I am strictly trained to provide medical wellness and diabetes-related assistance for SweetTrack. I cannot answer questions about [topic]."
   - Nepali: "म क्षमाप्रार्थी छु, तर म केवल SweetTrack को लागि स्वास्थ्य र मधुमेह सम्बन्धी जानकारी दिन प्रशिक्षित छु। म [topic] को बारेमा कुरा गर्न सक्दिन।"
   - Japanese: "申し訳ありませんが、私はSweetTrackの健康と糖尿病のウェルネスサポートに特化したAIです。[topic]に関する質問にはお答えできません。"
4. **NO HALLUCINING**: Do not try to be "helpful" by answering unrelated questions. Refuse immediately.

Identity: You are SweetTrack AI.
User Name: ${userName || (req.user ? req.user.name : 'User')}
User Language Preference: ${language === 'ne' ? 'Nepali' : language === 'ja' ? 'Japanese' : 'English'}

Current User Health Context:
${healthContext}

Additional Rules:
- You MUST respond ONLY in ${language === 'ne' ? 'Nepali' : language === 'ja' ? 'Japanese' : 'English'}.
- Be CONCISE. Structure your response with bullet points and bolding for key health terms.
- Always recommend consulting a professional for specific medical symptoms.
`;

    // Construct full conversation history
    const messages = [{ role: 'system', content: systemPrompt }];

    // Append history if valid
    if (Array.isArray(history)) {
      history.forEach(msg => {
        if (msg.role && msg.content) {
          messages.push({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.content
          });
        }
      });
    }

    // Append current message
    messages.push({ role: 'user', content: message });

    const chat = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: messages, // ✅ Use full conversation history
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
