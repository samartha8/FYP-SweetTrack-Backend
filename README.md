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

## 🧠 Machine Learning & Model Training

This repository employs machine learning to drive its key health and nutrition features. Below is a breakdown of the models trained, evaluated, and deployed in production:

### 1. **Diabetes Risk Prediction Model (XGBoost Classifier)**
*   **The Model**: An **XGBoost Classifier** (`XGBClassifier`), an optimized gradient-boosting decision tree algorithm selected for its outstanding accuracy and stability on tabular medical data.
*   **The Dataset**: Trained using data from the **CDC Behavioral Risk Factor Surveillance System (BRFSS)**.
*   **Input Features (11 Parameters)**:
    - *Lifestyle Indicators*: BMI, Age Category, High Blood Pressure, High Cholesterol, Smoking History, Physical Activity, Heart Disease History, General Health self-rating, and Sex.
    - *Clinical Biomarkers*: HbA1c and Estimated Blood Glucose levels.
*   **How it Works in Production**: 
    - The Node backend executes `predict.py` as a child process.
    - The model calculates risk probability in real-time.
    - **Explainable AI (XAI)**: The script inspects the model's feature importances to highlight the top two factors causing elevated risk (e.g., *High BMI*, *Low Physical Activity*) for clear patient insights.

### 2. **Dual-Mode AI Food Segmentation & Classification**
*   **The Segmentation Model**: **MobileSAM (Segment Anything Model)** (`mobile_sam.pt`). MobileSAM is a lightweight version of Meta's SAM optimized for edge devices. It automatically isolates and segments food items in images.
*   **The Classification Model**: A custom **Keras Convolutional Neural Network (CNN)** (`model.keras`) trained to classify distinct food items.
*   **Nutritional Mapping**: Resolved class names are cross-referenced with `nutrition_lookup.json` to calculate macro-nutrients (Carbs, Protein, Fat, Fiber, Sugar, Sodium, Calories) scaling automatically with user-selected portion sizes (Small, Standard, Big).

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
