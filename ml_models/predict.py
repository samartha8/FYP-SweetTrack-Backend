import sys
import json
import pickle
import os
import pandas as pd
import numpy as np
import warnings

# Disable warnings
warnings.filterwarnings("ignore")

def map_brfss_to_pima(data):
    """
    Map BRFSS-style binary/category inputs to Pima-style clinical approximate values.
    This is a HEURISTIC approximation to allow the model to run if trained on Pima.
    """
    # 1. Age (Category 1-13) -> Years
    # 1:18-24 (21), 2:25-29 (27), ... 13:80+ (80)
    age_map = {
        1: 21, 2: 27, 3: 32, 4: 37, 5: 42, 6: 47, 
        7: 52, 8: 57, 9: 62, 10: 67, 11: 72, 12: 77, 13: 80
    }
    age_cat = data.get('age', 5) # Default to 40-44
    age_years = age_map.get(int(age_cat), 42)

    # 2. Glucose
    # If estimated (from frontend), use it. Else default.
    glucose = data.get('bloodGlucoseEstimated', data.get('glucose', 100))
    
    # 3. BloodPressure (mm Hg)
    # If HighBP=1, assume 140/90. Normal ~70-80. High ~90.
    high_bp = int(data.get('highBP', 0))
    bp = 90 if high_bp == 1 else 72
    # If 'bloodPressure' is explicitly provided, use it
    if 'bloodPressure' in data:
        bp = data['bloodPressure']

    # 4. BMI
    bmi = data.get('bmi', 25.0)

    # 5. Insulin 
    # Use median ~80 if not provided
    insulin = data.get('insulin', 79) 

    # 6. SkinThickness
    skin = data.get('skinThickness', 20)

    # 7. Pregnancies
    # If male, 0. If female, default 1.
    is_male = int(data.get('sex', 0))
    pregnancies = 0 if is_male == 1 else data.get('pregnancies', 1)

    # 8. DiabetesPedigreeFunction
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
        model_path = os.path.join(script_dir, 'diabetes_model_best.pkl')
        
        if not os.path.exists(model_path):
            raise FileNotFoundError(f"Model file not found at: {model_path}")
            
        with open(model_path, 'rb') as f:
            model = pickle.load(f)
            
        # 3. Detect expected features
        expected_features = None
        if hasattr(model, 'feature_names_in_'):
            expected_features = list(model.feature_names_in_)
        elif hasattr(model, 'n_features_in_'):
            # Fallback heuristic
            if model.n_features_in_ == 8:
                expected_features = ['Pregnancies', 'Glucose', 'BloodPressure', 'SkinThickness', 'Insulin', 'BMI', 'DiabetesPedigreeFunction', 'Age']
            
        # 4. Prepare Features
        df = pd.DataFrame([data])
        df.columns = [c.lower() for c in df.columns]
        
        final_df = df
        
        if expected_features:
            pima_cols = [c.lower() for c in ['Pregnancies', 'Glucose', 'BloodPressure', 'SkinThickness', 'Insulin', 'BMI', 'DiabetesPedigreeFunction', 'Age']]
            expects_pima = any(c.lower() in pima_cols for c in expected_features)
            
            mapped_successfully = False
            
            if expects_pima:
                has_brfss_keys = 'highbp' in df.columns
                has_pima_keys = 'glucose' in df.columns and 'insulin' in df.columns
                
                if has_brfss_keys and not has_pima_keys:
                    mapped_dict = map_brfss_to_pima(data)
                    final_input = {}
                    for ef in expected_features:
                        final_input[ef] = mapped_dict.get(ef, 0)
                    final_df = pd.DataFrame([final_input])
                    mapped_successfully = True

            if not mapped_successfully:
                # Generic robust align
                final_input = {}
                input_map = {k.lower().replace('_', ''): v for k, v in data.items()}
                
                # Debug input keys
                sys.stderr.write(f"Input Keys Normalized: {list(input_map.keys())}\n")
                sys.stderr.write(f"Expected Features: {expected_features}\n")

                for ef in expected_features:
                    ef_norm = ef.lower().replace('_', '')
                    val = 0
                    if ef_norm in input_map:
                        val = input_map[ef_norm]
                    try:
                        val = float(val)
                    except (ValueError, TypeError):
                        val = 0
                    final_input[ef] = val
                    
                final_df = pd.DataFrame([final_input])

        # 5. Predict
        prediction = model.predict(final_df)[0]
        
        probability = 0
        if hasattr(model, 'predict_proba'):
            try:
                probability = model.predict_proba(final_df)[0][1]
            except:
                probability = float(prediction)
        
        result = {
            "success": True,
            "prediction": int(prediction),
            "probability": float(probability),
            "riskScore": int(probability * 100),
            "used_features": final_df.to_dict(orient='records')[0]
        }
        
        print(json.dumps(result))
        
    except Exception as e:
        import traceback
        error_result = {
            "success": False,
            "error": str(e),
            "traceback": traceback.format_exc()
        }
        print(json.dumps(error_result))

if __name__ == "__main__":
    predict_diabetes()
