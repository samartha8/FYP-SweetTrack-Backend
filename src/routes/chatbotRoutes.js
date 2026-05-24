import express from 'express';
import multer from 'multer';
import Groq from 'groq-sdk';
import { optionalAuth } from '../middleware/authMiddleware.js';
import DiabetesPrediction from '../models/DiabetesPrediction.js';
import { generateChatResponse } from '../services/aiService.js';


const router = express.Router();

// ✅ Configure Multer for image uploads (Memory Storage for speed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
});

// ✅ Main Chatbot Route (Supports Multimodal)
router.post('/', optionalAuth, upload.single('image'), async (req, res) => {
  try {
    // ✅ Ensure body exists
    if (!req.body) {
      return res.status(400).json({
        success: false,
        message: 'Request body missing',
      });
    }

    const { message, history: rawHistory, userName, language } = req.body;
    const history = typeof rawHistory === 'string' ? JSON.parse(rawHistory) : rawHistory;
    const imageFile = req.file;

    console.log('🤖 Multimodal Request:', { 
      message, 
      hasImage: !!imageFile, 
      language, 
      userName 
    });

    if (!message && !imageFile) {
      return res.status(400).json({
        success: false,
        message: 'Message or image is required',
      });
    }

    // 🟢 FETCH LATEST HEALTH CONTEXT

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
2. **ABSORUTELY FORBIDDEN TOPICS**: Geography, politics, history, non-health celebrities, sports (not related to fitness), or general entertainment.
3. **MANDATORY REFUSAL**: If a user asks ANY question not directly related to health, wellness, nutrition, exercise, or diabetes, you MUST say:
   - English: "I am sorry, but I am strictly trained to provide medical wellness and diabetes-related assistance for SweetTrack. I cannot answer questions about [topic]."
   - Nepali: "म क्षमाप्रार्थी छु, तर म केवल SweetTrack को लागि स्वास्थ्य र मधुमेह सम्बन्धी जानकारी दिन प्रशिक्षित छु। म [topic] को बारेमा कुरा गर्न सक्दिन।"
   - Japanese: "申し訳ありませんが、私はSweetTrackの健康と糖尿病のウェルネスサポートに特化したAIです。[topic]に関する質問にはお答えできません。"
4. **IMAGE ANALYSIS**: If an image is provided, focus on identifying foods, nutrition, skin symptoms (if medical), or lab reports. Be cautious and always suggest professional consultation for serious symptoms.
5. **IDENTITY**: You are SweetTrack AI.
6. **USER NAME**: ${userName || (req.user ? req.user.name : 'User')}
7. **LANGUAGE**: ${language === 'ne' ? 'Nepali' : language === 'ja' ? 'Japanese' : 'English'}
8. **CONTEXT**: ${healthContext}
`;

    // 🟢 UNIFIED AI SERVICE: Handles Text & Vision via Groq/Gemini
    const reply = await generateChatResponse(
      message || (imageFile ? "Analyze this health image" : ""),
      imageFile ? imageFile.buffer : null,
      imageFile ? imageFile.mimetype : 'image/jpeg',
      history || [],
      systemPrompt
    );

    if (!reply) {
      throw new Error('AI could not generate a response');
    }

    res.json({
      success: true,
      reply,
    });


  } catch (error) {
    console.error('❌ Chatbot error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to process chat message',
      reply: 'I am having trouble responding right now. Please try again later.'
    });
  }
});
export default router;
