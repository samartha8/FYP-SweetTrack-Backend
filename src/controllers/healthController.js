import Health from '../models/Health.js';
import User from '../models/User.js';

// @desc    Save or update health data
// @route   POST /api/health
// @access  Private
export const saveHealthData = async (req, res) => {
  try {
    const userId = req.user.id;
    const healthData = req.body;

    // Validate required fields for health setup completion
    const requiredFields = ['age'];
    const hasRequiredFields = requiredFields.every(field => healthData[field] !== undefined && healthData[field] !== null && healthData[field] !== '');

    if (!hasRequiredFields) {
      return res.status(400).json({
        success: false,
        message: 'Age is required to complete health setup'
      });
    }

    // Check if health data already exists
    let health = await Health.findOne({ user: userId });

    if (health) {
      // Update existing health data
      Object.keys(healthData).forEach(key => {
        if (healthData[key] !== undefined && healthData[key] !== null && healthData[key] !== '') {
          health[key] = healthData[key];
        }
      });
      await health.save();
    } else {
      // Create new health data
      health = await Health.create({
        user: userId,
        ...healthData
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

    // Update fields
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined && updateData[key] !== null && updateData[key] !== '') {
        health[key] = updateData[key];
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
