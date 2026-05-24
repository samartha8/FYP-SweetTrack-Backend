import HealthMetric from '../models/HealthMetric.js';

const MAX_DAILY_WATER_GLASSES = 20;
const WATER_BOUNDS_MESSAGE = 'Value out of bounds. Please enter a realistic daily water intake.';

const getDayRange = (dateStr) => {
  // If dateStr (YYYY-MM-DD) is provided, use it to define the 24h window in UTC
  // Otherwise default to current server time's day
  if (dateStr) {
    const start = new Date(`${dateStr}T00:00:00.000Z`);
    const end = new Date(`${dateStr}T23:59:59.999Z`);
    return { start, end };
  }

  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start, end };
};


// @desc    Update today's wellness metrics
// @route   PUT /api/wellness/metrics
// @access  Private
export const updateDailyMetrics = async (req, res) => {
  try {
    const { steps, water, sleep, calories, date: dateStr } = req.body;
    const { start, end } = getDayRange(dateStr);

    // Build update object only with provided fields
    const updateData = {
      user: req.user.id,
      source: 'manual',
      syncedAt: new Date()
    };

    if (steps !== undefined) updateData.steps = steps;
    if (water !== undefined) {
      const waterValue = Number(water);
      if (!Number.isFinite(waterValue) || waterValue < 0 || waterValue > MAX_DAILY_WATER_GLASSES) {
        return res.status(400).json({ success: false, message: WATER_BOUNDS_MESSAGE });
      }
      updateData.water = waterValue;
    }
    if (sleep !== undefined) updateData.sleepHours = sleep;
    if (calories !== undefined) updateData.calories = calories;

    const metric = await HealthMetric.findOneAndUpdate(
      {
        user: req.user.id,
        date: { $gte: start, $lte: end }
      },
      updateData,
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({
      success: true,
      message: 'Daily metrics updated successfully',
      metrics: metric
    });
  } catch (error) {
    console.error('Update daily metrics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating daily metrics'
    });
  }
};

// @desc    Get today's wellness metrics
// @route   GET /api/wellness/metrics
// @access  Private
export const getDailyMetrics = async (req, res) => {
  try {
    const { date: dateStr } = req.query;
    const { start, end } = getDayRange(dateStr);
    
    const metric = await HealthMetric.findOne({
      user: req.user.id,
      date: { $gte: start, $lte: end }
    });

    // Map sleepHours -> sleep for frontend consistency
    const responseMetrics = metric ? {
      steps: metric.steps || 0,
      water: metric.water || 0,
      sleep: metric.sleepHours || 0,
      calories: metric.calories || 0,
    } : { steps: 0, water: 0, sleep: 0, calories: 0 };

    res.status(200).json({
      success: true,
      metrics: responseMetrics
    });

  } catch (error) {
    console.error('Get daily metrics error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching daily metrics'
    });
  }
};
