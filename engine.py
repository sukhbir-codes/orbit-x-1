import math
import numpy as np
from datetime import datetime, timezone
from scipy.spatial import cKDTree
import onnxruntime as ort
from typing import List, Dict, Any, Tuple

EARTH_RADIUS_KM = 6378.137


class OrbitalTacticalEngineV2:
    def __init__(self, onnx_model_path: str = "risk_surrogate.onnx"):
        self.session = ort.InferenceSession(onnx_model_path)
        self.input_name = self.session.get_inputs()[0].name
        self.active_conjunction: Dict[str, Any] | None = None
        self.executed_burn_log: Dict[str, Any] | None = None
        self.autonomous_agent_enabled: bool = False
        self.trajectory_history: Dict[str, Any] | None = None
        self.conjunction_history: List[Dict[str, Any]] = []
        self.simulated_interceptor: Dict[str, Any] | None = None
        self.assets = self._init_catalog()

    def _init_catalog(self) -> List[Dict[str, Any]]:
        assets = []
        for i in range(25):
            mean_anomaly = float(i * (360.0 / 25.0))
            assets.append({
                "id": f"STARLINK-{1000 + i}",
                "type": "PAYLOAD",
                "mean_anomaly_deg": mean_anomaly,
                "inc_deg": 53.0,
                "raan_deg": float((i * 43.2) % 360.0),
                "lat": 0.0,
                "lon": 0.0,
                "alt_km": 550.0,
                "velocity_kms": 7.61,
                "fuel_g": 4500.0,
                "dry_mass_kg": 260.0,
                "isp_s": 220.0
            })

        sources = ["COSMOS-2251", "FENGYUN-1C", "SL-16", "IRIDIUM-33"]
        for j in range(45):
            src = np.random.choice(sources)
            mean_anomaly = float(np.random.uniform(0.0, 360.0))
            assets.append({
                "id": f"{src}-DEB-{j+1:03d}",
                "type": "DEBRIS",
                "mean_anomaly_deg": mean_anomaly,
                "inc_deg": float(np.random.choice([53.0, 65.0, 74.0, 82.5, 98.6])),
                "raan_deg": float(np.random.uniform(0.0, 360.0)),
                "lat": 0.0,
                "lon": 0.0,
                "alt_km": float(np.random.uniform(520.0, 720.0)),
                "velocity_kms": float(np.random.uniform(7.42, 7.69)),
                "fuel_g": 0.0,
                "dry_mass_kg": float(np.random.uniform(1.2, 32.0)),
                "isp_s": 0.0
            })
        
        for obj in assets:
            self._update_lat_lon(obj)
            
        return assets

    def calculate_propellant_burn(self, delta_v_ms: float, wet_mass_kg: float = 260.0, isp_s: float = 220.0) -> float:
        g0 = 9.80665
        mass_fraction = 1.0 - math.exp(-delta_v_ms / (isp_s * g0))
        return round(wet_mass_kg * mass_fraction * 1000.0, 2)

    def _get_cartesian(self, obj: Dict[str, Any]) -> np.ndarray:
        r = EARTH_RADIUS_KM + obj["alt_km"]
        lat_rad = math.radians(obj["lat"])
        lon_rad = math.radians(obj["lon"])
        return np.array([
            r * math.cos(lat_rad) * math.cos(lon_rad),
            r * math.cos(lat_rad) * math.sin(lon_rad),
            r * math.sin(lat_rad)
        ])

    def _update_lat_lon(self, obj: Dict[str, Any]) -> None:
        u = math.radians(obj["mean_anomaly_deg"])
        inc = math.radians(obj["inc_deg"])
        raan = math.radians(obj["raan_deg"])

        sin_lat = max(-1.0, min(1.0, math.sin(inc) * math.sin(u)))
        lat_rad = math.asin(sin_lat)

        y_lon = math.cos(inc) * math.sin(u)
        x_lon = math.cos(u)
        lon_rad = raan + math.atan2(y_lon, x_lon)

        obj["lat"] = round(math.degrees(lat_rad), 3)

        lon_deg = math.degrees(lon_rad) % 360.0
        if lon_deg > 180.0:
            lon_deg -= 360.0
        elif lon_deg < -180.0:
            lon_deg += 360.0
        obj["lon"] = round(lon_deg, 3)

    def _propagate_satellite(self, obj: Dict[str, Any], dt_seconds: float = 0.5) -> None:
        earth_rot_deg = (360.0 / 86164.0) * dt_seconds
        mean_motion_deg_per_sec = 360.0 / (95.0 * 60.0)

        obj["mean_anomaly_deg"] = (obj["mean_anomaly_deg"] + mean_motion_deg_per_sec * dt_seconds) % 360.0
        obj["raan_deg"] = (obj["raan_deg"] - earth_rot_deg) % 360.0
        self._update_lat_lon(obj)

    def compute_orbital_track(self, asset_id: str, steps: int = 240, custom_inc: float = None, custom_alt: float = None) -> List[List[float]]:
        target = next((a for a in self.assets if a["id"] == asset_id), None)
        if not target and self.simulated_interceptor and self.simulated_interceptor["id"] == asset_id:
            target = self.simulated_interceptor
        if not target:
            target = self.assets[0]

        track = []
        inc = math.radians(custom_inc if custom_inc is not None else target["inc_deg"])
        raan = math.radians(target["raan_deg"])
        alt = custom_alt if custom_alt is not None else target["alt_km"]

        for step in range(steps + 1):
            deg = float(step * (360.0 / steps))
            u = math.radians(deg)
            sin_lat = max(-1.0, min(1.0, math.sin(inc) * math.sin(u)))
            lat_deg = math.degrees(math.asin(sin_lat))

            y_lon = math.cos(inc) * math.sin(u)
            x_lon = math.cos(u)
            lon_deg = (math.degrees(raan + math.atan2(y_lon, x_lon))) % 360.0
            if lon_deg > 180.0:
                lon_deg -= 360.0
            elif lon_deg < -180.0:
                lon_deg += 360.0

            track.append([round(lat_deg, 3), round(lon_deg, 3), round(alt, 1)])
        return track

    def step_simulation(self, dt_seconds: float = 0.5) -> Dict[str, Any]:
        for obj in self.assets:
            self._propagate_satellite(obj, dt_seconds)

        if self.simulated_interceptor:
            self._propagate_satellite(self.simulated_interceptor, dt_seconds)

        all_render_assets = list(self.assets)
        if self.simulated_interceptor:
            all_render_assets.append(self.simulated_interceptor)

        coords = np.array([self._get_cartesian(a) for a in all_render_assets])
        tree = cKDTree(coords)
        close_pairs = list(tree.query_pairs(r=50.0))

        # Dynamic proximity scan around current target if conjunction active
        if self.active_conjunction:
            primary_id = self.active_conjunction["primary_asset"]
            primary_obj = next((a for a in all_render_assets if a["id"] == primary_id), None)
            if primary_obj:
                p_pos = self._get_cartesian(primary_obj)
                debris_list = [a for a in all_render_assets if a["type"] == "DEBRIS"]
                dist_pairs = []
                for d in debris_list:
                    dist = float(np.linalg.norm(self._get_cartesian(d) - p_pos))
                    dist_pairs.append({"id": d["id"], "miss_km": round(dist, 2)})
                dist_pairs.sort(key=lambda x: x["miss_km"])

                # Include all debris within 65 km, prioritizing the closest
                top_threats = [x for x in dist_pairs if x["miss_km"] <= 65.0]
                if not top_threats and dist_pairs:
                    top_threats = [dist_pairs[0]]

                self.active_conjunction["all_threat_objects"] = top_threats
                self.active_conjunction["threat_object"] = top_threats[0]["id"]
                self.active_conjunction["miss_distance_km"] = top_threats[0]["miss_km"]

        if self.autonomous_agent_enabled and self.active_conjunction:
            rec_plan = next(
                (p for p in self.active_conjunction["pareto_tradespace"] if p["recommended"]),
                self.active_conjunction["pareto_tradespace"][1]
            )
            self.execute_evasive_burn(
                strategy_id=rec_plan["strategy"],
                target_id=self.active_conjunction["primary_asset"]
            )

        payloads = [a for a in self.assets if a["type"] == "PAYLOAD"]
        total_fuel = sum(a["fuel_g"] for a in payloads)
        max_fuel = 25 * 4500.0
        fuel_health_pct = round((total_fuel / max_fuel) * 100.0, 1)

        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "assets": all_render_assets,
            "threat_alert": self.active_conjunction is not None,
            "active_conjunction": self.active_conjunction,
            "executed_burn": self.executed_burn_log,
            "trajectory_history": self.trajectory_history,
            "conjunction_history": self.conjunction_history,
            "fleet_stats": {
                "active_payloads": len(payloads),
                "debris_tracked": len(self.assets) - len(payloads),
                "fleet_fuel_pct": fuel_health_pct,
                "total_fuel_remaining_kg": round(total_fuel / 1000.0, 2)
            },
            "autonomous_agent_enabled": self.autonomous_agent_enabled,
            "spatial_pairs_screened": len(close_pairs),
            "version": "2.0-AUTONOMOUS-PARETO"
        }

    def simulate_threat_against(self, target_id: str = "STARLINK-1007") -> Dict[str, Any]:
        target = next((a for a in self.assets if a["id"] == target_id), self.assets[0])
        target_pos = self._get_cartesian(target)

        # 1. Identify all existing catalog debris and find distances
        all_debris = [a for a in self.assets if a["type"] == "DEBRIS"]
        all_debris.sort(key=lambda d: float(np.linalg.norm(self._get_cartesian(d) - target_pos)))

        # 2. Spawn a designated crossing interceptor directly on an intersecting vector
        interceptor_id = f"INTERCEPTOR-ALPHA-{int(datetime.now().timestamp()) % 1000:03d}"
        miss_dist_primary = round(float(np.random.uniform(0.75, 2.85)), 2)
        tca = int(np.random.randint(120, 320))
        rel_vel = round(float(np.random.uniform(10.8, 14.6)), 1)

        # Realistic crossing geometry: cross-track inclination with altitude proximity
        offset_dir = float(np.random.choice([-1.0, 1.0]))
        cross_inc = round(target["inc_deg"] + (offset_dir * float(np.random.uniform(2.5, 6.5))), 2)
        cross_raan = round((target["raan_deg"] + (offset_dir * float(np.random.uniform(1.2, 3.0)))) % 360.0, 2)
        cross_mean_anom = (target["mean_anomaly_deg"] + (offset_dir * float(np.random.uniform(0.10, 0.25)))) % 360.0
        cross_alt = round(target["alt_km"] + (miss_dist_primary * float(np.random.choice([-1.0, 1.0]))), 2)

        self.simulated_interceptor = {
            "id": interceptor_id,
            "type": "DEBRIS",
            "mean_anomaly_deg": cross_mean_anom,
            "inc_deg": cross_inc,
            "raan_deg": cross_raan,
            "lat": 0.0,
            "lon": 0.0,
            "alt_km": cross_alt,
            "velocity_kms": rel_vel,
            "fuel_g": 0.0,
            "dry_mass_kg": 24.0,
            "isp_s": 0.0
        }
        self._update_lat_lon(self.simulated_interceptor)

        # Gather threats: the incoming interceptor PLUS any existing catalog debris nearby
        threat_list = [{"id": interceptor_id, "miss_km": miss_dist_primary}]
        for d in all_debris[:2]:
            dist = round(float(np.linalg.norm(self._get_cartesian(d) - target_pos)), 2)
            if dist < 65.0:
                threat_list.append({"id": d["id"], "miss_km": dist})
        
        # Sort threats strictly by proximity
        threat_list.sort(key=lambda x: x["miss_km"])
        primary_threat = threat_list[0]

        # Calculate Foster Gaussian risk Pc
        sigma = 1.15
        exponent = -(primary_threat["miss_km"]**2) / (2.0 * (sigma**2))
        pc = round(float(np.clip(math.exp(exponent) * 0.94, 0.045, 0.975)), 4)

        evasion_dir = -1.0 if (cross_alt > target["alt_km"]) else 1.0

        rec_min_fuel = (primary_threat["miss_km"] > 2.0 and pc < 0.22)
        rec_max_defense = (primary_threat["miss_km"] < 0.95 or pc > 0.45)
        rec_balanced = not (rec_min_fuel or rec_max_defense)

        tradespace = [
            {
                "strategy": "RADIAL_LOW",
                "label": "MIN-FUEL IMPULSE",
                "delta_v_ms": 0.85,
                "delta_alt_km": round(evasion_dir * 12.0, 1),
                "target_clearance_km": round(primary_threat["miss_km"] + 22.0, 1),
                "propellant_penalty_g": self.calculate_propellant_burn(0.85, target.get("dry_mass_kg", 260.0), target.get("isp_s", 220.0)),
                "recommended": rec_min_fuel
            },
            {
                "strategy": "IN_TRACK_NOMINAL",
                "label": f"BALANCED OPTIMUM ({target['id']})",
                "delta_v_ms": 3.80,
                "delta_alt_km": round(evasion_dir * 42.0, 1),
                "target_clearance_km": round(primary_threat["miss_km"] + 65.0, 1),
                "propellant_penalty_g": self.calculate_propellant_burn(3.80, target.get("dry_mass_kg", 260.0), target.get("isp_s", 220.0)),
                "recommended": rec_balanced
            },
            {
                "strategy": "DISPERSION_MAX",
                "label": "MAX DEFENSE PHASING",
                "delta_v_ms": 9.50,
                "delta_alt_km": round(evasion_dir * 95.0, 1),
                "target_clearance_km": round(primary_threat["miss_km"] + 135.0, 1),
                "propellant_penalty_g": self.calculate_propellant_burn(9.50, target.get("dry_mass_kg", 260.0), target.get("isp_s", 220.0)),
                "recommended": rec_max_defense
            }
        ]

        self.active_conjunction = {
            "status": "CRITICAL_HAZARD",
            "primary_asset": target["id"],
            "threat_object": primary_threat["id"],
            "all_threat_objects": threat_list,
            "miss_distance_km": primary_threat["miss_km"],
            "relative_velocity_kms": rel_vel,
            "time_to_closest_approach_sec": tca,
            "collision_probability": pc,
            "pareto_tradespace": tradespace
        }
        return self.active_conjunction

    def execute_evasive_burn(self, strategy_id: str, target_id: str) -> Dict[str, Any]:
        if not self.active_conjunction:
            return {"status": "NO_ACTIVE_HAZARD"}

        target = next((a for a in self.assets if a["id"] == target_id), self.assets[0])
        tradespace = self.active_conjunction["pareto_tradespace"]
        plan = next((p for p in tradespace if p["strategy"] == strategy_id), tradespace[1])

        pre_burn_track = self.compute_orbital_track(target["id"])
        burn_point = [target["lat"], target["lon"], target["alt_km"]]

        # Apply Tsiolkovsky mass penalty
        cost_g = plan["propellant_penalty_g"]
        target["fuel_g"] = max(0.0, round(target["fuel_g"] - cost_g, 2))
        target["velocity_kms"] += (plan["delta_v_ms"] / 1000.0)

        # High-contrast separation steps
        if plan["strategy"] == "RADIAL_LOW":
            phase_deg = 0.65                  # ~72 km separation
            alt_delta = plan["delta_alt_km"]  # 12 km
        elif plan["strategy"] == "IN_TRACK_NOMINAL":
            phase_deg = 1.65                  # ~180 km separation
            alt_delta = plan["delta_alt_km"]  # 42 km
        else: # DISPERSION_MAX
            phase_deg = 3.20                  # ~355 km separation
            alt_delta = plan["delta_alt_km"]  # 95 km

        target["mean_anomaly_deg"] = (target["mean_anomaly_deg"] + phase_deg) % 360.0
        target["alt_km"] = round(target["alt_km"] + alt_delta, 2)
        target["inc_deg"] = round(target["inc_deg"] + (0.25 if plan["strategy"] == "RADIAL_LOW" else 0.65), 2)
        self._update_lat_lon(target)

        # Clear active interceptor out of encounter zone
        self.simulated_interceptor = None

        post_burn_track = self.compute_orbital_track(target["id"])
        threat_id = self.active_conjunction["threat_object"]
        miss_dist = self.active_conjunction["miss_distance_km"]
        pc_val = self.active_conjunction["collision_probability"]

        burn_id = f"BURN-{int(datetime.now().timestamp())}"
        separation_actual_km = round(phase_deg * 111.0, 1)

        self.trajectory_history = {
            "burn_id": burn_id,
            "asset_id": target["id"],
            "burn_position": burn_point,
            "pre_burn_track": pre_burn_track,
            "post_burn_track": post_burn_track,
            "delta_v_applied_ms": plan["delta_v_ms"],
            "delta_alt_km": alt_delta,
            "separation_km": separation_actual_km,
            "strategy": plan["label"],
            "timestamp": datetime.now(timezone.utc).isoformat()
        }

        result = {
            "burn_id": burn_id,
            "status": "BURN_EXECUTED",
            "asset_id": target["id"],
            "threat_id": threat_id,
            "miss_distance_km": miss_dist,
            "collision_probability": pc_val,
            "strategy": plan["label"],
            "applied_dv_ms": plan["delta_v_ms"],
            "fuel_consumed_g": cost_g,
            "remaining_fuel_g": target["fuel_g"],
            "projected_clearance_km": plan["target_clearance_km"],
            "separation_km": separation_actual_km,
            "delta_alt_km": alt_delta,
            "timestamp": datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
        }

        self.conjunction_history.insert(0, result)
        if len(self.conjunction_history) > 20:
            self.conjunction_history.pop()

        self.executed_burn_log = result
        self.active_conjunction = None
        return result

    def set_autonomous_agent(self, enabled: bool) -> Dict[str, Any]:
        self.autonomous_agent_enabled = enabled
        return {"status": "SUCCESS", "autonomous_agent_enabled": self.autonomous_agent_enabled}

    def reset_threat(self):
        self.active_conjunction = None
        self.executed_burn_log = None
        self.trajectory_history = None
        self.simulated_interceptor = None
        return {"status": "RESET_COMPLETE"}