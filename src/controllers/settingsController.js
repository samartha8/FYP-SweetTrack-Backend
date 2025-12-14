import Settings from '../models/Settings.js';
import User from '../models/User.js';

// @desc    Get user settings
// @route   GET /api/settings
// @access  Private
export const getSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    
    let settings = await Settings.findOne({ user: userId });
    
    // Create default settings if none exist
    if (!settings) {
      settings = await Settings.create({
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
      
      // Link settings to user
      await User.findByIdAndUpdate(userId, { settings: settings._id });
    }
    
    res.status(200).json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching settings'
    });
  }
};

// @desc    Update user settings
// @route   PUT /api/settings
// @access  Private
export const updateSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    const updateData = req.body;
    
    let settings = await Settings.findOne({ user: userId });
    
    if (!settings) {
      // Create new settings if they don't exist
      settings = await Settings.create({
        user: userId,
        ...updateData
      });
      
      await User.findByIdAndUpdate(userId, { settings: settings._id });
    } else {
      // Update existing settings
      if (updateData.notifications) {
        settings.notifications = {
          ...settings.notifications,
          ...updateData.notifications
        };
      }
      
      if (updateData.accessibility) {
        settings.accessibility = {
          ...settings.accessibility,
          ...updateData.accessibility
        };
      }
      
      // Update other fields
      Object.keys(updateData).forEach(key => {
        if (key !== 'notifications' && key !== 'accessibility' && key !== 'user') {
          settings[key] = updateData[key];
        }
      });
      
      await settings.save();
    }
    
    res.status(200).json({
      success: true,
      message: 'Settings updated successfully',
      settings
    });
  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating settings'
    });
  }
};

// @desc    Reset settings to default
// @route   POST /api/settings/reset
// @access  Private
export const resetSettings = async (req, res) => {
  try {
    const userId = req.user.id;
    
    const defaultSettings = {
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
    };
    
    let settings = await Settings.findOne({ user: userId });
    
    if (settings) {
      Object.assign(settings, defaultSettings);
      await settings.save();
    } else {
      settings = await Settings.create({
        user: userId,
        ...defaultSettings
      });
      await User.findByIdAndUpdate(userId, { settings: settings._id });
    }
    
    res.status(200).json({
      success: true,
      message: 'Settings reset to default',
      settings
    });
  } catch (error) {
    console.error('Reset settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error resetting settings'
    });
  }
};

