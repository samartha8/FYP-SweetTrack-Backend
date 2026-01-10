
import pickle
import os
import sys
import pandas as pd
import sklearn

try:
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_path = os.path.join(script_dir, 'diabetes_model_best.pkl')
    
    if not os.path.exists(model_path):
        print(f"Error: Model not found at {model_path}")
        sys.exit(1)

    with open(model_path, 'rb') as f:
        model = pickle.load(f)
        
    print(f"Model type: {type(model)}")
    
    if hasattr(model, 'feature_names_in_'):
        print("Expected features:", list(model.feature_names_in_))
    elif hasattr(model, 'n_features_in_'):
        print(f"Number of features expected: {model.n_features_in_}")
        print("Feature names not explicitly stored in model, but n_features matches.")
    else:
        print("Model does not store feature info.")
        
except Exception as e:
    print(f"Error inspecting model: {e}")
