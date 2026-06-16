import asyncio
import websockets
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor

def trigger_inject():
    req = urllib.request.Request("http://localhost:8000/api/demo/inject", method="POST")
    with urllib.request.urlopen(req) as response:
        return response.read().decode()

async def test_flow():
    try:
        async with websockets.connect("ws://localhost:8000/ws") as ws:
            print("Connected to WS")
            
            msg = await ws.recv()
            data = json.loads(msg)
            if data["type"] == "satellite_update":
                print("Received initial satellite_update")
                
            print("Triggering injection...")
            loop = asyncio.get_running_loop()
            with ThreadPoolExecutor() as pool:
                resp = await loop.run_in_executor(pool, trigger_inject)
            print("Inject response:", resp)
                    
            expected = ["system_status", "conjunction_detected", "negotiation_update (bids_requested)", 
                        "negotiation_update (bids_received)", "negotiation_update (winner_selected)", "hitl_request"]
            
            while expected:
                msg = await ws.recv()
                data = json.loads(msg)
                t = data["type"]
                if t == "satellite_update":
                    continue
                    
                print(f"Received WS message: {t}")
                
                if t == "system_status":
                    if "system_status" in expected:
                        expected.remove("system_status")
                        print(" - OK: system_status")
                elif t == "conjunction_detected":
                    if "conjunction_detected" in expected:
                        expected.remove("conjunction_detected")
                        print(" - OK: conjunction_detected", data.get("payload", {}).get("pc"))
                elif t == "negotiation_update":
                    stage = data.get("payload", {}).get("stage")
                    target = f"negotiation_update ({stage})"
                    if target in expected:
                        expected.remove(target)
                        print(f" - OK: {target}")
                elif t == "hitl_request":
                    if "hitl_request" in expected:
                        expected.remove("hitl_request")
                        print(" - OK: hitl_request")
                        
            print("All expected events received!")
    except Exception as e:
        print("Error:", e)

if __name__ == "__main__":
    asyncio.run(test_flow())
