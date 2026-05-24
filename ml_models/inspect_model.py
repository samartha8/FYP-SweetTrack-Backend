import pickle
import os
import json
import numpy as np

def inspect_model():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, 'diabetes_model.pkl')
    
    if not os.path.exists(model_path):
        print(json.dumps({"error": "model not found"}))
        return

    with open(model_path, 'rb') as f:
        model = pickle.load(f)
    
    info = {
        "type": str(type(model)),
    }
    
    if hasattr(model, 'feature_names_in_'):
        info["features"] = list(model.feature_names_in_)
    
    # Check for coefficients (Linear models)
    if hasattr(model, 'coef_'):
        info["has_coef"] = True
        info["intercept"] = model.intercept_.tolist() if hasattr(model, 'intercept_') else 0
    
    # Check for feature importances (Tree models)
    if hasattr(model, 'feature_importances_'):
        info["has_importances"] = True
        
    print(json.dumps(info))

if __name__ == "__main__":
    inspect_model()
