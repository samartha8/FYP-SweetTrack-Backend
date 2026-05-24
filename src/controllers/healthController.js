import Health from '../models/Health.js';
import User from '../models/User.js';
import HealthRecord from '../models/Record.js';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// @desc    Save or update health data
// @route   POST /api/health
// @access  Private
export const saveHealthData = async (req, res) => {
  try {
    const userId = req.user.id;
    const healthData = req.body;

    // Check if health data already exists
    let health = await Health.findOne({ user: userId });

    // Validate required fields ONLY for new health setup (creation)
    if (!health) {
      const requiredFields = ['age'];
      const hasRequiredFields = requiredFields.every(field => healthData[field] !== undefined && healthData[field] !== null && healthData[field] !== '');

      if (!hasRequiredFields) {
        return res.status(400).json({
          success: false,
          message: 'Age is required to create a health profile'
        });
      }
    }

    // Sanitization: Remove fields that shouldn't be updated directly via payload
    const sanitizedData = { ...healthData };
    delete sanitizedData._id;
    delete sanitizedData.id;
    delete sanitizedData.user;
    delete sanitizedData.createdAt;
    delete sanitizedData.updatedAt;

    if (health) {
      // Update existing health data
      Object.keys(sanitizedData).forEach(key => {
        if (sanitizedData[key] !== undefined && sanitizedData[key] !== null && sanitizedData[key] !== '') {
          const oldValue = health[key];
          health[key] = sanitizedData[key];

          // Data Integrity: Reset source to 'manual' if value changed manually
          // (Unless the payload explicitly includes a new source flag)
          if (oldValue !== sanitizedData[key]) {
            if (key === 'hba1cEstimated' && sanitizedData.hba1cSource !== 'report') health.hba1cSource = 'manual';
            if (key === 'bloodGlucoseEstimated' && sanitizedData.glucoseSource !== 'report') health.glucoseSource = 'manual';
            if (key === 'highBP' && sanitizedData.bpSource !== 'report') health.bpSource = 'manual';
            if (key === 'bmi' && sanitizedData.bmiSource !== 'report') health.bmiSource = 'manual';
            if (['age', 'sex', 'height', 'weight'].includes(key) && sanitizedData.demographicsSource !== 'report') health.demographicsSource = 'manual';
          }
        }
      });
      await health.save();
    } else {
      // Create new health data
      health = await Health.create({
        user: userId,
        ...sanitizedData
      });
      
      // Link health data to user
      await User.findByIdAndUpdate(userId, { healthData: health._id });
    }

    // Mark health setup as completed
    await User.findByIdAndUpdate(userId, { healthSetupCompleted: true });

    res.status(200).json({
      success: true,
      message: 'Health data saved successfully',
      healthData: health
    });
  } catch (error) {
    console.error('Save health data error:', error);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Data validation failed',
        errors: Object.values(error.errors).map(e => e.message)
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || 'Error saving health data'
    });
  }
};

// @desc    Get user health data
// @route   GET /api/health
// @access  Private
export const getHealthData = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const health = await Health.findOne({ user: userId });

    if (!health) {
      return res.status(404).json({
        success: false,
        message: 'Health data not found'
      });
    }

    res.status(200).json({
      success: true,
      healthData: health
    });
  } catch (error) {
    console.error('Get health data error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching health data'
    });
  }
};

// @desc    Update health data
// @route   PUT /api/health
// @access  Private
export const updateHealthData = async (req, res) => {
  try {
    const userId = req.user.id;
    const updateData = req.body;

    let health = await Health.findOne({ user: userId });

    if (!health) {
      return res.status(404).json({
        success: false,
        message: 'Health data not found. Please create health data first.'
      });
    }

    // Update fields with Data Integrity check
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined && updateData[key] !== null && updateData[key] !== '') {
        const oldValue = health[key];
        health[key] = updateData[key];

        // Reset source to 'manual' if value changed manually
        if (oldValue !== updateData[key]) {
          if (key === 'hba1cEstimated' && updateData.hba1cSource !== 'report') health.hba1cSource = 'manual';
          if (key === 'bloodGlucoseEstimated' && updateData.glucoseSource !== 'report') health.glucoseSource = 'manual';
          if (key === 'highBP' && updateData.bpSource !== 'report') health.bpSource = 'manual';
          if (key === 'bmi' && updateData.bmiSource !== 'report') health.bmiSource = 'manual';
          if (['age', 'sex', 'height', 'weight'].includes(key) && updateData.demographicsSource !== 'report') health.demographicsSource = 'manual';
        }
      }
    });

    await health.save();

    res.status(200).json({
      success: true,
      message: 'Health data updated successfully',
      healthData: health
    });
  } catch (error) {
    console.error('Update health data error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error updating health data'
    });
  }
};

// @desc    Delete health data
// @route   DELETE /api/health
// @access  Private
export const deleteHealthData = async (req, res) => {
  try {
    const userId = req.user.id;

    const health = await Health.findOneAndDelete({ user: userId });

    if (!health) {
      return res.status(404).json({
        success: false,
        message: 'Health data not found'
      });
    }

    // Reset health setup status
    await User.findByIdAndUpdate(userId, {
      healthSetupCompleted: false,
      healthData: null
    });

    res.status(200).json({
      success: true,
      message: 'Health data deleted successfully'
    });
  } catch (error) {
    console.error('Delete health data error:', error);
    res.status(500).json({
      success: false,
      message: 'Error deleting health data'
    });
  }
};

// @desc    Scan medical report and auto-fill health setup
// @route   POST /api/health/scan
// @access  Private
export const scanMedicalReport = async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    
    if (!imageBase64) {
      return res.status(400).json({ success: false, message: 'Image is required' });
    }

    console.log("Analyzing medical report via Groq Vision API...");

    // 1. Process via Groq Vision API
    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `You are an expert medical data extractor. Extract health values from this medical report.
              LOOK FOR THESE KEYWORDS:
              - Sex: Look for "Gender", "Sex", "M/F", "Male/Female".
              - Glucose: Look for "Glucose", "Blood Sugar", "Fasting Glucose", "FBS", "RBS".
              - HbA1c: Look for "HbA1c", "Glycated Hemoglobin", "A1c".
              - Height/Weight: Look for "BMI", "Height", "Weight", "Ht", "Wt".
              - Medical History: Look for "Hypertension", "Hyperlipidemia", "BP", "Cholesterol".

              Respond strictly with valid JSON:
              {
                "age": "extract exact number (e.g. 22)",
                "weight": "exact number in kg",
                "height": "exact number in cm",
                "sex": "0 if Female, 1 if Male, null if missing",
                "highBP": "1 if High Blood Pressure/Hypertension mentioned as high, 0 if normal, null if missing",
                "highChol": "1 if High Cholesterol/Lipid issue mentioned as high, 0 if normal, null if missing",
                "genHlth": "1-5 integer estimating health (1=excellent, 5=poor), null if unguessable",
                "hba1cEstimated": "exact number (e.g. 5.7), null if missing",
                "bloodGlucoseEstimated": "exact number (e.g. 110), null if missing"
              }
              ONLY output raw JSON.`
            },
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/jpeg;base64,' + imageBase64
              }
            }
          ]
        }
      ],
      temperature: 0.1,
    });

    const aiContent = response.choices[0].message.content;
    const jsonMatch = aiContent.match(/\{[\s\S]*?\}/);
    if (!jsonMatch) {
      throw new Error("AI failed to return valid JSON format");
    }

    const reportData = JSON.parse(jsonMatch[0]);

    // 2. Save the report securely as requested by the user
    // We create a new HealthRecord for reference so it appears in the Profile
    await HealthRecord.create({
      user: req.user.id,
      recordName: 'AI Medical Scan (Onboarding)',
      recordType: 'Report',
      fileUrl: 'data:image/jpeg;base64,' + imageBase64,
      notes: 'Auto-scanned during Health Setup Onboarding'
    });

    res.status(200).json({
      success: true,
      data: reportData,
      message: 'Report scanned and saved successfully'
    });

  } catch (error) {
    console.error('Scan Medical Report error:', error);
    res.status(500).json({
      success: false,
      message: 'Error analyzing medical report',
      error: error.message
    });
  }
};
