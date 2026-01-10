import GoogleFit from "../models/GoogleFit.js";
import HealthMetric from "../models/HealthMetric.js";
import User from "../models/User.js";
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

    const deepLinkUrl = `diabetesapp://google-fit-connected?success=true`;
    // res.send(`
    //   <!DOCTYPE html>
    //   <html>
    //     <head>
    //       <meta charset="utf-8">
    //       <meta name="viewport" content="width=device-width, initial-scale=1.0">
    //       <title>Google Fit Connected</title>
    //       <style>
    //         body {
    //           font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    //           display: flex;
    //           flex-direction: column;
    //           align-items: center;
    //           justify-content: center;
    //           min-height: 100vh;
    //           margin: 0;
    //           padding: 20px;
    //           background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    //           color: white;
    //         }
    //         .container {
    //           text-align: center;
    //           max-width: 400px;
    //         }
    //         h1 { margin: 0 0 10px 0; font-size: 24px; }
    //         p { margin: 10px 0; opacity: 0.9; font-size: 16px; }
    //         .button {
    //           display: inline-block;
    //           margin-top: 20px;
    //           padding: 12px 24px;
    //           background: white;
    //           color: #667eea;
    //           text-decoration: none;
    //           border: none;
    //           border-radius: 8px;
    //           font-weight: 600;
    //           font-size: 16px;
    //           cursor: pointer;
    //           font-family: inherit;
    //         }
    //         .button:hover { opacity: 0.9; }
    //         .button:active { transform: scale(0.98); }
    //         .hidden { display: none; }
    //         .note {
    //           margin-top: 20px;
    //           font-size: 14px;
    //           opacity: 0.8;
    //         }
    //       </style>
    //     </head>
    //     <body>
    //       <div class="container">
    //         <h1>✅ Google Fit Connected!</h1>
    //         <p id="status">Connection verified successfully</p>
    //         <button id="openButton" class="button" onclick="openApp()">Open App</button>
    //         <p class="note" id="note"></p>
    //         <script>
    //           (function() {
    //             // Log success to console
    //             console.log('✅ Google Fit Connected Successfully');

    //             const deepLink = "${deepLinkUrl}";
    //             const statusEl = document.getElementById('status');
    //             const noteEl = document.getElementById('note');

    //             // Check if we're on mobile
    //             const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

    //             noteEl.textContent = isMobile
    //               ? "Tap the button above to return to the app."
    //               : 'Please open this page on your mobile device.';

    //             // Suppress console errors for deep link attempts (these are expected browser warnings)
    //             const originalError = console.error;
    //             console.error = function(...args) {
    //               const message = args[0]?.toString() || '';
    //               // Ignore expected browser warnings about deep links
    //               if (message.includes('scheme does not have a registered handler') ||
    //                   message.includes('user gesture is required') ||
    //                   message.includes('Failed to launch')) {
    //                 return; // Suppress these expected warnings
    //               }
    //               originalError.apply(console, args);
    //             };

    //             // Make openApp function available globally - only works on user click
    //             window.openApp = function() {
    //               console.log('Opening app via deep link...');
    //               statusEl.textContent = 'Opening app...';

    //               // Use window.location.href (works with user gesture)
    //               // Wrap in try-catch to handle gracefully
    //               try {
    //                 window.location.href = deepLink;
    //               } catch(e) {
    //                 // Silently handle - browser will show its own message if needed
    //                 statusEl.textContent = 'If the app didn\\'t open, make sure it\\'s installed on your device.';
    //               }
    //             };
    //           })();
    //         </script>
    //       </div>
    //     </body>
    //   </html>
    // `);
    return res.status(200).json({
      success: true,
      message: "Google Fit connected successfully",
      userId,
      saved: true,
    });
  } catch (error) {
    // Log failure to console
    console.error("❌ Google Fit Connection Failed:", error);
    const errorMessage =
      error.response?.data?.error_description ||
      error.message ||
      "Unknown error";
    const deepLinkUrl = `diabetesapp://google-fit-connected?success=false&error=${encodeURIComponent(
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
    }

    // Get today's date range
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

    // Persist a daily snapshot
    await HealthMetric.findOneAndUpdate(
      {
        user: userId,
        date: { $gte: startTime, $lte: endTime },
      },
      {
        user: userId,
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

    // Update last sync time
    googleFit.lastSync = new Date();
    await googleFit.save();

    res.status(200).json({
      success: true,
      data: {
        steps: steps || 0,
        calories: calories || 0,
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
      console.error(
        "[Background Google Fit sync] error for user",
        gf.user,
        error?.message || error
      );
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        await GoogleFit.findByIdAndUpdate(gf._id, { isActive: false });
      }
    }
  }
};
