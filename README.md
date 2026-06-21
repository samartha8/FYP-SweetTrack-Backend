# SweetTrack Backend & Machine Learning API 🧠🛠️
> **The robust Node.js/Express server and Python ML pipeline driving SweetTrack's clinical AI intelligence and health metrics.**

---

## 🌟 Overview

The **SweetTrack Backend** coordinates all data storage, user authentication, fitness API syncs, and AI integrations. It is paired with an independent **Python Machine Learning pipeline** that runs predictions and computer vision models asynchronously via child process spawning.

---

## 🏗️ Architecture & Stack

### **Server Environment (Node.js & Express)**
*   **Runtime**: Node.js with ES Modules configuration (`"type": "module"`).
*   **Database**: MongoDB via Mongoose ODM for storing user credentials, health history, meal logs, and reward milestones.
*   **Authentication**: Passport JWT Strategy alongside Google OAuth client verification.
*   **Push Notifications**: Integrated with `expo-server-sdk` for sending remote mobile alerts.
*   **Storage & Uploads**: Multer middleware configuration handling multi-part uploads for food image scans.
*   **Scheduled Crons**: Scheduled daily reports compile steps and nutrition logs automatically at midnight.

### **API Integrations**
*   **Groq SDK**: Drives the high-speed Llama-based health chat assistant.
*   **OpenAI API**: Orchestrates image parsing for foods and natural language description text analyses.
*   **Google Gemini AI**: Provides secondary clinical fallback analyses and advice generation.

---

## 📂 Backend Project Structure

```
backend/
├── src/
│   ├── config/             # Database connection, Passport strategies & JWT configs
│   ├── controllers/        # Logical controllers (auth, health metrics, meals, rewards)
│   ├── models/             # Mongoose schemas (User.js, HealthMetric.js, MealLog.js)
│   ├── middleware/         # Security, verification JWT filters, & upload configuration
│   ├── routes/             # Express routes (authRoutes.js, healthRoutes.js, mealRoutes.js)
│   ├── services/           # External wrappers (OpenAI, Groq, Google Fit callbacks)
│   └── utils/              # Cryptography and clinical conversion helpers
├── ml_models/              # Python Machine Learning pipeline
│   ├── MobileSAM/          # Segment Anything Model files for food crop identification
│   ├── diabetes_model.pkl  # Pickled XGBoost/Random Forest model for Diabetes prediction
│   ├── model.keras         # Keras CNN model for food classification
│   ├── predict.py          # Wrapper for running biometrics/risk assessment predictions
│   ├── predict_food.py     # Wrapper for SAM segmentation & nutrition catalog mapping
│   └── requirements.txt    # Python scientific libraries dependencies
├── server.js               # Express application bootstrap entry point
└── package.json            # Node backend script and dependency manager
```

---

## 🧠 Machine Learning & Data Science Notebooks

The backend directory contains three major Jupyter Notebooks that outline the training pipeline of SweetTrack's intelligence engines:

### 1. **Diabetes Risk Classification** (`Diabetes_CDC_BRFSS_FIXED.ipynb`)
*   **Dataset**: CDC Behavioral Risk Factor Surveillance System (BRFSS), consisting of hundreds of thousands of entries tracking lifestyle health factors.
*   **Training & Pipeline**: Evaluates multiple classification models (Logistic Regression, Decision Trees, Random Forests, and XGBoost).
*   **Implementation**: Exports the trained classifier to `ml_models/diabetes_model.pkl` along with feature lists mapping `feature_names.json`.
*   **Explainable AI (XAI)**: Includes correlation evaluations to outline which factors (e.g., Blood Pressure, High Cholesterol, BMI) carry the highest weight in risk prediction.

### 2. **Food Catalog & Vision Model** (`SmartMealLog_FINAL_Nutrition.ipynb` / `SmartMealLog_Unified_Training.ipynb`)
*   **Training & Segmentations**: Explores food image segmentation utilizing **MobileSAM (Segment Anything Model)** and compiles classification benchmarks.
*   **Implementation**: Produces the deep learning model (`model.keras`) along with classification mappings (`class_names.json` / `nutrition_lookup.json`) containing standard calorie, protein, fat, and sugar contents per serving.

---

## 🐍 Python Wrapper Integrations

The Express server communicates with Python scripts via the Node.js `child_process` API. Standard JSON payloads are streamed into the scripts via `stdin`, and the outputs are parsed from `stdout`.

### **Diabetes Risk Predictor** (`ml_models/predict.py`)
*   **Dual Modes (Lifestyle vs. Clinical)**:
    - **Lifestyle Mode**: If only biometrics are supplied during onboarding, the model dampens extremes and uses $7$ lifestyle features (Age, BMI, High BP, High Chol, Smoker, PhysActivity, Heart Disease).
    - **Clinical Mode**: Incorporates clinical biomarkers (Estimated HbA1c and Blood Glucose levels) to raise the prediction's **Confidence Score** (computed out of $9$ total variables).
*   **Biomarker Confidence Tracker**: Normalizes inputs (converting BRFSS scales into PIMA-equivalent scales) and determines feature weight impacts using training metrics.
*   **Explainable AI output**: Sorts active features by their importances to return the top two contributing reasons for a user's risk rating (e.g., *"High Blood Pressure"*, *"Low Physical Activity"*).

### **Food Classifier** (`ml_models/predict_food.py`)
*   Loads `model.keras` and crops/segments foods using `mobile_sam.pt` to isolate portion sizes.
*   Resolves detected foods to nutrition details inside `nutrition_lookup.json`.

---

## 🚀 Backend Development Setup

### 1. Prerequisites
Ensure you have the following installed:
*   **Node.js v18+**
*   **Python v3.9+** (with `pip`)
*   **MongoDB Instance** (Local daemon or MongoDB Atlas URL)

### 2. Install Python Dependencies
Set up the Python libraries inside the `ml_models/` directory:
```bash
cd ml_models
pip install -r requirements.txt
```
*(Optionally setup a virtual environment before running pip install)*

### 3. Install Node.js Dependencies
Navigate to the `backend/` directory and install project dependencies:
```bash
npm install
```

### 4. Setup Environment Variables (`.env`)
Create a `.env` file in the root of the backend folder:
```env
PORT=5000
MONGO_URI=mongodb://localhost:27017/sweettrack
JWT_SECRET=your_jwt_secret_token
GROQ_API_KEY=your_groq_api_key
OPENAI_API_KEY=your_openai_api_key
GOOGLE_CLIENT_ID=your_google_oauth_client_id
GOOGLE_CLIENT_SECRET=your_google_oauth_client_secret
```

### 5. Running the Backend Server
Start the Express API server:
```bash
# Start standard server
npm start

# Start server in watch mode (nodemon)
npm run dev

# Start server alongside ngrok tunnel mapping (automatically exposes public endpoint)
npm run dev:all
```
*The Express server boots on `http://localhost:5000` with the Python models waiting in standard child processes.*
