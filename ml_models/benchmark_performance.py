import sys
import os
import json
import time
import subprocess

def run_benchmark(image_path):
    print(f"🚀 Benchmarking prediction for: {image_path}")
    
    start_total = time.time()
    
    # We call the script directly to measure "one-off" cost which includes model loading
    # but we are mainly interested in the segment_and_classify time printed to stderr
    cmd = [sys.executable, "predict_food.py", image_path]
    
    process = subprocess.Popen(
        cmd, 
        stdout=subprocess.PIPE, 
        stderr=subprocess.PIPE, 
        text=True
    )
    
    stdout, stderr = process.communicate()
    end_total = time.time()
    
    if process.returncode != 0:
        print(f"❌ Error: {stderr}")
        return
        
    print("\n--- Raw Output ---")
    print(stdout)
    
    print("\n--- Debug Trace (contains timing info) ---")
    print(stderr)
    
    print("\n--- Summary ---")
    print(f"Total Wall Time: {end_total - start_total:.2f}s")
    
    # Try to parse number of items from results
    try:
        results = json.loads(stdout)
        print(f"Detected items: {len(results)}")
    except:
        pass

if __name__ == "__main__":
    test_image = "MobileSAM/MobileSAMv2/test_images/1.jpg"
    if len(sys.argv) > 1:
        test_image = sys.argv[1]
        
    if not os.path.exists(test_image):
        print(f"File not found: {test_image}")
        sys.exit(1)
        
    run_benchmark(test_image)
