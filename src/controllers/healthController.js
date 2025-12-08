import Health from '../models/Health.js';
import User from '../models/User.js';

export const saveHealthData = async (req, res) => {
  try {
    const userId = req.user.id;
    const existingHealth = await Health.findOne({ user: userId });

    if (existingHealth) {
      await Health.updateOne({ user: userId }, req.body);
    } else {
      await Health.create({ user: userId, ...req.body });
    }

    await User.findByIdAndUpdate(userId, { healthSetupCompleted: true });

    res.status(200).json({ message: 'Health data saved successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

export const getHealthData = async (req, res) => {
  try {
    const userId = req.user.id;
    const health = await Health.findOne({ user: userId });
    res.status(200).json(health);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
