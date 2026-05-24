 import Goals from '../models/Goals.js';
 import HealthMetric from '../models/HealthMetric.js';
 import Settings from '../models/Settings.js';
 import PushToken from '../models/PushToken.js';
 import { Expo } from 'expo-server-sdk';

 const MAX_DAILY_WATER_GLASSES = 20;
 const WATER_BOUNDS_MESSAGE = 'Value out of bounds. Please enter a realistic daily water intake.';
 const DEFAULT_GOALS = {
   steps: 10000,
   water: 8,
   sleep: 8,
   calories: 2000,
   pushEnabled: true,
 };

 const todayRange = () => {
   const start = new Date();
   start.setHours(0, 0, 0, 0);
   const end = new Date();
   return { start, end };
 };

 const calculateMessages = (metrics, goals) => {
   const messages = [];

   if (metrics.steps < goals.steps) {
     messages.push(`SweetTrack reminder: you have ${goals.steps - metrics.steps} steps left to reach today's movement goal.`);
   }
   if (metrics.calories < goals.calories) {
     messages.push(`SweetTrack reminder: you have ${goals.calories - metrics.calories} kcal remaining in today's calorie goal.`);
   }
   if (metrics.sleepHours < goals.sleep) {
     const hoursLeft = Math.max(0, goals.sleep - metrics.sleepHours);
     messages.push(`SweetTrack reminder: aim for ${hoursLeft.toFixed(1)} more hours of sleep to complete your rest goal.`);
   }
   if (metrics.water < goals.water) {
     messages.push(`SweetTrack reminder: drink a little more water to complete today's hydration goal.`);
   }
   return messages;
 };

 export const getGoals = async (req, res) => {
   try {
     const goals = await Goals.findOneAndUpdate(
       { user: req.user.id },
       { $setOnInsert: { user: req.user.id, ...DEFAULT_GOALS } },
       { upsert: true, new: true, setDefaultsOnInsert: true }
     );
     res.status(200).json({ success: true, goals });
   } catch (error) {
     console.error('Get goals error:', error);
     res.status(500).json({ success: false, message: 'Error fetching goals' });
   }
 };

 export const upsertGoals = async (req, res) => {
   try {
     const { steps, water, sleep, calories, pushEnabled } = req.body;
     const updates = { ...DEFAULT_GOALS };
     if (steps !== undefined) updates.steps = Number(steps) > 0 ? Number(steps) : DEFAULT_GOALS.steps;
     if (water !== undefined) updates.water = Number(water) > 0 ? Number(water) : DEFAULT_GOALS.water;
     if (sleep !== undefined) updates.sleep = Number(sleep) > 0 ? Number(sleep) : DEFAULT_GOALS.sleep;
     if (calories !== undefined) updates.calories = Number(calories) > 0 ? Number(calories) : DEFAULT_GOALS.calories;
     if (pushEnabled !== undefined) updates.pushEnabled = Boolean(pushEnabled);

     const goals = await Goals.findOneAndUpdate(
       { user: req.user.id },
       updates,
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
     const waterValue = Number(water);
     if (!Number.isFinite(waterValue) || waterValue < 0 || waterValue > MAX_DAILY_WATER_GLASSES) {
       return res.status(400).json({ success: false, message: WATER_BOUNDS_MESSAGE });
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
         water: waterValue,
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
   const expo = new Expo();

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

     await PushToken.deleteMany({ user: req.user.id, token: { $ne: token } });

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

 export const sendTestNotification = async (req, res) => {
   try {
     const tokens = await PushToken.find({ user: req.user.id }).sort({ lastUsedAt: -1, updatedAt: -1 });
     const validTokens = tokens.filter(t => Expo.isExpoPushToken(t.token));

     if (!validTokens.length) {
       return res.status(404).json({
         success: false,
         message: 'No registered Expo push token found for this user',
       });
     }

     const expo = new Expo();
     const latestToken = validTokens[0];
     const messages = [{
       to: latestToken.token,
       sound: 'default',
       title: 'SweetTrack Test',
       body: 'SweetTrack reminders are active and ready to support your daily health goals.',
       data: { type: 'test' },
     }];

     const tickets = [];
     const chunks = expo.chunkPushNotifications(messages);
     for (const chunk of chunks) {
       tickets.push(...await expo.sendPushNotificationsAsync(chunk));
     }

     res.status(200).json({ success: true, tickets });
   } catch (error) {
     console.error('Test notification error:', error);
     res.status(500).json({ success: false, message: 'Error sending test notification' });
   }
 };

