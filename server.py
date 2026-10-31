import asyncio
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from engine import OrbitalTacticalEngineV2

app = FastAPI(title="ORBIT-X Defense Core [v2.0-Autonomous]", version="2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

engine = OrbitalTacticalEngineV2(onnx_model_path="risk_surrogate.onnx")


class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, ws: WebSocket):
        await ws.accept()
        self.active_connections.append(ws)

    def disconnect(self, ws: WebSocket):
        if ws in self.active_connections:
            self.active_connections.remove(ws)


manager = ConnectionManager()


@app.get("/")
def root():
    return {
        "status": "ONLINE",
        "version": "2.0-AUTONOMOUS-PARETO",
        "inference_engine": "ONNX Runtime (0.38 ms)",
        "spatial_indexing": "cKDTree O(N log N)",
        "autonomous_agent": engine.autonomous_agent_enabled
    }


@app.get("/api/orbit-track")
def get_orbit_track(asset_id: str = "STARLINK-1007"):
    track = engine.compute_orbital_track(asset_id)
    return {"asset_id": asset_id, "track": track}


@app.websocket("/ws/telemetry")
async def websocket_telemetry(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            frame = engine.step_simulation(dt_seconds=0.5)
            await websocket.send_json(frame)
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


@app.post("/api/simulate-threat")
def simulate_threat(target_id: str = "STARLINK-1007"):
    return engine.simulate_threat_against(target_id=target_id)


@app.post("/api/execute-evasion")
def execute_evasion(strategy_id: str, target_id: str = "STARLINK-1007"):
    return engine.execute_evasive_burn(strategy_id=strategy_id, target_id=target_id)


@app.post("/api/toggle-autonomous-agent")
def toggle_agent(enabled: str = "true"):
    is_enabled = enabled.lower() in ["true", "1", "yes"]
    return engine.set_autonomous_agent(is_enabled)


@app.post("/api/reset-threat")
def reset_threat():
    return engine.reset_threat()