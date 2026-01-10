 import Goals from '../models/Goals.js';
 import HealthMetric from '../models/HealthMetric.js';
 import Settings from '../models/Settings.js';
 import PushToken from '../models/PushToken.js';
 import Expo from 'expo-server-sdk';

 const todayRange = () => {
   const start = new Date();
   start.setHours(0, 0, 0, 0);
   const end = new Date();
   return { start, end };
 };

 const calculateMessages = (metrics, goals) => {
   const messages = [];

   if (metrics.steps < goals.steps) {
     messages.push(`You still have ${goals.steps - metrics.steps} steps to go`);
   }
   if (metrics.calories < goals.calories) {
     messages.push(`You can still consume ${goals.calories - metrics.calories} kcal today`);
   }
   if (metrics.sleepHours < goals.sleep) {
     const hoursLeft = Math.max(0, goals.sleep - metrics.sleepHours);
     messages.push(`You need ${hoursLeft.toFixed(1)} more hours of sleep`);
   }
   if (metrics.water < goals.water) {
     messages.push(`You haven't completed your water goal`);
   }
   return messages;
 };

 export const getGoals = async (req, res) => {
   try {
     const goals = await Goals.findOne({ user: req.user.id });
     res.status(200).json({ success: true, goals });
   } catch (error) {
     console.error('Get goals error:', error);
     res.status(500).json({ success: false, message: 'Error fetching goals' });
   }
 };

 export const upsertGoals = async (req, res) => {
   try {
     const { steps, water, sleep, calories, pushEnabled } = req.body;
     const goals = await Goals.findOneAndUpdate(
       { user: req.user.id },
       { steps, water, sleep, calories, pushEnabled },
       { upsert: true, new: true, setDefaultsOnInsert: true }
     );

     res.status(200).json({ success: true, goals });
   } catch (error) {
     console.error('Update goals error:', error);
     res.status(500).json({ success: false, message: 'Error updating goals' });
   }
 };

 export const checkGoalProgress = async (req, res) => {
   try {
     const goals = await Goals.findOne({ user: req.user.id }) || new Goals();
     const { start, end } = todayRange();

     const metrics = await HealthMetric.findOne({
       user: req.user.id,
       date: { $gte: start, $lte: end }
     }).sort({ date: -1 });

     const current = {
       steps: metrics?.steps || 0,
       calories: metrics?.calories || 0,
       sleepHours: metrics?.sleepHours || 0,
       water: metrics?.water || 0,
     };

     const messages = calculateMessages(current, goals);

     res.status(200).json({
       success: true,
       goals,
       metrics: current,
       messages,
     });
   } catch (error) {
     console.error('Check goal progress error:', error);
     res.status(500).json({ success: false, message: 'Error checking progress' });
   }
 };

 // Update today's water intake (glasses)
 export const updateWaterIntake = async (req, res) => {
   try {
     const { water } = req.body;
     if (water === undefined || water === null) {
       return res.status(400).json({ success: false, message: 'water is required' });
     }

     const { start, end } = todayRange();
     const metric = await HealthMetric.findOneAndUpdate(
       {
         user: req.user.id,
         date: { $gte: start, $lte: end }
       },
       {
         user: req.user.id,
         source: 'manual',
         water,
         syncedAt: new Date(),
       },
       { upsert: true, new: true, setDefaultsOnInsert: true }
     );

     res.status(200).json({ success: true, metric });
   } catch (error) {
     console.error('Update water intake error:', error);
     res.status(500).json({ success: false, message: 'Error updating water intake' });
   }
 };

 // Simple background evaluator used by the scheduler
 export const evaluateGoalsForAllUsers = async () => {
   const { start, end } = todayRange();
   const goals = await Goals.find({});
   const expo = new Expo.Expo();

   for (const goal of goals) {
     const settings = await Settings.findOne({ user: goal.user });
     if (settings?.notifications?.goalAlerts === false || goal.pushEnabled === false) continue;

     const metrics = await HealthMetric.findOne({
       user: goal.user,
       date: { $gte: start, $lte: end }
     }).sort({ date: -1 });

     const current = {
       steps: metrics?.steps || 0,
       calories: metrics?.calories || 0,
       sleepHours: metrics?.sleepHours || 0,
       water: metrics?.water || 0,
     };

     const messages = calculateMessages(current, goal);
     if (!messages.length) continue;

     const tokens = await PushToken.find({ user: goal.user });
     if (!tokens.length) continue;

     const pushMessages = tokens
       .filter(t => Expo.isExpoPushToken(t.token))
       .map(t => ({
         to: t.token,
         sound: 'default',
         title: 'Goal Update',
         body: messages[0],
         data: { messages },
       }));

     if (!pushMessages.length) continue;

     try {
       const chunks = expo.chunkPushNotifications(pushMessages);
       for (const chunk of chunks) {
         await expo.sendPushNotificationsAsync(chunk);
       }
     } catch (err) {
       console.error('Push send error:', err);
     }
   }
 };

 // Register Expo push token
 export const registerPushToken = async (req, res) => {
   try {
     const { token, platform } = req.body;
     if (!token) {
       return res.status(400).json({ success: false, message: 'token is required' });
     }
     if (!Expo.isExpoPushToken(token)) {
       return res.status(400).json({ success: false, message: 'Invalid Expo push token' });
     }

     const saved = await PushToken.findOneAndUpdate(
       { token },
       { user: req.user.id, platform: platform || 'unknown', lastUsedAt: new Date() },
       { upsert: true, new: true, setDefaultsOnInsert: true }
     );

     res.status(200).json({ success: true, pushToken: saved });
   } catch (error) {
     console.error('Register push token error:', error);
     res.status(500).json({ success: false, message: 'Error registering push token' });
   }
 };

