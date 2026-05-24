import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

// Initialize the Google Generative AI client
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

/**
 * Generates a response from Gemini based on text prompt and optional image
 * @param {string} prompt - The user's text message
 * @param {Buffer|null} imageBuffer - Optional image buffer
 * @param {string|null} mimeType - Optional image mime type
 * @param {Array} history - Previous conversation messages
 * @param {string} systemPrompt - Rules for the AI
 * @returns {Promise<string>} - The AI response
 */
export const generateChatResponse = async (prompt, imageBuffer = null, mimeType = 'image/jpeg', history = [], systemPrompt = '') => {
  try {
    // 1. Choose the model
    // 🚀 Upgrading for 2026 Compatibility: Using Gemini 1.5 Flash
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash',
      systemInstruction: systemPrompt,
    });

    const contents = [];

    // 2. Add history (Gemini format: { role: 'user'|'model', parts: [{ text: '...' }] })
    if (history && Array.isArray(history)) {
      history.forEach(msg => {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        });
      });
    }

    // 3. Construct current message
    const currentParts = [{ text: prompt }];

    if (imageBuffer) {
      currentParts.push({
        inlineData: {
          data: imageBuffer.toString('base64'),
          mimeType: mimeType
        }
      });
    }

    contents.push({
      role: 'user',
      parts: currentParts
    });

    // 4. Generate content
    const result = await model.generateContent({
      contents,
      generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.7,
      },
    });

    const response = await result.response;
    const text = response.text();

    if (!text) {
      throw new Error('Empty response from Gemini');
    }

    return text;

  } catch (error) {
    console.error('❌ Gemini Service Error:', error.message);
    throw error;
  }
};
