import sys
import json
import pickle
import os
import traceback
import warnings

# Use robust imports for data science libraries
try:
    import pandas as pd
    import numpy as np
except ImportError:
    # Minimal fallbacks for linting
    class pd: 
        class DataFrame: pass
    class np: pass

# Disable warnings
warnings.filterwarnings("ignore")

def map_brfss_to_pima(data):
    """
    Map BRFSS-style binary/category inputs to Pima-style clinical approximate values.
    Uses dataset medians for missing values to maintain statistical neutrality.
    """
    age_map = {
        1: 21, 2: 27, 3: 32, 4: 37, 5: 42, 6: 47, 
        7: 52, 8: 57, 9: 62, 10: 67, 11: 72, 12: 77, 13: 80
    }
    age_cat = data.get('age', 5) 
    age_years = age_map.get(int(age_cat), 42)

    # Use 100 as the neutral 'Normal' glucose baseline if missing
    glucose = data.get('bloodGlucoseEstimated', data.get('glucose', 100))
    
    # Statistical medians from Pima dataset for healthy-range individuals
    # BP: 72 is median. Insulin: 30 is a neutral low-risk baseline. Skin: 23 is median.
    high_bp = int(data.get('highBP', 0))
    bp = 80 if high_bp == 1 else 72 # Slight nudge for high BP, but neutral otherwise
    if 'bloodPressure' in data and data['bloodPressure']:
        bp = data['bloodPressure']

    bmi = data.get('bmi', 25.0)
    insulin = data.get('insulin', 30) 
    skin = data.get('skinThickness', 23)

    is_male = int(data.get('sex', 0))
    pregnancies = 0 if is_male == 1 else data.get('pregnancies', 0)
    pedigree = data.get('diabetesPedigreeFunction', 0.47)

    return {
        'Pregnancies': pregnancies,
        'Glucose': glucose,
        'BloodPressure': bp,
        'SkinThickness': skin,
        'Insulin': insulin,
        'BMI': bmi,
        'DiabetesPedigreeFunction': pedigree,
        'Age': age_years
    }

def predict_diabetes():
    try:
        # 1. Read input
        input_json = sys.stdin.read()
        if not input_json:
            raise ValueError("No input data received")
            
        data = json.loads(input_json)
        
        # 2. Load model
        script_dir = os.path.dirname(os.path.abspath(__file__))
        model_path = os.path.join(script_dir, 'diabetes_model.pkl')
        
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model file not found at: {model_path}")
            
        with open(model_path, 'rb') as f:
            model = pickle.load(f)
            
        # 3. Detect expected features
        expected_features = None
        
        # Priority 1: Load from feature_names.json (Explicit training features)
        names_path = os.path.join(script_dir, 'feature_names.json')
        if os.path.exists(names_path):
            try:
                with open(names_path, 'r') as f:
                    expected_features = json.load(f)
            except Exception:
                pass

        # Priority 2: Fallback to model metadata or PIMA defaults
        if not expected_features:
            if hasattr(model, 'feature_names_in_'):
                expected_features = list(model.feature_names_in_)
            elif hasattr(model, 'n_features_in_'):
                if model.n_features_in_ == 8:
                    expected_features = ['Pregnancies', 'Glucose', 'BloodPressure', 'SkinThickness', 'Insulin', 'BMI', 'DiabetesPedigreeFunction', 'Age']
            
        # 4. Prepare Features
        # Normalize input keys (lowercase, no underscores) for matching
        clean_input = {k.lower().replace('_', ''): v for k, v in data.items()}
        
        final_df = None
        
        if expected_features:
            pima_specific_cols = [c.lower() for c in ['Pregnancies', 'SkinThickness', 'Insulin', 'DiabetesPedigreeFunction']]
            expects_pima = any(c.lower() in pima_specific_cols for c in expected_features)
            
            if expects_pima:
                # Detect if we need to map BRFSS inputs to PIMA clinical approximations
                has_brfss_keys = 'highbp' in clean_input
                has_pima_keys = 'glucose' in clean_input and 'insulin' in clean_input
                
                if has_brfss_keys and not has_pima_keys:
                    mapped_dict = map_brfss_to_pima(data)
                    final_input = {ef: mapped_dict.get(ef, 0) for ef in expected_features}
                    final_df = pd.DataFrame([final_input])

            if final_df is None:
                # Direct feature mapping (e.g. for BRFSS models with engineered biomarkers)
                final_input = {}
                standard_defaults = {
                    'cholcheck': 1, 'anyhealthcare': 1, 'nodocbccost': 0, 'diffwalk': 0,
                    'stroke': 0, 'hvyalcoholconsump': 0, 'menthlth': 0, 'physhlth': 0,
                    'fruits': 1, 'veggies': 1,
                }

                for ef in expected_features:
                    ef_norm = ef.lower().replace('_', '')
                    if ef_norm in clean_input:
                        val = clean_input[ef_norm]
                    elif ef_norm in standard_defaults:
                        val = standard_defaults[ef_norm]
                    else:
                        val = 0
                        
                    try:
                        val = float(val) if val is not None else 0
                    except (ValueError, TypeError):
                        pass
                    final_input[ef] = val
                    
                final_df = pd.DataFrame([final_input])
        else:
            # Emergency fallback: use the input as-is if no features defined
            final_df = pd.DataFrame([data])

        # 5. Predict
        prediction = model.predict(final_df)[0]
        
        probability = 0
        if hasattr(model, 'predict_proba'):
            try:
                probability = model.predict_proba(final_df)[0][1]
            except:
                probability = float(prediction)

        # 5.5 Two-Tiered Logic (Lifestyle vs Clinical)
        has_clinical_data = data.get('hasClinicalData', 0) == 1
        
        # Calculate Clinical Confidence
        # Baselines: BMI, Age, HighBP, HighChol, Smoking, Activity, HeartDisease (7 lifestyle factors)
        # Clinicals: HbA1c, Glucose (2 clinical factors)
        # Total "points" = 9. 
        confidence_points = 7 # We always have the lifestyle ones from onboarding
        if data.get('hba1cEstimated'): confidence_points += 1
        if data.get('bloodGlucoseEstimated'): confidence_points += 1
        confidence_score = (confidence_points / 9.0) * 100

        mode = "CLINICAL" if has_clinical_data else "LIFESTYLE"

        if not has_clinical_data:
            # If no clinical data, it's a Lifestyle Risk Score. We dampen extreme probabilities 
            # so the model doesn't falsely diagnose diabetes based solely on BMI/Age.
            if probability > 0.75:
                probability = 0.75 # Cap max lifestyle risk
            if probability < 0.25:
                probability = 0.25 # Floor min lifestyle risk
        
        # 6. SHAP-style Explainable AI logic
        main_reasons = []
        if hasattr(model, 'feature_importances_'):
            importances = model.feature_importances_
            # Feature maps for human-friendly reasons
            clinical_names = {
                'bmi': 'High BMI',
                'age': 'Age Factor',
                'highbp': 'High Blood Pressure',
                'highchol': 'High Cholesterol',
                'smoker': 'Smoking History',
                'physactivity': 'Low Physical Activity',
                'heartdiseaseorattack': 'Heart Health History',
                'genhlth': 'General Health Profile',
                'hba1cestimated': 'Elevated HbA1c',
                'bloodglucoseestimated': 'High blood glucose'
            }
            
            features = [f.lower().replace('_', '') for f in final_df.columns]
            user_vals = final_df.iloc[0].values
            
            impacts = []
            for i, val in enumerate(user_vals):
                name = features[i]
                imp = importances[i]
                
                # Only include as a 'reason' if the user's value is in a risk range
                is_risk = False
                if name == 'physactivity' and val == 0: is_risk = True # No activity
                elif name == 'genhlth' and val >= 3: is_risk = True # Poor self-reported health
                elif name == 'bmi' and val > 27: is_risk = True # Overweight threshold
                elif val >= 1: is_risk = True # Binary risk tags like HighBP, HighChol, Smoker
                
                if is_risk:
                    impacts.append((clinical_names.get(name, name.capitalize()), imp))
            
            # Special case for biomarkers: only show as risk if they are actually high
            final_impacts = []
            for lab_name, imp in impacts:
                if lab_name == 'Elevated HbA1c' and float(final_df.iloc[0].get('HbA1c_estimated', 0)) < 5.7:
                    continue
                if lab_name == 'High blood glucose' and float(final_df.iloc[0].get('BloodGlucose_estimated', 0)) < 100:
                    continue
                final_impacts.append((lab_name, imp))

            # Sort by clinical significance (the model's global weighting)
            final_impacts.sort(key=lambda x: x[1], reverse=True)
            main_reasons = [x[0] for x in final_impacts[:2]] # Top 2 reasons

        risk_score = int(probability * 100)
        
        if int(prediction) == 1 or risk_score >= 70:
            risk_level = "High Risk"
            insights = ["Consult with a healthcare provider immediately.", "Immediate action on diet and exercise is advised."]
        elif risk_score >= 35:
            risk_level = "Medium Risk"
            insights = ["Review your diet and physical activity levels.", "Small lifestyle changes can lower risk."]
        else:
            risk_level = "Low Risk"
            insights = ["Your clinical metrics look stable.", "Maintain your healthy lifestyle."]

        result = {
            "success": True,
            "prediction": int(prediction),
            "probability": float(probability),
            "riskScore": risk_score,
            "riskLevel": risk_level,
            "insights": insights,
            "main_reasons": main_reasons,
            "used_features": final_df.to_dict(orient='records')[0],
            "mode": mode,
            "confidenceScore": confidence_score
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        error_result = {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        print(json.dumps(error_result))

if __name__ == "__main__":
    predict_diabetes()