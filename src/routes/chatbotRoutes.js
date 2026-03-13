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

    const systemPrompt = `
You are SweetTrack AI, a friendly diabetes wellness assistant.

User Name: ${userName || 'User'}
User diabetes risk level: ${riskLevel || 'Unknown'}
Language Preference: ${language === 'ne' ? 'Nepali' : language === 'ja' ? 'Japanese' : 'English'}

Rules:
- IMPORTANT: The user's preferred language is ${language === 'ne' ? 'Nepali' : language === 'ja' ? 'Japanese' : 'English'}.
- You MUST respond ONLY in ${language === 'ne' ? 'Nepali' : language === 'ja' ? 'Japanese' : 'English'}.
- Be CONCISE but COMPREHENSIVE. Avoid unnecessarily long paragraphs.
- Structure your response for "Medium Readability": use bullet points, bolding for key terms, and clear short sections.
- Explain the "WHY" behind your advice simply (biological or health mechanisms).
- If symptoms are described, explain potential causes broadly without diagnosing.
- Suggest immediate lifestyle adjustments or precautions.
- Always conclude with a recommendation to consult a doctor for persistent symptoms.
- Be empathetic and supportive.
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
