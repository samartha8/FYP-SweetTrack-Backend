import 'dotenv/config';
import mongoose from 'mongoose';
import MealLog from './src/models/MealLog.js';

async function checkLogs() {
    if (!process.env.MONGO_URI) {
        console.error('MONGO_URI not found in environment');
        return;
    }
    await mongoose.connect(process.env.MONGO_URI);
    const logs = await MealLog.find().sort({ createdAt: -1 }).limit(5);
    console.log(JSON.stringify(logs, null, 2));
    await mongoose.connection.close();
}

checkLogs().catch(console.error);
