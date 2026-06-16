import json
import time

import pytest
import requests

# Manual integration smoke script — NOT part of the automated unit suite. Its
# `test_*` functions POST to a live server at :8000 (run directly with
# `python tests/test_api.py`). Skipped during pytest collection so a stopped
# server can't fail the suite.
pytestmark = pytest.mark.skip(reason="manual integration script; requires a live server at :8000")

BASE_URL = "http://127.0.0.1:8000/api"

TEST_BAG_1 = "~/bags/my_bag1/"
TEST_BAG_2 = "~/bags/my_bag2/"

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

if __name__ == "__main__":
    print("Starting API Tests...")

    # Test the background indexer (Uncomment if you need to index a fresh bag)
    test_indexing()

    # Test the search
    test_search()
