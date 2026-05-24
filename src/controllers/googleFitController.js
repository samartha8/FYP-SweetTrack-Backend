import GoogleFit from "../models/GoogleFit.js";
import HealthMetric from "../models/HealthMetric.js";
import User from "../models/User.js";
import MealLog from "../models/MealLog.js";
import {
  exchangeCodeForTokens,
  getAuthorizationUrl,
  getBloodGlucoseData,
  getBloodPressureData,
  getCaloriesData,
  getHeartRateData,
  getSleepData,
  getStepsData,
  refreshAccessToken,
} from "../services/googleFitService.js";

// Google OAuth configuration (should be in .env)
// Note: These are read at runtime, not at module load time
const getGoogleClientId = () => process.env.GOOGLE_FIT_CLIENT_ID || "";
const getGoogleClientSecret = () => process.env.GOOGLE_FIT_CLIENT_SECRET || "";
const getGoogleRedirectUri = () =>
  process.env.GOOGLE_FIT_REDIRECT_URI ||
  "http://localhost:5000/api/google-fit/callback";

// For backward compatibility, keep constants but use getters
const GOOGLE_FIT_CLIENT_ID = getGoogleClientId();
const GOOGLE_FIT_CLIENT_SECRET = getGoogleClientSecret();
const GOOGLE_FIT_REDIRECT_URI = getGoogleRedirectUri();

// Required scopes for Google Fit
const GOOGLE_FIT_SCOPES = [
  "https://www.googleapis.com/auth/fitness.activity.read",
  "https://www.googleapis.com/auth/fitness.body.read",
  "https://www.googleapis.com/auth/fitness.heart_rate.read",
  "https://www.googleapis.com/auth/fitness.sleep.read",
];

/**
 * Get Google Fit authorization URL
 * @route GET /api/google-fit/authorize
 * @access Private
 */
export const getAuthorizationUrlController = async (req, res) => {
  try {
    const clientId = getGoogleClientId();
    const redirectUri = getGoogleRedirectUri();

    if (!clientId) {
      return res.status(500).json({
        success: false,
        message:
          "Google OAuth not configured. Please set GOOGLE_CLIENT_ID in environment variables.",
      });
    }

    const authUrl = getAuthorizationUrl(
      clientId,
      redirectUri,
      GOOGLE_FIT_SCOPES
    );

    res.status(200).json({
      success: true,
      authorizationUrl: authUrl,
    });
  } catch (error) {
    console.error("Error generating authorization URL:", error);
    res.status(500).json({
      success: false,
      message: "Error generating authorization URL",
    });
  }
};

/**
 * Handle OAuth callback and store tokens
 * @route GET /api/google-fit/callback
 * @access Public (called by Google)
 */
export const handleOAuthCallback = async (req, res) => {
  try {
    const { code, state } = req.query;
    const userId = state; // User ID passed in state parameter

    if (!code) {
      return res.status(400).json({
        success: false,
        message: "Authorization code not provided",
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID not provided in state parameter",
      });
    }

    // Process the connection first (all verification happens before showing success)
    const tokenData = await exchangeCodeForTokens(
      code,
      getGoogleClientId(),
      getGoogleClientSecret(),
      getGoogleRedirectUri()
    );

    // Calculate token expiry
    const tokenExpiry = new Date();
    tokenExpiry.setSeconds(tokenExpiry.getSeconds() + tokenData.expiresIn);

    // Find existing Google Fit connection (if any)
    let googleFit = await GoogleFit.findOne({ user: userId });

    // Prepare database operations to run in parallel
    const dbOperations = [];

    if (googleFit) {
      // Update existing connection
      googleFit.accessToken = tokenData.accessToken;

      // Only overwrite refreshToken if Google actually returned one
      if (tokenData.refreshToken) {
        googleFit.refreshToken = tokenData.refreshToken;
      }

      googleFit.tokenExpiry = tokenExpiry;
      googleFit.scopes = GOOGLE_FIT_SCOPES;
      googleFit.isActive = true;
      googleFit.lastSync = new Date();
      dbOperations.push(googleFit.save());
    } else {
      // Create NEW connection
      googleFit = new GoogleFit({
        user: userId,
        accessToken: tokenData.accessToken,
        refreshToken: tokenData.refreshToken, // This should exist on first connection
        tokenExpiry: tokenExpiry,
        scopes: GOOGLE_FIT_SCOPES,
        isActive: true,
        lastSync: new Date()
      });
      dbOperations.push(googleFit.save());
    }

    // Update user's Google Fit connection status (runs in parallel with GoogleFit save)
    dbOperations.push(
      User.findByIdAndUpdate(
        userId,
        { isGoogleFitConnected: true },
        { new: false }
      )
    );

    // Execute all database operations in parallel for faster response
    await Promise.all(dbOperations);

    // Verify the connection was actually saved successfully
    const savedConnection = await GoogleFit.findOne({
      user: userId,
      isActive: true,
    });
    const user = await User.findById(userId).select("isGoogleFitConnected");

if (!savedConnection || !savedConnection.accessToken) {
  throw new Error('Failed to save Google Fit connection to database');
}

    if (!user || !user.isGoogleFitConnected) {
      throw new Error("Failed to update user connection status");
    }

    // Connection verified successfully - log to console and send success page
    console.log("✅ Google Fit Connected Successfully - User ID:", userId);

    const deepLink = `diabetesapp://google-fit/callback?success=true`;
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>SweetTrack | Connected Successfully</title>
          <style>
            :root {
              --primary: #10B981;
              --primary-dark: #059669;
              --bg: #F8FAFC;
              --text: #1E293B;
              --text-light: #64748B;
            }
            body { 
              margin: 0; padding: 0; height: 100vh; display: flex; align-items: center; justify-content: center;
              background: radial-gradient(circle at top left, #F0FDF4 0%, #ECFDF5 50%, #F8FAFC 100%);
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
              color: var(--text); overflow: hidden;
            }
            .background-blur {
              position: absolute; width: 300px; height: 300px; border-radius: 50%;
              background: var(--primary); filter: blur(120px); opacity: 0.1; z-index: -1;
              top: 10%; left: 10%;
            }
            .card { 
              background: rgba(255, 255, 255, 0.8); backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);
              padding: 48px 32px; border-radius: 40px; border: 1px solid rgba(255,255,255,0.5); 
              width: 90%; max-width: 420px; text-align: center;
              box-shadow: 0 20px 50px rgba(0,0,0,0.08);
              animation: slideUp 0.8s cubic-bezier(0.2, 0.8, 0.2, 1);
            }
            @keyframes slideUp {
              from { opacity: 0; transform: translateY(30px); }
              to { opacity: 1; transform: translateY(0); }
            }
            .logo-container {
              width: 80px; height: 80px; margin: 0 auto 24px;
              background: linear-gradient(135deg, var(--primary) 0%, var(--primary-dark) 100%);
              border-radius: 24px; display: flex; align-items: center; justify-content: center;
              box-shadow: 0 12px 24px rgba(16, 185, 129, 0.3);
            }
            .logo-icon {
              width: 40px; height: 40px; fill: white;
            }
            .brand-name {
              font-size: 14px; font-weight: 800; color: var(--primary);
              text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;
            }
            h2 { margin: 0 0 12px; font-weight: 800; font-size: 28px; letter-spacing: -0.5px; }
            p { color: var(--text-light); margin: 0 0 32px; font-size: 16px; line-height: 1.6; padding: 0 10px; }
            .button {
              display: inline-flex; align-items: center; justify-content: center;
              background: var(--text); color: white; text-decoration: none;
              padding: 18px 32px; border-radius: 20px; font-weight: 700; font-size: 16px;
              transition: all 0.3s ease; border: none; cursor: pointer; width: 100%;
              box-shadow: 0 10px 20px rgba(0,0,0,0.1);
            }
            .button:hover { transform: translateY(-2px); box-shadow: 0 15px 30px rgba(0,0,0,0.15); }
            .button:active { transform: translateY(0); }
            .status-dot {
              display: inline-block; width: 8px; height: 8px; border-radius: 50%;
              background: var(--primary); margin-right: 8px;
              animation: pulse 2s infinite;
            }
            @keyframes pulse {
              0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
              70% { box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
              100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
            }
          </style>
        </head>
        <body>
          <div class="background-blur"></div>
          <div class="card">
            <div class="brand-name">SweetTrack AI</div>
            <div class="logo-container">
              <svg class="logo-icon" viewBox="0 0 24 24">
                <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
              </svg>
            </div>
            <h2>Successfully Synced!</h2>
            <p>Your health data is now synchronized with SweetTrack AI for deep clinical analysis.</p>
            <button class="button" onclick="returnToApp()">
              Return to App
            </button>
          </div>
          <script>
            function returnToApp() {
              const deepLink = "${deepLink}";
              window.location.replace(deepLink);
              // Fallback for some browsers
              setTimeout(() => {
                window.location.href = deepLink;
              }, 500);
            }
            
            // Auto redirect after a short delay
            setTimeout(returnToApp, 2500);
          </script>
        </body>
      </html>
    `);
  } catch (error) {
    // Log failure to console
    console.error("❌ Google Fit Connection Failed:", error);
    const errorMessage =
      error.response?.data?.error_description ||
      error.message ||
      "Unknown error";
    const deepLinkUrl = `diabetesapp://google-fit/callback?success=false&error=${encodeURIComponent(
      errorMessage
    )}`;

    // Return error page (do NOT show success message)
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Connection Failed</title>
          <style>
            body {
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 20px;
              background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
              color: white;
            }
            .container {
              text-align: center;
              max-width: 400px;
            }
            h1 { margin: 0 0 10px 0; font-size: 24px; }
            p { margin: 10px 0; opacity: 0.9; font-size: 16px; }
            .error { 
              background: rgba(255,255,255,0.2);
              padding: 15px;
              border-radius: 8px;
              margin: 20px 0;
              font-size: 14px;
              word-break: break-word;
            }
            .button {
              display: inline-block;
              margin-top: 20px;
              padding: 12px 24px;
              background: white;
              color: #f5576c;
              text-decoration: none;
              border: none;
              border-radius: 8px;
              font-weight: 600;
              font-size: 16px;
              cursor: pointer;
              font-family: inherit;
            }
            .button:hover { opacity: 0.9; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>❌ Google Fit Connection Failed</h1>
            <p>There was an error connecting to Google Fit:</p>
            <div class="error">${errorMessage}</div>
            <button class="button" onclick="returnToApp()">Return to App</button>
            <script>
              console.error('❌ Google Fit Connection Failed');
              
              function returnToApp() {
                const deepLink = "${deepLinkUrl}";
                try {
                  window.location.href = deepLink;
                } catch(e) {
                  console.error('Failed to return to app:', e);
                }
              }
            </script>
          </div>
        </body>
      </html>
    `);
  }
};

/**
 * Connect Google Fit (initiate OAuth flow)
 * @route POST /api/google-fit/connect
 * @access Private
 */
export const connectGoogleFit = async (req, res) => {
  try {
    const userId = req.user.id;

    const clientId = getGoogleClientId();
    const redirectUri = getGoogleRedirectUri();

    if (!clientId) {
      console.error("❌ GOOGLE_CLIENT_ID is not set in environment variables");
      console.error(
        "   Please check your backend/.env file and ensure GOOGLE_CLIENT_ID is set"
      );
      return res.status(500).json({
        success: false,
        message:
          "Google OAuth not configured. Please set GOOGLE_CLIENT_ID in backend/.env file.",
      });
    }

    // Generate authorization URL with user ID in state (URL encoded)
    const authUrl =
      getAuthorizationUrl(clientId, redirectUri, GOOGLE_FIT_SCOPES) +
      `&state=${encodeURIComponent(userId)}`;

    res.status(200).json({
      success: true,
      authorizationUrl: authUrl,
      message: "Redirect user to this URL to authorize Google Fit",
    });
  } catch (error) {
    console.error("Error connecting Google Fit:", error);
    res.status(500).json({
      success: false,
      message: "Error initiating Google Fit connection",
    });
  }
};

/**
 * Disconnect Google Fit
 * @route POST /api/google-fit/disconnect
 * @access Private
 */
export const disconnectGoogleFit = async (req, res) => {
  try {
    const userId = req.user.id;

    // Remove Google Fit connection
    await GoogleFit.findOneAndDelete({ user: userId });

    // Update user status
    await User.findByIdAndUpdate(userId, { isGoogleFitConnected: false });

    res.status(200).json({
      success: true,
      message: "Google Fit disconnected successfully",
    });
  } catch (error) {
    console.error("Error disconnecting Google Fit:", error);
    res.status(500).json({
      success: false,
      message: "Error disconnecting Google Fit",
    });
  }
};

/**
 * Helper to sum calories from meal logs for a specific day
 */
const getDailyMealCalories = async (userId, date) => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  const logs = await MealLog.find({
    user: userId,
    loggedAt: { $gte: startOfDay, $lte: endOfDay }
  });

  return logs.reduce((sum, log) => sum + (log.nutritionalInfo?.calories || 0), 0);
};

/**
 * Sync health data from Google Fit
 * @route POST /api/google-fit/sync
 * @access Private
 */
export const syncHealthData = async (req, res) => {
  try {
    const userId = req.user.id;

    // Get Google Fit connection
    let googleFit = await GoogleFit.findOne({ user: userId });

    if (!googleFit || !googleFit.isActive) {
      return res.status(400).json({
        success: false,
        message: "Google Fit not connected",
      });
    }

    // Check if token needs refresh
    if (new Date() >= googleFit.tokenExpiry) {
      try {
        const newTokenData = await refreshAccessToken(
          googleFit.refreshToken,
          getGoogleClientId(),
          getGoogleClientSecret()
        );

        googleFit.accessToken = newTokenData.accessToken;
        googleFit.tokenExpiry = new Date(
          Date.now() + newTokenData.expiresIn * 1000
        );
        await googleFit.save();
      } catch (refreshError) {
        console.error("Token refresh failed:", refreshError.message);
        if (refreshError.message.includes('invalid or expired')) {
          // Token is revoked or expired. Automatically disconnect.
          googleFit.isActive = false;
          await googleFit.save();
          await User.findByIdAndUpdate(userId, { isGoogleFitConnected: false });
          
          return res.status(401).json({
            success: false,
            errorCode: 'FIT_TOKEN_EXPIRED',
            message: "Google Fit session expired. Please reconnect.",
          });
        }
        throw refreshError; // Re-throw if it's a generic network error
      }
    }

    const { date: dateStr } = req.body;
    
    // Define 24h window for the sync based on client date or current server time
    let startTime, endTime;
    if (dateStr) {
      startTime = new Date(`${dateStr}T00:00:00.000Z`);
      endTime = new Date(`${dateStr}T23:59:59.999Z`);
    } else {
      endTime = new Date();
      startTime = new Date();
      startTime.setHours(0, 0, 0, 0);
    }


    // Fetch data from Google Fit - handle errors gracefully
    const [
      steps,
      calories,
      sleep,
      heartRateSeries,
      bloodGlucose,
      bloodPressure,
    ] = await Promise.allSettled([
      getStepsData(googleFit.accessToken, startTime, endTime),
      getCaloriesData(googleFit.accessToken, startTime, endTime),
      getSleepData(googleFit.accessToken, startTime, endTime),
      getHeartRateData(googleFit.accessToken, startTime, endTime),
      getBloodGlucoseData(googleFit.accessToken, startTime, endTime),
      getBloodPressureData(googleFit.accessToken, startTime, endTime),
    ]).then((results) =>
      results.map((r) => (r.status === "fulfilled" ? r.value : null))
    );

    const heartRateAvg = heartRateSeries?.length
      ? Math.round(
          heartRateSeries.reduce((sum, hr) => sum + (hr.bpm || 0), 0) /
            heartRateSeries.length
        )
      : null;

    // Get meals calories for today
    const caloriesConsumed = await getDailyMealCalories(userId, new Date());

    // Fetch existing metric to prevent overwriting manual non-zero values with synced zeros
    const existingMetric = await HealthMetric.findOne({
      user: userId,
      date: { $gte: startTime, $lte: endTime },
    });

    const updateFields = {
      user: userId,
      syncedAt: new Date(),
      caloriesConsumed, // Always sync from meal logs
    };

    // Only update steps/calories/sleep if Google Fit has non-zero data OR if no data exists yet
    if (steps > 0 || !existingMetric) updateFields.steps = steps || 0;
    if (calories > 0 || !existingMetric) updateFields.calories = calories || 0;
    if (sleep > 0 || !existingMetric) updateFields.sleepHours = sleep || 0;
    
    if (heartRateAvg) updateFields.heartRateAvg = heartRateAvg;
    if (bloodGlucose) updateFields.bloodGlucose = bloodGlucose;
    if (bloodPressure) updateFields.bloodPressure = bloodPressure;

    // Persist a daily snapshot
    await HealthMetric.findOneAndUpdate(
      {
        user: userId,
        date: { $gte: startTime, $lte: endTime },
      },
      { $set: updateFields },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );


    // Update last sync time
    googleFit.lastSync = new Date();
    await googleFit.save();

    res.status(200).json({
      success: true,
      data: {
        steps: steps || 0,
        calories: calories || 0,
        caloriesConsumed,
        sleep: sleep || 0,
        heartRateAvg: heartRateAvg || null,
        bloodGlucose: bloodGlucose || null,
        bloodPressure: bloodPressure || null,
        syncedAt: new Date(),
      },
      message: "Health data synced successfully",
    });
  } catch (error) {
    console.error("Error syncing health data:", error);

    // Handle revoked permissions (401/403)
    if (error?.response?.status === 401 || error?.response?.status === 403) {
      await GoogleFit.findOneAndUpdate(
        { user: req.user.id },
        { isActive: false }
      );
      return res.status(401).json({
        success: false,
        message: "Google Fit access revoked. Please reconnect.",
      });
    }

    res.status(500).json({
      success: false,
      message: error.message || "Error syncing health data from Google Fit",
    });
  }
};

/**
 * Get Google Fit connection status
 * @route GET /api/google-fit/status
 * @access Private
 */
export const getConnectionStatus = async (req, res) => {
  try {
    const userId = req.user.id;

    const googleFit = await GoogleFit.findOne({ user: userId });
    const user = await User.findById(userId).select("isGoogleFitConnected");

    res.status(200).json({
      success: true,
      connected: user?.isGoogleFitConnected || false,
      isActive: googleFit?.isActive || false,
      lastSync: googleFit?.lastSync || null,
    });
  } catch (error) {
    console.error("Error getting connection status:", error);
    res.status(500).json({
      success: false,
      message: "Error getting Google Fit connection status",
    });
  }
};

// Background sync helper (no Express response)
export const backgroundSyncGoogleFit = async () => {
  const connections = await GoogleFit.find({ isActive: true });
  for (const gf of connections) {
    try {
      // Refresh token if needed
      if (new Date() >= gf.tokenExpiry) {
        const newTokenData = await refreshAccessToken(
          gf.refreshToken,
          getGoogleClientId(),
          getGoogleClientSecret()
        );
        gf.accessToken = newTokenData.accessToken;
        gf.tokenExpiry = new Date(Date.now() + newTokenData.expiresIn * 1000);
        await gf.save();
      }

      const endTime = new Date();
      const startTime = new Date();
      startTime.setHours(0, 0, 0, 0);

      // Fetch data from Google Fit - handle errors gracefully
      const [
        steps,
        calories,
        sleep,
        heartRateSeries,
        bloodGlucose,
        bloodPressure,
      ] = await Promise.allSettled([
        getStepsData(gf.accessToken, startTime, endTime),
        getCaloriesData(gf.accessToken, startTime, endTime),
        getSleepData(gf.accessToken, startTime, endTime),
        getHeartRateData(gf.accessToken, startTime, endTime),
        getBloodGlucoseData(gf.accessToken, startTime, endTime),
        getBloodPressureData(gf.accessToken, startTime, endTime),
      ]).then((results) =>
        results.map((r) => (r.status === "fulfilled" ? r.value : null))
      );

      const heartRateAvg = heartRateSeries?.length
        ? Math.round(
            heartRateSeries.reduce((sum, hr) => sum + (hr.bpm || 0), 0) /
              heartRateSeries.length
          )
        : null;

      await HealthMetric.findOneAndUpdate(
        {
          user: gf.user,
          date: { $gte: startTime, $lte: endTime },
        },
        {
          user: gf.user,
          source: "google_fit",
          steps: steps || 0,
          calories: calories || 0,
          sleepHours: sleep || 0,
          heartRateAvg,
          bloodGlucose: bloodGlucose || null,
          bloodPressure: bloodPressure || undefined,
          syncedAt: new Date(),
        },
        { upsert: true, new: true }
      );

      gf.lastSync = new Date();
      await gf.save();
    } catch (error) {
      if (
        error?.response?.status === 401 || 
        error?.response?.status === 403 ||
        error?.error === 'invalid_grant' ||
        error?.status === 400 ||
        error?.message?.includes('Refresh token is invalid') ||
        error?.message?.includes('re-authorize')
      ) {
        await GoogleFit.findByIdAndUpdate(gf._id, { isActive: false });
      } else {
        console.error(
          "[Background Google Fit sync] unexpected error for user",
          gf.user,
          error?.message || error
        );
      }
    }
  }
};
