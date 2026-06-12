import asyncio
from backend.agents.graph import graph
from backend.api.routes import demo_inject
from backend.agents.state import AgentState

async def run_test():
    resp = await demo_inject()
    print("Demo inject returned:", resp)

if __name__ == "__main__":
    asyncio.run(run_test())
