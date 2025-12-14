import axios from 'axios';

// Google Fit API endpoints
const GOOGLE_FIT_API_BASE = 'https://www.googleapis.com/fitness/v1';

/**
 * Get OAuth authorization URL
 */
export const getAuthorizationUrl = (clientId, redirectUri, scopes) => {
  const scopeString = scopes.join(' ');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: scopeString,
    access_type: 'offline',
    prompt: 'consent'
  });
  
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
};

/**
 * Exchange authorization code for tokens
 */
export const exchangeCodeForTokens = async (code, clientId, clientSecret, redirectUri) => {
  try {
    const params = new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code'
    });

    const response = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return {
      accessToken: response.data.access_token,
      refreshToken: response.data.refresh_token,
      expiresIn: response.data.expires_in,
      tokenType: response.data.token_type
    };
  } catch (error) {
    console.error('Error exchanging code for tokens:', error.response?.data || error.message);
    throw new Error('Failed to exchange authorization code for tokens');
  }
};

/**
 * Refresh access token
 */
export const refreshAccessToken = async (refreshToken, clientId, clientSecret) => {
  // Validate required parameters
  if (!refreshToken) {
    throw new Error('Refresh token is required');
  }
  if (!clientId) {
    throw new Error('Client ID is required for token refresh');
  }
  if (!clientSecret) {
    throw new Error('Client secret is required for token refresh');
  }

  try {
    const params = new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token'
    });

    const response = await axios.post('https://oauth2.googleapis.com/token', params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return {
      accessToken: response.data.access_token,
      expiresIn: response.data.expires_in
    };
  } catch (error) {
    const errorData = error.response?.data || {};
    console.error('Error refreshing token:', {
      error: errorData.error,
      error_description: errorData.error_description,
      status: error.response?.status,
      message: error.message
    });
    
    // Provide more specific error messages
    if (errorData.error === 'invalid_request' && errorData.error_description?.includes('client ID')) {
      throw new Error('Invalid client ID configuration. Please check GOOGLE_CLIENT_ID environment variable.');
    }
    if (errorData.error === 'invalid_grant') {
      throw new Error('Refresh token is invalid or expired. User needs to re-authorize.');
    }
    
    throw new Error(errorData.error_description || 'Failed to refresh access token');
  }
};

/**
 * Get steps data from Google Fit
 */
export const getStepsData = async (accessToken, startTime, endTime) => {
  try {
    // Google Fit dataset:aggregate expects milliseconds, not nanoseconds
    const startTimeMillis = new Date(startTime).getTime();
    const endTimeMillis = new Date(endTime).getTime();

    // Try multiple data sources for steps (some may not be available)
    const dataSources = [
      'derived:com.google.step_count.delta:google:estimated_steps',
      'derived:com.google.step_count.delta:com.google.android.gms:estimated_steps',
      'derived:com.google.step_count.delta:com.google.android.gms:merge_step_deltas'
    ];

    for (const dataSourceId of dataSources) {
      try {
        const response = await axios.post(
          `${GOOGLE_FIT_API_BASE}/users/me/dataset:aggregate`,
          {
            aggregateBy: [{
              dataTypeName: 'com.google.step_count.delta',
              dataSourceId: dataSourceId
            }],
            bucketByTime: { durationMillis: 86400000 }, // 1 day
            startTimeMillis,
            endTimeMillis
          },
          {
            headers: {
              'Authorization': `Bearer ${accessToken}`,
              'Content-Type': 'application/json'
            }
          }
        );

        // Extract steps from response
        let totalSteps = 0;
        if (response.data.bucket) {
          response.data.bucket.forEach(bucket => {
            if (bucket.dataset && bucket.dataset[0] && bucket.dataset[0].point) {
              bucket.dataset[0].point.forEach(point => {
                if (point.value && point.value[0]) {
                  totalSteps += point.value[0].intVal || 0;
                }
              });
            }
          });
        }

        if (totalSteps > 0) {
          return totalSteps;
        }
      } catch (dsError) {
        // Try next data source if this one fails
        continue;
      }
    }

    // If all data sources fail, try without specifying dataSourceId
    try {
      const response = await axios.post(
        `${GOOGLE_FIT_API_BASE}/users/me/dataset:aggregate`,
        {
          aggregateBy: [{
            dataTypeName: 'com.google.step_count.delta'
          }],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis,
          endTimeMillis
        },
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      let totalSteps = 0;
      if (response.data.bucket) {
        response.data.bucket.forEach(bucket => {
          if (bucket.dataset && bucket.dataset[0] && bucket.dataset[0].point) {
            bucket.dataset[0].point.forEach(point => {
              if (point.value && point.value[0]) {
                totalSteps += point.value[0].intVal || 0;
              }
            });
          }
        });
      }

      return totalSteps;
    } catch (error) {
      // If all attempts fail, return 0 instead of throwing
      console.warn('⚠️ Could not fetch steps data from Google Fit. User may not have step data available.');
      return 0;
    }
  } catch (error) {
    console.warn('⚠️ Steps data not available from Google Fit:', error.response?.data?.error?.message || error.message);
    return 0;
  }
};

/**
 * Get calories data from Google Fit
 */
export const getCaloriesData = async (accessToken, startTime, endTime) => {
  try {
    // Google Fit dataset:aggregate expects milliseconds, not nanoseconds
    const startTimeMillis = new Date(startTime).getTime();
    const endTimeMillis = new Date(endTime).getTime();

    const response = await axios.post(
      `${GOOGLE_FIT_API_BASE}/users/me/dataset:aggregate`,
      {
        aggregateBy: [{
          dataTypeName: 'com.google.calories.expended',
          dataSourceId: 'derived:com.google.calories.expended:com.google.android.gms:merge_calories_expended'
        }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis,
        endTimeMillis
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    let totalCalories = 0;
    if (response.data.bucket) {
      response.data.bucket.forEach(bucket => {
        if (bucket.dataset && bucket.dataset[0] && bucket.dataset[0].point) {
          bucket.dataset[0].point.forEach(point => {
            if (point.value && point.value[0]) {
              totalCalories += point.value[0].fpVal || 0;
            }
          });
        }
      });
    }

    return Math.round(totalCalories);
  } catch (error) {
    console.error('Error fetching calories data:', error.response?.data || error.message);
    throw new Error('Failed to fetch calories data from Google Fit');
  }
};

/**
 * Get sleep data from Google Fit
 */
export const getSleepData = async (accessToken, startTime, endTime) => {
  try {
    // Google Fit dataset:aggregate expects milliseconds, not nanoseconds
    const startTimeMillis = new Date(startTime).getTime();
    const endTimeMillis = new Date(endTime).getTime();

    const response = await axios.post(
      `${GOOGLE_FIT_API_BASE}/users/me/dataset:aggregate`,
      {
        aggregateBy: [{
          dataTypeName: 'com.google.sleep.segment'
        }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis,
        endTimeMillis
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    let totalSleepMinutes = 0;
    if (response.data.bucket) {
      response.data.bucket.forEach(bucket => {
        if (bucket.dataset && bucket.dataset[0] && bucket.dataset[0].point) {
          bucket.dataset[0].point.forEach(point => {
            if (point.value && point.value[0]) {
              const duration = (point.endTimeNanos - point.startTimeNanos) / 1000000000 / 60; // Convert to minutes
              totalSleepMinutes += duration;
            }
          });
        }
      });
    }

    return Math.round(totalSleepMinutes / 60); // Convert to hours
  } catch (error) {
    console.error('Error fetching sleep data:', error.response?.data || error.message);
    throw new Error('Failed to fetch sleep data from Google Fit');
  }
};

/**
 * Get heart rate data from Google Fit
 */
export const getHeartRateData = async (accessToken, startTime, endTime) => {
  try {
    // Google Fit dataset:aggregate expects milliseconds, not nanoseconds
    const startTimeMillis = new Date(startTime).getTime();
    const endTimeMillis = new Date(endTime).getTime();

    const response = await axios.post(
      `${GOOGLE_FIT_API_BASE}/users/me/dataset:aggregate`,
      {
        aggregateBy: [{
          dataTypeName: 'com.google.heart_rate.bpm'
        }],
        bucketByTime: { durationMillis: 3600000 }, // 1 hour
        startTimeMillis,
        endTimeMillis
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const heartRates = [];
    if (response.data.bucket) {
      response.data.bucket.forEach(bucket => {
        if (bucket.dataset && bucket.dataset[0] && bucket.dataset[0].point) {
          bucket.dataset[0].point.forEach(point => {
            if (point.value && point.value[0]) {
              heartRates.push({
                bpm: point.value[0].fpVal,
                timestamp: point.startTimeNanos / 1000000
              });
            }
          });
        }
      });
    }

    return heartRates;
  } catch (error) {
    console.error('Error fetching heart rate data:', error.response?.data || error.message);
    throw new Error('Failed to fetch heart rate data from Google Fit');
  }
};

/**
 * Get blood glucose data from Google Fit (returns most recent value in range)
 */
export const getBloodGlucoseData = async (accessToken, startTime, endTime) => {
  try {
    // Google Fit dataset:aggregate expects milliseconds, not nanoseconds
    const startTimeMillis = new Date(startTime).getTime();
    const endTimeMillis = new Date(endTime).getTime();

    const response = await axios.post(
      `${GOOGLE_FIT_API_BASE}/users/me/dataset:aggregate`,
      {
        aggregateBy: [{
          dataTypeName: 'com.google.blood_glucose'
        }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis,
        endTimeMillis
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    let latest = null;
    if (response.data.bucket) {
      response.data.bucket.forEach(bucket => {
        bucket.dataset?.forEach(ds => {
          ds.point?.forEach(point => {
            if (point.value && point.value[0]?.fpVal) {
              latest = point.value[0].fpVal;
            }
          });
        });
      });
    }

    // Convert from mmol/L to mg/dL if provided in mmol (assuming mg/dL target)
    return latest ? Math.round(latest * 18) : null;
  } catch (error) {
    // Blood glucose requires special permissions and may not be available via standard Fitness API
    // Silently return null instead of logging error (this is expected for most users)
    if (error.response?.status === 403) {
      // Permission denied - this data type is not available with current scopes
      return null;
    }
    // Only log unexpected errors
    if (error.response?.status !== 403) {
      console.warn('⚠️ Blood glucose data not available:', error.response?.data?.error?.message || error.message);
    }
    return null;
  }
};

/**
 * Get blood pressure data (returns average in range)
 */
export const getBloodPressureData = async (accessToken, startTime, endTime) => {
  try {
    // Google Fit dataset:aggregate expects milliseconds, not nanoseconds
    const startTimeMillis = new Date(startTime).getTime();
    const endTimeMillis = new Date(endTime).getTime();

    const response = await axios.post(
      `${GOOGLE_FIT_API_BASE}/users/me/dataset:aggregate`,
      {
        aggregateBy: [{
          dataTypeName: 'com.google.blood_pressure'
        }],
        bucketByTime: { durationMillis: 86400000 },
        startTimeMillis,
        endTimeMillis
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    let systolicTotal = 0;
    let diastolicTotal = 0;
    let count = 0;

    response.data.bucket?.forEach(bucket => {
      bucket.dataset?.forEach(ds => {
        ds.point?.forEach(point => {
          if (point.value && point.value.length >= 2) {
            const sys = point.value[0]?.fpVal;
            const dia = point.value[1]?.fpVal;
            if (sys && dia) {
              systolicTotal += sys;
              diastolicTotal += dia;
              count += 1;
            }
          }
        });
      });
    });

    if (!count) return null;
    return {
      systolic: Math.round(systolicTotal / count),
      diastolic: Math.round(diastolicTotal / count)
    };
  } catch (error) {
    // Blood pressure requires special permissions and may not be available via standard Fitness API
    // Silently return null instead of logging error (this is expected for most users)
    if (error.response?.status === 403) {
      // Permission denied - this data type is not available with current scopes
      return null;
    }
    // Only log unexpected errors
    if (error.response?.status !== 403) {
      console.warn('⚠️ Blood pressure data not available:', error.response?.data?.error?.message || error.message);
    }
    return null;
  }
};

