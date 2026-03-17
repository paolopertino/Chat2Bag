import requests
import json
import time

BASE_URL = "http://127.0.0.1:8000/api"

TEST_BAG_1 = "/home/paolopertino/adehome/aida_code/bags/2025-02-28_10-17_sensors_raw"
TEST_BAG_2 = "/home/paolopertino/adehome/aida_code/bags/2025-11-05_19-00_normal"

def test_indexing():
    print("\n--- Testing Phase A: Indexing ---")
    payload = {"bag_path": TEST_BAG_1}
    response = requests.post(f"{BASE_URL}/index", json=payload)
    
    print(f"Status Code: {response.status_code}")
    print(f"Response: {json.dumps(response.json(), indent=2)}")
    print("Note: Indexing runs in the background. Wait a bit before searching if this is a fresh bag!")

def test_search():
    print("\n--- Testing Phase B: Federated Search ---")
    payload = {
        "query": "a pedestrian on the crosswalk",
        "bag_paths": [TEST_BAG_1, TEST_BAG_2],
        "top_k": 3
    }
    
    start_time = time.time()
    response = requests.post(f"{BASE_URL}/search", json=payload)
    end_time = time.time()
    
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        data = response.json()
        print(f"Latency: {end_time - start_time:.4f} seconds")
        print(f"Top Result: {json.dumps(data['results'][0] if data['results'] else 'None', indent=2)}")
        
        if data['results']:
            return data['results'][0]['timestamp_ns']
    else:
        print(f"Error: {response.text}")
    return None

def test_chat(target_timestamp_ns):
    print("\n--- Testing Phase B: Video Chat ---")
    if not target_timestamp_ns:
        print("Skipping chat test: No timestamp provided.")
        return

    payload = {
        "bag_path": TEST_BAG_1,
        "start_ns": target_timestamp_ns,
        "duration": 10,
        "query": "Describe what the pedestrian is doing in this sequence."
    }
    
    start_time = time.time()
    response = requests.post(f"{BASE_URL}/chat", json=payload)
    end_time = time.time()
    
    print(f"Status Code: {response.status_code}")
    if response.status_code == 200:
        print(f"Latency: {end_time - start_time:.4f} seconds")
        print(f"VLM Response:\n{response.json()['response']}")
    else:
        print(f"Error: {response.text}")

if __name__ == "__main__":
    print("Starting API Tests...")
    
    # Test the background indexer (Uncomment if you need to index a fresh bag)
    test_indexing()
    
    # Test the search
    best_timestamp = test_search()
    
    # Test chatting with the top result
    if best_timestamp:
        print(f"\nTaking the best hit (Timestamp: {best_timestamp}) and feeding it to Qwen...")
        test_chat(best_timestamp)