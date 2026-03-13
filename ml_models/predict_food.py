import sys
import os
import json
import numpy as np
import cv2
import gc
import torch

# Force use of tf_keras for legacy Keras 2 support
try:
    import tf_keras as keras
    from tf_keras import layers, models
except ImportError:
    try:
        import tensorflow.keras as keras
        from tensorflow.keras import layers, models
    except ImportError:
        import keras
        from keras import layers, models

from keras.applications.efficientnet import preprocess_input

# --- Contextual Mapping for Nepalese Context (Thakali Upgrade) ---
# Maps standard model classes to Nepalese labels and their specific nutrition keys
NEPALESE_MAPPING = {
    "miso_soup": {"label": "Dal (Lentil Soup)", "nutrition_key": "dal"},
    "fried_rice": {"label": "Rice (Bhat)", "nutrition_key": "rice"},
    "steamed_rice": {"label": "Rice (Bhat)", "nutrition_key": "rice"},
    "risotto": {"label": "Rice (Bhat)", "nutrition_key": "rice"},
    "paella": {"label": "Rice (Bhat)", "nutrition_key": "rice"},
    "sushi": {"label": "Rice (Bhat)", "nutrition_key": "rice"},
    "gnocchi": {"label": "Rice (Bhat)", "nutrition_key": "rice"},
    "chicken_curry": {"label": "Chicken Curry (Masu)", "nutrition_key": "chicken_curry"},
    "chicken_quesadilla": {"label": "Thakali Side/Meat", "nutrition_key": "chicken_quesadilla"},
    "french_fries": {"label": "Potato Side (Aloo)", "nutrition_key": "chicken_curry"}, # Proxy to meat for calories
    "poutine": {"label": "Potato Side (Aloo)", "nutrition_key": "chicken_curry"},
    "hummus": {"label": "Achar (Pickle)", "nutrition_key": "hummus"},
    "guacamole": {"label": "Achar (Green)", "nutrition_key": "hummus"},
    "samosa": {"label": "Samosa", "nutrition_key": "samosa"},
    "pad_thai": {"label": "Chowmein/Noodles", "nutrition_key": "chowmein"},
    "bibimbap": {"label": "Mixed Rice Bowl", "nutrition_key": "bibimbap"},
    "dumplings": {"label": "Momo (Dumplings)", "nutrition_key": "momo"},
    "donuts": {"label": "Sel Roti", "nutrition_key": "sel_roti"},
    "spring_rolls": {"label": "Samosa", "nutrition_key": "samosa"},
    "panna_cotta": {"label": "Curd (Dahi)", "nutrition_key": "curd"},
    "frozen_yogurt": {"label": "Curd (Dahi)", "nutrition_key": "curd"},
    "seaweed_salad": {"label": "Saag (Greens)", "nutrition_key": "saag"}
}

# --- SAM Integration ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SAM_PATH = os.path.join(BASE_DIR, 'MobileSAM')
if os.path.exists(SAM_PATH):
    sys.path.append(SAM_PATH)
    try:
        from mobile_sam import sam_model_registry, SamAutomaticMaskGenerator
        SAM_AVAILABLE = True
    except ImportError:
        SAM_AVAILABLE = False
else:
    SAM_AVAILABLE = False

# --- Configuration ---
MODEL_PATH = os.path.abspath(os.path.join(BASE_DIR, 'model.keras'))
CLASSES_PATH = os.path.abspath(os.path.join(BASE_DIR, 'class_names.json'))
METADATA_PATH = os.path.abspath(os.path.join(BASE_DIR, 'model_metadata.json'))
SAM_CHECKPOINT = os.path.abspath(os.path.join(BASE_DIR, 'MobileSAM/weights/mobile_sam.pt'))

# Global models and classes
GLOBAL_MODEL = None
GLOBAL_CLASSES = None
GLOBAL_SAM_GENERATOR = None

def debug_print(msg):
    """Prints to stderr so it doesn't break JSON output on stdout."""
    sys.stderr.write(f"DEBUG: {msg}\n")
    sys.stderr.flush()

def load_config():
    """Loads model metadata."""
    if not os.path.exists(METADATA_PATH):
        debug_print(f"Metadata file missing at {METADATA_PATH}")
        return {"num_classes": 166} # Fallback
    try:
        with open(METADATA_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        debug_print(f"Error loading metadata: {e}")
        return {"num_classes": 166}

def load_food_classes():
    """Loads class names from JSON file."""
    if not os.path.exists(CLASSES_PATH):
        debug_print(f"Classes file missing at {CLASSES_PATH}")
        return []
    try:
        with open(CLASSES_PATH, 'r') as f:
            return json.load(f)
    except Exception as e:
        debug_print(f"Error loading classes: {e}")
        return []

def build_transfer_model(num_classes, input_shape=(224, 224, 3)):
    """Recreates the exact architecture used in the unified training notebook."""
    debug_print(f"Reconstructing EfficientNetB0 architecture for {num_classes} classes")
    
    base_model = keras.applications.EfficientNetB0(
        include_top=False,
        weights=None, # Weights will be loaded from file
        input_shape=input_shape
    )
    
    inputs = layers.Input(shape=input_shape, name="input")
    
    # Preprocessing layer
    x = layers.Lambda(lambda img: preprocess_input(img), name="preprocessing")(inputs)
    
    x = base_model(x)
    x = layers.GlobalAveragePooling2D(name="gap")(x)
    x = layers.Dense(512, activation='relu', name="fc1")(x)
    x = layers.BatchNormalization(name="fc1_bn")(x)
    x = layers.Dropout(0.5, name="fc1_dropout")(x)
    outputs = layers.Dense(num_classes, activation='softmax', name="output")(x)
    
    model = models.Model(inputs=inputs, outputs=outputs, name="EfficientNetB0")
    return model

def init_sam():
    global GLOBAL_SAM_GENERATOR
    if not SAM_AVAILABLE:
        debug_print("SAM not available (missing dependencies or repo)")
        return
    
    if not os.path.exists(SAM_CHECKPOINT):
        debug_print(f"SAM checkpoint missing at {SAM_CHECKPOINT}")
        return

    try:
        debug_print("Initializing Mobile-SAM Generator (Accuracy Optimized Safety Mode)...")
        model_type = "vit_t" 
        sam = sam_model_registry[model_type](checkpoint=SAM_CHECKPOINT)
        sam.to(device="cpu")
        
        # Accuracy Optimization: 14x14 grid (196 points)
        # Much better for small bowls in Thakali, while keeping memory in check
        GLOBAL_SAM_GENERATOR = SamAutomaticMaskGenerator(
            model=sam,
            points_per_side=14, 
            pred_iou_thresh=0.86,
            stability_score_thresh=0.90, # Lowered for better texture detection
            min_mask_region_area=800, # Catch smaller bowls
            points_per_batch=32 # Moderate batch size
        )
        debug_print("✅ Mobile-SAM initialized in Accuracy Safety Mode.")
    except Exception as e:
        debug_print(f"Error initializing SAM: {e}")

def load_trained_model():
    global GLOBAL_MODEL
    if GLOBAL_MODEL is not None:
        return GLOBAL_MODEL

    config = load_config()
    num_classes = config.get("num_classes", 166)
    
    if not os.path.exists(MODEL_PATH):
        print(json.dumps({"error": f"Model file missing at {MODEL_PATH}"}))
        sys.exit(1)
        
    try:
        model = build_transfer_model(num_classes)
        debug_print(f"Loading weights from {MODEL_PATH}")
        model.load_weights(MODEL_PATH)
        # Warmup prediction
        warmup_arr = np.zeros((1, 224, 224, 3), dtype=np.float32)
        model.predict(warmup_arr, verbose=0)
        GLOBAL_MODEL = model
        return model
    except Exception as e:
        debug_print(f"Direct load failed: {e}. Trying secondary method...")
        try:
            GLOBAL_MODEL = keras.models.load_model(MODEL_PATH)
            # Warmup prediction
            warmup_arr = np.zeros((1, 224, 224, 3), dtype=np.float32)
            GLOBAL_MODEL.predict(warmup_arr, verbose=0)
            return GLOBAL_MODEL
        except:
            print(json.dumps({"error": f"Model load error: {str(e)}"}))
            sys.exit(1)

def preprocess_image(img_path):
    try:
        from keras.preprocessing import image
        img = image.load_img(img_path, target_size=(224, 224), interpolation='bicubic')
        img_array = image.img_to_array(img)
        img_array = np.expand_dims(img_array, axis=0)
        return img_array
    except Exception as e:
        debug_print(f"Image error: {e}")
        return None

def compute_metrics(boxA, boxB):
    # box format [x, y, bw, bh] normalized
    xA = max(boxA[0], boxB[0])
    yA = max(boxA[1], boxB[1])
    xB = min(boxA[0] + boxA[2], boxB[0] + boxB[2])
    yB = min(boxA[1] + boxA[3], boxB[1] + boxB[3])
    
    interArea = max(0, xB - xA) * max(0, yB - yA)
    boxAArea = boxA[2] * boxA[3]
    boxBArea = boxB[2] * boxB[3]
    
    # Intersection over Union
    iou = interArea / float(boxAArea + boxBArea - interArea + 1e-6)
    
    # Intersection over Minimum Area (Containment check)
    iom = interArea / float(min(boxAArea, boxBArea) + 1e-6)
    
    return iou, iom

def apply_nms(results, iou_threshold=0.3, iom_threshold=0.7):
    if not results: return []
    # Sort by confidence
    sorted_res = sorted(results, key=lambda x: x['confidence'], reverse=True)
    kept = []
    for current in sorted_res:
        discard = False
        for k in kept:
            iou, iom = compute_metrics(current['box'], k['box'])
            
            # Discard if high overlap OR one is significantly inside the other
            # This is CRITICAL for preventing double-counting in bowls
            if iou > iou_threshold or iom > iom_threshold:
                discard = True
                break
        if not discard:
            kept.append(current)
    return kept

def perform_prediction(model, food_classes, image_path):
    """Fallback: Predict on the whole image if segmentation is not possible."""
    processed_img = preprocess_image(image_path)
    if processed_img is None:
        return [{"error": f"Failed to load image: {image_path}"}]

    try:
        predictions = model.predict(processed_img, verbose=0)
        predictions = predictions.astype(np.float32)
        top_indices = predictions[0].argsort()[-1:][::-1] # Single result for simplicity
        
        i = top_indices[0]
        class_name = food_classes[i]
        result = {
            "class": class_name,
            "label": class_name.replace('_', ' ').capitalize(),
            "confidence": float(predictions[0][i]),
            "box": [0, 0, 1, 1], # Normalized whole image
            "id": 0
        }
        return [result]
    except Exception as e:
        return [{"error": f"Prediction failed: {str(e)}"}]

def segment_and_classify(image_path):
    global GLOBAL_MODEL, GLOBAL_CLASSES, GLOBAL_SAM_GENERATOR
    
    if not GLOBAL_SAM_GENERATOR:
        return perform_prediction(GLOBAL_MODEL, GLOBAL_CLASSES, image_path)

    try:
        image = cv2.imread(image_path)
        if image is None:
            return perform_prediction(GLOBAL_MODEL, GLOBAL_CLASSES, image_path)
            
        h_orig, w_orig = image.shape[:2]
        
        # Optimization: Downscale even further for stability
        # 512px is much safer for low-RAM systems
        MAX_SEG_DIM = 512
        if max(h_orig, w_orig) > MAX_SEG_DIM:
            scale = MAX_SEG_DIM / max(h_orig, w_orig)
            image_small = cv2.resize(image, (int(w_orig * scale), int(h_orig * scale)), interpolation=cv2.INTER_AREA)
            debug_print(f"Downscaled segmentation target to {image_small.shape[1]}x{image_small.shape[0]}")
        else:
            image_small = image
            scale = 1.0

        image_rgb_small = cv2.cvtColor(image_small, cv2.COLOR_BGR2RGB)
        h_small, w_small = image_small.shape[:2]

        debug_print(f"Segmenting {image_path} (Point density: 12x12)...")
        import time
        start_seg = time.time()
        masks = GLOBAL_SAM_GENERATOR.generate(image_rgb_small)
        debug_print(f"Segmentation took {time.time() - start_seg:.2f}s")
        
        # Sort by area descending and filter out tiny or huge (full plate) segments
        # 0.005 (0.5%) is better for catching specific items in complex multi-item meals
        filtered_masks = [m for m in masks if 0.005 < (m['area'] / (h_small * w_small)) < 0.70]
        
        # Increase limit to 10 for complex plates like Thakali
        filtered_masks = sorted(filtered_masks, key=lambda x: x['area'], reverse=True)[:10]
        
        if not filtered_masks:
            debug_print("No suitable segments found, falling back to whole image.")
            return perform_prediction(GLOBAL_MODEL, GLOBAL_CLASSES, image_path)

        # Prepare batch for classification
        crops = []
        metadata = []
        
        # Use original image for high-quality crops
        image_rgb_orig = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        for idx, mask in enumerate(filtered_masks):
            # Scale bbox back to original image coordinates
            x_s, y_s, bw_s, bh_s = mask['bbox']
            x = int(x_s / scale)
            y = int(y_s / scale)
            bw = int(bw_s / scale)
            bh = int(bh_s / scale)
            
            # Crop the segment with a small margin
            margin = 15
            x1 = max(0, x - margin)
            y1 = max(0, y - margin)
            x2 = min(w_orig, x + bw + margin)
            y2 = min(h_orig, y + bh + margin)
            
            crop = image_rgb_orig[y1:y2, x1:x2]
            
            # Pad to square to maintain aspect ratio for EfficientNet
            ch, cw = crop.shape[:2]
            size = max(ch, cw)
            pad_h = (size - ch) // 2
            pad_w = (size - cw) // 2
            
            square_crop = cv2.copyMakeBorder(crop, pad_h, size - ch - pad_h, pad_w, size - cw - pad_w, cv2.BORDER_CONSTANT, value=[0, 0, 0])
            
            # Resize for EfficientNet
            resized = cv2.resize(square_crop, (224, 224), interpolation=cv2.INTER_CUBIC)
            crops.append(resized.astype(np.float32))
            
            metadata.append({
                "box": [float(x/w_orig), float(y/h_orig), float(bw/w_orig), float(bh/h_orig)],
                "id": idx + 1
            })
            
        # Clean up memory before and after classification
        gc.collect()
        
        # Batch Predict
        debug_print(f"Batch classifying {len(crops)} segments...")
        start_cls = time.time()
        batch_input = np.stack(crops, axis=0)
        preds = GLOBAL_MODEL.predict(batch_input, verbose=0)
        debug_print(f"Classification took {time.time() - start_cls:.2f}s")
        
        results = []
        used_labels = set()
        
        for i, p in enumerate(preds):
            top_indices = p.argsort()[-5:][::-1] # More context
            best_match = None
            
            # First pass: try to find a regional match that hasn't been used yet
            for idx in top_indices:
                name = GLOBAL_CLASSES[idx]
                conf = float(p[idx])
                mapping = NEPALESE_MAPPING.get(name)
                
                if mapping:
                    label = mapping["label"]
                    # If we haven't used this label OR it's a super high confidence match
                    if label not in used_labels or conf > 0.85:
                        best_match = {
                            "class": mapping["nutrition_key"],
                            "label": label,
                            "confidence": conf
                        }
                        used_labels.add(label)
                        break
            
            # Second pass: fallback to top generic if no regional match or all used
            if not best_match:
                top_idx = top_indices[0]
                label = GLOBAL_CLASSES[top_idx].replace('_', ' ').capitalize()
                best_match = {
                    "class": GLOBAL_CLASSES[top_idx],
                    "label": label,
                    "confidence": float(p[top_idx])
                }
                used_labels.add(label)
            
            results.append({
                "class": best_match["class"],
                "label": best_match["label"],
                "confidence": best_match["confidence"],
                "box": metadata[i]["box"],
                "id": metadata[i]["id"]
            })
            
        # Final deduplication
        results = apply_nms(results)
        
        debug_print(f"✅ Found and classified {len(results)} food components after NMS.")
        
        # Final memory cleanup
        del masks
        del crops
        del batch_input
        gc.collect()
        
        return results

    except Exception as e:
        debug_print(f"Segmentation failed: {e}")
        return perform_prediction(GLOBAL_MODEL, GLOBAL_CLASSES, image_path)

def run_daemon():
    global GLOBAL_CLASSES
    debug_print("Starting SmartMealLog Hybrid Inference Daemon...")
    
    GLOBAL_CLASSES = load_food_classes()
    load_trained_model()
    init_sam()
    
    debug_print("Daemon READY.")
    
    while True:
        try:
            line = sys.stdin.readline()
            if not line: break
            
            img_path = line.strip()
            if not img_path: continue
                
            debug_print(f"Request: {img_path}")
            results = segment_and_classify(img_path)
            
            print(json.dumps(results))
            sys.stdout.flush()
            
        except Exception as e:
            debug_print(f"Error: {e}")
            print(json.dumps({"error": str(e)}))
            sys.stdout.flush()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--daemon":
        run_daemon()
    else:
        img_path = sys.argv[1] if len(sys.argv) > 1 else None
        if not img_path: sys.exit(1)
        
        GLOBAL_CLASSES = load_food_classes()
        load_trained_model()
        init_sam()
        print(json.dumps(segment_and_classify(img_path)))
