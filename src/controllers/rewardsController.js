import User from '../models/User.js';

// Define fixed points for specific actions
const ACTION_POINTS = {
  DAILY_LOGIN: 5,
  LOG_MEAL: 10,
  HEALTH_PREDICTION: 20,
  HIT_GOAL: 50
};

// Define badges criteria based on points and streak
const BADGE_CRITERIA = {
  '1': { type: 'points', threshold: 50 },     // First Milestone
  '2': { type: 'streak', threshold: 3 },      // 3-Day Explorer
  '3': { type: 'points', threshold: 200 },    // Century Mark
  '4': { type: 'streak', threshold: 7 },      // 7-Day Champion
  '5': { type: 'points', threshold: 500 },    // Master Tracker
  '6': { type: 'points', threshold: 1000 },   // SweetTrack Legend
};

export const syncRewardsAndStreak = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let streakChanged = false;
    let newBadges = [];

    // Calculate streak
    if (user.lastActivityDate) {
      const lastActivity = new Date(user.lastActivityDate);
      lastActivity.setHours(0, 0, 0, 0);

      const diffTime = Math.abs(today - lastActivity);
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (diffDays === 1) {
        // Logged in consecutive day
        user.streak += 1;
        streakChanged = true;
      } else if (diffDays > 1) {
        // Streak broken
        user.streak = 1;
        streakChanged = true;
      }
      // If diffDays === 0, they already logged in today, do nothing.
    } else {
      // First time activity
      user.streak = 1;
      streakChanged = true;
    }

    user.lastActivityDate = new Date();

    // Evaluate Badges
    Object.keys(BADGE_CRITERIA).forEach(badgeId => {
      if (!user.unlockedBadges.includes(badgeId)) {
        const criteria = BADGE_CRITERIA[badgeId];
        if (criteria.type === 'points' && user.rewardsPoints >= criteria.threshold) {
          user.unlockedBadges.push(badgeId);
          newBadges.push(badgeId);
        } else if (criteria.type === 'streak' && user.streak >= criteria.threshold) {
          user.unlockedBadges.push(badgeId);
          newBadges.push(badgeId);
        }
      }
    });

    await user.save();

    res.status(200).json({
      success: true,
      rewardsPoints: user.rewardsPoints,
      streak: user.streak,
      unlockedBadges: user.unlockedBadges,
      newBadges: newBadges,
      streakUpdated: streakChanged
    });

  } catch (error) {
    console.error('❌ Sync rewards error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

export const awardPoints = async (req, res) => {
  try {
    const { actionType } = req.body;
    
    if (!ACTION_POINTS[actionType]) {
      return res.status(400).json({ success: false, message: 'Invalid action type' });
    }

    const pointsToAward = ACTION_POINTS[actionType];

    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    user.rewardsPoints += pointsToAward;

    // Fast evaluate badges on points update
    let newBadges = [];
    Object.keys(BADGE_CRITERIA).forEach(badgeId => {
      if (!user.unlockedBadges.includes(badgeId)) {
        const criteria = BADGE_CRITERIA[badgeId];
        if (criteria.type === 'points' && user.rewardsPoints >= criteria.threshold) {
          user.unlockedBadges.push(badgeId);
          newBadges.push(badgeId);
        }
      }
    });

    await user.save();

    res.status(200).json({
      success: true,
      message: `Awarded ${pointsToAward} points for ${actionType}`,
      rewardsPoints: user.rewardsPoints,
      unlockedBadges: user.unlockedBadges,
      newBadges: newBadges
    });

  } catch (error) {
    console.error('❌ Award points error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
