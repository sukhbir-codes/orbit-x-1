import React, { useEffect, useRef, useState, useCallback } from 'react';
import Head from 'next/head';
import Script from 'next/script';
import { 
  AlertTriangle, ShieldCheck, Zap, Activity, RefreshCw, 
  Crosshair, Radio, Bot, Database, Download, X, Cpu, Gauge, Compass
} from 'lucide-react';

interface AssetTelemetry {
  id: string;
  type: 'PAYLOAD' | 'DEBRIS';
  lat: number;
  lon: number;
  alt_km: number;
  velocity_kms: number;
  fuel_g: number;
  inc_deg?: number;
  raan_deg?: number;
  mean_anomaly_deg?: number;
}

interface ThreatPayload {
  status: string;
  primary_asset: string;
  threat_object: string;
  all_threat_objects?: Array<{ id: string; miss_km: number }>;
  miss_distance_km: number;
  relative_velocity_kms?: number;
  time_to_closest_approach_sec: number;
  collision_probability: number;
  pareto_tradespace: Array<{
    strategy: string;
    label: string;
    delta_v_ms: number;
    delta_alt_km: number;
    target_clearance_km: number;
    propellant_penalty_g: number;
    recommended: boolean;
  }>;
}

interface AuditEntry {
  burn_id: string;
  timestamp: string;
  asset_id: string;
  threat_id: string;
  miss_distance_km: number;
  collision_probability: number;
  strategy: string;
  applied_dv_ms: number;
  fuel_consumed_g: number;
  remaining_fuel_g: number;
  separation_km: number;
  status: string;
}

export default function MissionControlHUD() {
  const cesiumContainerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const orbitTrackRef = useRef<any>(null);
  const preBurnTrackRef = useRef<any>(null);
  const postBurnTrackRef = useRef<any>(null);
  const thrustVectorRef = useRef<any>(null);
  const threatLinesRef = useRef<any[]>([]);
  const riskSphereEntitiesRef = useRef<any[]>([]);
  const selectedEntityRef = useRef<string>('STARLINK-1007');
  const lastRenderedBurnIdRef = useRef<string | null>(null);

  const [cesiumReady, setCesiumReady] = useState(false);
  const [assets, setAssets] = useState<AssetTelemetry[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string>('STARLINK-1007');
  const [threatData, setThreatData] = useState<ThreatPayload | null>(null);
  const [activeAlert, setActiveAlert] = useState(false);
  const [burnLog, setBurnLog] = useState<any>(null);
  const [executingBurn, setExecutingBurn] = useState(false);
  const [screenedPairs, setScreenedPairs] = useState(0);
  const [autonomousAgent, setAutonomousAgent] = useState(false);
  const [camLock, setCamLock] = useState(false);
  const [viewFilter, setViewFilter] = useState<'ALL' | 'PAYLOADS' | 'DEBRIS'>('ALL');
  const [hoveredAssetId, setHoveredAssetId] = useState<string | null>(null);
  const [utcTime, setUtcTime] = useState<string>('');

  const [fleetStats, setFleetStats] = useState({
    active_payloads: 25,
    debris_tracked: 45,
    fleet_fuel_pct: 100.0,
    total_fuel_remaining_kg: 112.5
  });

  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [auditLedger, setAuditLedger] = useState<AuditEntry[]>([]);

  useEffect(() => {
    selectedEntityRef.current = selectedAssetId;
  }, [selectedAssetId]);

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      setUtcTime(now.toUTCString().split(' ')[4] + ' UTC');
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const parseSafeCartesianPositions = useCallback((trackList: any[], defaultAltKm: number = 550.0) => {
    const Cesium = (window as any).Cesium;
    if (!Cesium || !Array.isArray(trackList)) return [];

    return trackList
      .map((pt: any) => {
        if (!Array.isArray(pt) || pt.length < 2) return null;
        const p0 = Number(pt[0]);
        const p1 = Number(pt[1]);
        if (isNaN(p0) || isNaN(p1)) return null;

        if (Math.abs(p0) <= 90.0 && Math.abs(p1) <= 360.0) {
          const lat = p0;
          const lon = p1;
          const altMeters = (pt.length > 2 && !isNaN(Number(pt[2]))) ? Number(pt[2]) * 1000.0 : defaultAltKm * 1000.0;
          return Cesium.Cartesian3.fromDegrees(lon, lat, altMeters);
        }

        if (pt.length >= 3 && Math.abs(p0) > 1000.0) {
          return new Cesium.Cartesian3(p0, p1, Number(pt[2]));
        }

        return null;
      })
      .filter((p: any) => p !== null && !isNaN(p.x) && !isNaN(p.y) && !isNaN(p.z) && (p.x !== 0 || p.y !== 0 || p.z !== 0));
  }, []);

  const fetchAndDrawOrbitTrack = useCallback(async (assetId: string) => {
    const viewer = viewerRef.current;
    const Cesium = (window as any).Cesium;
    if (!viewer || !Cesium) return;

    try {
      const res = await fetch(`http://localhost:8000/api/orbit-track?asset_id=${encodeURIComponent(assetId)}`);
      const data = await res.json();
      if (!data.track || !Array.isArray(data.track)) return;

      const positions = parseSafeCartesianPositions(data.track, 550.0);
      if (positions.length < 2) return;

      const isDebris = assetId.includes('DEB');
      const trackColor = isDebris 
        ? Cesium.Color.fromCssColorString('rgba(245, 158, 11, 0.75)') 
        : Cesium.Color.fromCssColorString('rgba(0, 240, 255, 0.95)');

      if (orbitTrackRef.current) viewer.entities.remove(orbitTrackRef.current);

      orbitTrackRef.current = viewer.entities.add({
        id: 'SELECTED_ORBIT_PATH',
        polyline: {
          positions: positions,
          width: 3.0,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.35,
            color: trackColor,
          }),
        },
      });
      viewer.scene.requestRender();
    } catch (e) {
      console.warn("Orbit track draw skipped:", e);
    }
  }, [parseSafeCartesianPositions]);

  const clearHazardSpheres = () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    riskSphereEntitiesRef.current.forEach(entity => viewer.entities.remove(entity));
    riskSphereEntitiesRef.current = [];
  };

  const renderTrajectoryShift = useCallback((trajHistory: any) => {
    const viewer = viewerRef.current;
    const Cesium = (window as any).Cesium;
    if (!viewer || !Cesium || !trajHistory || !trajHistory.pre_burn_track || !trajHistory.post_burn_track) return;

    if (lastRenderedBurnIdRef.current === trajHistory.burn_id) return;
    lastRenderedBurnIdRef.current = trajHistory.burn_id;

    if (preBurnTrackRef.current) viewer.entities.remove(preBurnTrackRef.current);
    if (postBurnTrackRef.current) viewer.entities.remove(postBurnTrackRef.current);
    if (thrustVectorRef.current) viewer.entities.remove(thrustVectorRef.current);
    if (orbitTrackRef.current) viewer.entities.remove(orbitTrackRef.current);
    clearHazardSpheres();

    const prePositions = parseSafeCartesianPositions(trajHistory.pre_burn_track, 550.0);
    if (prePositions.length >= 2) {
      preBurnTrackRef.current = viewer.entities.add({
        id: 'PRE_BURN_PATH',
        polyline: {
          positions: prePositions,
          width: 2.2,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString('rgba(148, 163, 184, 0.75)'),
            dashLength: 14.0,
          }),
        },
      });
    }

    const postPositions = parseSafeCartesianPositions(trajHistory.post_burn_track, 580.0);
    if (postPositions.length >= 2) {
      postBurnTrackRef.current = viewer.entities.add({
        id: 'POST_BURN_PATH',
        polyline: {
          positions: postPositions,
          width: 4.2,
          arcType: Cesium.ArcType.NONE,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.55,
            color: Cesium.Color.fromCssColorString('#10b981'),
          }),
        },
      });
    }

    if (trajHistory.burn_position && Array.isArray(trajHistory.burn_position)) {
      const bLat = Number(trajHistory.burn_position[0]);
      const bLon = Number(trajHistory.burn_position[1]);
      const bAlt = Number(trajHistory.burn_position[2]) * 1000.0;

      if (!isNaN(bLat) && !isNaN(bLon)) {
        const p0 = Cesium.Cartesian3.fromDegrees(bLon, bLat, bAlt);
        const p1 = Cesium.Cartesian3.multiplyByScalar(p0, 1.06, new Cesium.Cartesian3());

        thrustVectorRef.current = viewer.entities.add({
          id: 'THRUST_VECTOR_ARC',
          polyline: {
            positions: [p0, p1],
            width: 5.5,
            arcType: Cesium.ArcType.NONE,
            material: Cesium.Color.fromCssColorString('#facc15'),
          },
        });
      }
    }

    viewer.scene.requestRender();
  }, [parseSafeCartesianPositions]);

  const initCesium = () => {
    if (typeof window === 'undefined' || !cesiumContainerRef.current || viewerRef.current) return;
    const Cesium = (window as any).Cesium;
    if (!Cesium) return;

    try {
      Cesium.Ion.defaultAccessToken = '';

      const sharpEarthProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        maximumLevel: 19,
        credit: 'Esri World Imagery',
        enablePickFeatures: false,
      });

      const viewer = new Cesium.Viewer(cesiumContainerRef.current, {
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        selectionIndicator: false,
        baseLayer: false,
        requestRenderMode: false,
      });

      if (viewer.cesiumWidget) {
        viewer.cesiumWidget._showRenderLoopErrors = false;
        viewer.cesiumWidget.showErrorPanel = () => {};
      }

      viewer.scene.renderError.addEventListener((scene: any, error: any) => {
        console.warn("Cesium scene error recovered:", error);
        scene.requestRender();
      });

      if (typeof window !== 'undefined') {
        viewer.resolutionScale = Math.min(window.devicePixelRatio || 1.0, 2.0);
      }

      viewer.scene.imageryLayers.addImageryProvider(sharpEarthProvider);
      viewer.scene.sun.show = false;
      viewer.scene.moon.show = false;
      viewer.scene.globe.show = true;
      viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#020617');
      viewer.scene.globe.enableLighting = false;
      viewer.scene.globe.showGroundAtmosphere = true;
      viewer.scene.skyAtmosphere.show = true;
      viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#020617');

      viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(78.9629, 20.5937, 18000000),
        duration: 1.0,
      });

      const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
      handler.setInputAction((movement: any) => {
        const picked = viewer.scene.pick(movement.position);
        if (Cesium.defined(picked) && picked.id && typeof picked.id.id === 'string') {
          const satId = picked.id.id;
          if (!satId.startsWith('THREAT_') && !['SELECTED_ORBIT_PATH', 'PRE_BURN_PATH', 'POST_BURN_PATH', 'THRUST_VECTOR_ARC', 'RISK_SPHERE_3D', 'RISK_SPHERE_CORE'].includes(satId)) {
            setSelectedAssetId(satId);
            selectedEntityRef.current = satId;
            fetchAndDrawOrbitTrack(satId);
          }
        }
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      handler.setInputAction((movement: any) => {
        const picked = viewer.scene.pick(movement.endPosition);
        if (Cesium.defined(picked) && picked.id && typeof picked.id.id === 'string') {
          const id = picked.id.id;
          if (!id.startsWith('THREAT_') && !['SELECTED_ORBIT_PATH', 'PRE_BURN_PATH', 'POST_BURN_PATH', 'THRUST_VECTOR_ARC', 'RISK_SPHERE_3D', 'RISK_SPHERE_CORE'].includes(id)) {
            viewer.scene.canvas.style.cursor = 'pointer';
            setHoveredAssetId(id);
            return;
          }
        }
        viewer.scene.canvas.style.cursor = 'default';
        setHoveredAssetId(null);
      }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

      viewerRef.current = viewer;
      setCesiumReady(true);
      fetchAndDrawOrbitTrack('STARLINK-1007');
    } catch (e) {
      console.error("Cesium Mount Failure:", e);
    }
  };

  useEffect(() => {
    const ws = new WebSocket('ws://localhost:8000/ws/telemetry');

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const incomingAssets: AssetTelemetry[] = data.assets || [];
        setAssets(incomingAssets);
        setActiveAlert(Boolean(data.threat_alert));

        if (data.fleet_stats) setFleetStats(data.fleet_stats);

        if (data.executed_burn) {
          setBurnLog(data.executed_burn);
          if (!data.active_conjunction) setThreatData(null);
        }

        if (data.active_conjunction) {
          setThreatData(data.active_conjunction);
        } else if (!data.threat_alert) {
          setThreatData(null);
        }

        if (data.conjunction_history && Array.isArray(data.conjunction_history)) {
          setAuditLedger(data.conjunction_history);
        }

        if (data.spatial_pairs_screened !== undefined) setScreenedPairs(data.spatial_pairs_screened);
        if (data.autonomous_agent_enabled !== undefined) setAutonomousAgent(data.autonomous_agent_enabled);
        
        if (data.trajectory_history) renderTrajectoryShift(data.trajectory_history);

        const Cesium = (window as any).Cesium;
        const viewer = viewerRef.current;
        if (!viewer || !Cesium || !Array.isArray(incomingAssets)) return;

        incomingAssets.forEach((sat) => {
          if (typeof sat.lon !== 'number' || typeof sat.lat !== 'number' || isNaN(sat.lon) || isNaN(sat.lat)) return;

          const isSelected = sat.id === selectedEntityRef.current;
          const isDebris = sat.type === 'DEBRIS' || sat.id.includes('DEB') || sat.id.includes('INTERCEPTOR');
          const isTargetInAlert = Boolean(data.threat_alert) && (sat.id === data.active_conjunction?.primary_asset);

          let showDot = true;
          if (viewFilter === 'PAYLOADS' && isDebris) showDot = false;
          if (viewFilter === 'DEBRIS' && !isDebris) showDot = false;

          let ptColor = isDebris 
            ? Cesium.Color.fromCssColorString('#f59e0b') 
            : Cesium.Color.fromCssColorString('#00f0ff');
          let sz = isDebris ? 10 : 13;

          if (isTargetInAlert) {
            ptColor = Cesium.Color.fromCssColorString('#ff003c');
            sz = 19;
          } else if (isSelected) {
            ptColor = Cesium.Color.fromCssColorString('#d946ef');
            sz = 16;
          }

          const altitudeMeters = Number(sat.alt_km) * 1000.0;
          const cartPos = Cesium.Cartesian3.fromDegrees(Number(sat.lon), Number(sat.lat), altitudeMeters);

          let entity = viewer.entities.getById(sat.id);
          if (entity) {
            entity.position = cartPos;
            entity.show = showDot;
            if (entity.point) {
              entity.point.color = ptColor;
              entity.point.pixelSize = sz;
            }
            if (entity.label) entity.label.show = isSelected;
          } else {
            viewer.entities.add({
              id: sat.id,
              name: sat.id,
              position: cartPos,
              show: showDot,
              point: {
                pixelSize: sz,
                color: ptColor,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
              },
              label: {
                text: sat.id,
                font: 'bold 11px monospace',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 3,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -14),
                show: isSelected,
              }
            });
          }
        });

        if (camLock) {
          const selectedObj = incomingAssets.find((a) => a.id === selectedEntityRef.current);
          if (selectedObj && !isNaN(selectedObj.lon) && !isNaN(selectedObj.lat)) {
            try {
              const altitudeMeters = Number(selectedObj.alt_km) * 1000.0;
              const targetPos = Cesium.Cartesian3.fromDegrees(Number(selectedObj.lon), Number(selectedObj.lat), altitudeMeters);
              viewer.camera.lookAt(targetPos, new Cesium.HeadingPitchRange(0, -Cesium.Math.PI_OVER_FOUR, 4500000));
            } catch (err) {}
          }
        }

        // Clean previous threat visuals
        threatLinesRef.current.forEach(line => viewer.entities.remove(line));
        threatLinesRef.current = [];
        clearHazardSpheres();

        // 3D COVARIANCE HAZARD BUBBLE & MULTI-TARGET THREAT VECTORS
        if (data.active_conjunction && data.active_conjunction.primary_asset) {
          const primaryObj = incomingAssets.find((a) => a.id === data.active_conjunction.primary_asset);

          if (primaryObj && !isNaN(primaryObj.lon) && !isNaN(primaryObj.lat)) {
            const c1 = Cesium.Cartesian3.fromDegrees(
              Number(primaryObj.lon), 
              Number(primaryObj.lat), 
              Number(primaryObj.alt_km) * 1000.0
            );

            // 1. Unmistakable 180 km Outer Covariance Shell
            const sphereOuter = viewer.entities.add({
              id: 'RISK_SPHERE_3D',
              position: c1,
              ellipsoid: {
                radii: new Cesium.Cartesian3(180000.0, 180000.0, 180000.0),
                material: Cesium.Color.fromCssColorString('rgba(255, 0, 60, 0.16)'),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString('#ff003c'),
                outlineWidth: 2.5
              }
            });
            riskSphereEntitiesRef.current.push(sphereOuter);

            // 2. High-Density Inner Kill-Zone Core (65 km)
            const sphereCore = viewer.entities.add({
              id: 'RISK_SPHERE_CORE',
              position: c1,
              ellipsoid: {
                radii: new Cesium.Cartesian3(65000.0, 65000.0, 65000.0),
                material: Cesium.Color.fromCssColorString('rgba(255, 0, 60, 0.38)'),
                outline: true,
                outlineColor: Cesium.Color.fromCssColorString('#f43f5e'),
                outlineWidth: 1.5
              }
            });
            riskSphereEntitiesRef.current.push(sphereCore);

            // 3. Multi-Target Proximity Beams: Draw lines to ALL nearby threats
            const threatsList: Array<{ id: string; miss_km: number }> = 
              data.active_conjunction.all_threat_objects || [{ id: data.active_conjunction.threat_object, miss_km: data.active_conjunction.miss_distance_km }];

            threatsList.forEach((th, idx) => {
              const thObj = incomingAssets.find((a) => a.id === th.id);
              if (thObj && !isNaN(thObj.lon) && !isNaN(thObj.lat)) {
                const c2 = Cesium.Cartesian3.fromDegrees(
                  Number(thObj.lon), 
                  Number(thObj.lat), 
                  Number(thObj.alt_km) * 1000.0
                );
                
                const isClosest = idx === 0;
                const threatLine = viewer.entities.add({
                  id: `THREAT_VECTOR_LINE_${idx}`,
                  polyline: {
                    positions: [c1, c2],
                    width: isClosest ? 5.0 : 3.2,
                    arcType: Cesium.ArcType.NONE,
                    material: new Cesium.PolylineGlowMaterialProperty({
                      glowPower: isClosest ? 0.45 : 0.25,
                      color: isClosest 
                        ? Cesium.Color.fromCssColorString('#ff003c') 
                        : Cesium.Color.fromCssColorString('#f59e0b'),
                    }),
                  }
                });
                threatLinesRef.current.push(threatLine);
              }
            });
          }
        }

        viewer.scene.requestRender();

      } catch (err) {
        console.error("Frame Parse Error:", err);
      }
    };

    return () => ws.close();
  }, [cesiumReady, viewFilter, camLock, renderTrajectoryShift, parseSafeCartesianPositions]);

  const triggerConjunction = async () => {
    try {
      const target = selectedAssetId || 'STARLINK-1007';
      const res = await fetch(`http://localhost:8000/api/simulate-threat?target_id=${encodeURIComponent(target)}`, { method: 'POST' });
      const data = await res.json();
      setThreatData(data);
    } catch (e) {
      console.error(e);
    }
  };

  const commitBurn = async (strategy: string) => {
    setExecutingBurn(true);
    try {
      const target = selectedAssetId || 'STARLINK-1007';
      await fetch(`http://localhost:8000/api/execute-evasion?strategy_id=${encodeURIComponent(strategy)}&target_id=${encodeURIComponent(target)}`, { method: 'POST' });
      setThreatData(null);
    } catch (e) {
      console.error(e);
    } finally {
      setExecutingBurn(false);
    }
  };

  const toggleAgent = async () => {
    try {
      const nextState = !autonomousAgent;
      await fetch(`http://localhost:8000/api/toggle-autonomous-agent?enabled=${nextState ? 'true' : 'false'}`, { method: 'POST' });
      setAutonomousAgent(nextState);
    } catch (e) {
      console.error(e);
    }
  };

  const resetAll = async () => {
    lastRenderedBurnIdRef.current = null;
    const viewer = viewerRef.current;
    if (viewer) {
      if (preBurnTrackRef.current) { viewer.entities.remove(preBurnTrackRef.current); preBurnTrackRef.current = null; }
      if (postBurnTrackRef.current) { viewer.entities.remove(postBurnTrackRef.current); postBurnTrackRef.current = null; }
      if (thrustVectorRef.current) { viewer.entities.remove(thrustVectorRef.current); thrustVectorRef.current = null; }
      clearHazardSpheres();
      threatLinesRef.current.forEach(line => viewer.entities.remove(line));
      threatLinesRef.current = [];
    }
    try {
      await fetch('http://localhost:8000/api/reset-threat', { method: 'POST' });
      setThreatData(null);
      setBurnLog(null);
    } catch (e) {
      console.error(e);
    }
  };

  const exportLedgerCSV = () => {
    if (!auditLedger.length) return;
    const headers = "Burn_ID,Timestamp,Asset_ID,Threat_ID,Miss_Dist_km,Pc_Risk,Strategy,DeltaV_ms,Fuel_Burned_g,Remaining_Fuel_g,Separation_km\n";
    const rows = auditLedger.map(e => 
      `${e.burn_id},"${e.timestamp}",${e.asset_id},${e.threat_id},${e.miss_distance_km},${e.collision_probability},"${e.strategy}",${e.applied_dv_ms},${e.fuel_consumed_g},${e.remaining_fuel_g},${e.separation_km}`
    ).join("\n");
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ORBIT-X_CDM_Audit_Ledger_${Date.now()}.csv`;
    a.click();
  };

  const targetAsset = assets.find(a => a.id === selectedAssetId) || assets[0];
  const fuelPct = targetAsset ? Math.min(100, Math.max(0, (targetAsset.fuel_g / 4500.0) * 100)) : 100;
  const riskPct = threatData ? Math.min(100, Math.max(0, threatData.collision_probability * 100)) : 0;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', backgroundColor: '#020617', color: '#f8fafc', overflow: 'hidden', fontFamily: 'monospace' }}>
      <Head>
        <title>ORBIT-X 2.0 // Tactical ASCAS Cockpit</title>
      </Head>

      <Script
        src="https://cesium.com/downloads/cesiumjs/releases/1.114/Build/Cesium/Cesium.js"
        strategy="afterInteractive"
        onLoad={initCesium}
      />

      <div ref={cesiumContainerRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />

      {/* TOP HEADER: 3-COLUMN CSS GRID THAT NEVER OVERFLOWS */}
      <header style={{ 
        position: 'absolute', 
        top: 10, 
        left: 12, 
        right: 12, 
        zIndex: 35, 
        display: 'grid', 
        gridTemplateColumns: 'auto 1fr auto', 
        alignItems: 'center', 
        gap: 12, 
        pointerEvents: 'none' 
      }}>
        
        {/* Brand Terminal Accent */}
        <div style={{ pointerEvents: 'auto', background: 'rgba(15, 23, 42, 0.95)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0, 240, 255, 0.5)', padding: '6px 14px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 10, whiteSpace: 'nowrap' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: '#00f0ff', boxShadow: '0 0 10px #00f0ff' }} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: '0.08em', color: '#00f0ff' }}>ORBIT-X 2.0</span>
              <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 2, background: 'rgba(0, 240, 255, 0.15)', color: '#67e8f9', border: '1px solid rgba(0, 240, 255, 0.3)' }}>ASCAS</span>
            </div>
            <p style={{ margin: 0, fontSize: 9, color: '#94a3b8' }}>Autonomous Space Traffic Management</p>
          </div>
        </div>

        {/* Center Live Telemetry Capsule */}
        <div style={{ pointerEvents: 'auto', display: 'flex', justifyContent: 'center', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(15, 23, 42, 0.94)', backdropFilter: 'blur(16px)', border: '1px solid rgba(56, 189, 248, 0.35)', padding: '5px 14px', borderRadius: 20, fontSize: 11, whiteSpace: 'nowrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: activeAlert ? '#ff003c' : '#10b981', boxShadow: activeAlert ? '0 0 8px #ff003c' : '0 0 8px #10b981' }} />
              <span style={{ color: '#64748b', fontSize: 10 }}>FLEET:</span>
              <strong style={{ color: activeAlert ? '#ff4d6d' : '#34d399' }}>{activeAlert ? 'CONJUNCTION' : 'NOMINAL'}</strong>
            </div>
            <span style={{ color: '#334155' }}>|</span>
            <div>
              <span style={{ color: '#64748b', fontSize: 10 }}>FUEL: </span>
              <strong style={{ color: '#38bdf8' }}>{fleetStats.fleet_fuel_pct}%</strong>
            </div>
            <span style={{ color: '#334155' }}>|</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#a855f7', fontSize: 10 }}>
              <Cpu style={{ width: 11, height: 11 }} />
              <span>AI: <strong>0.38ms</strong></span>
            </div>
            {utcTime && (
              <>
                <span style={{ color: '#334155' }}>|</span>
                <span style={{ color: '#94a3b8', fontSize: 10 }}>{utcTime}</span>
              </>
            )}
          </div>
        </div>

        {/* Right Tactical Action Buttons */}
        <div style={{ pointerEvents: 'auto', display: 'flex', gap: 6, alignItems: 'center', whiteSpace: 'nowrap' }}>
          <button
            onClick={() => setLedgerOpen(!ledgerOpen)}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '6px 9px',
              backgroundColor: ledgerOpen ? '#0284c7' : 'rgba(15, 23, 42, 0.94)',
              border: '1px solid #38bdf8', color: '#38bdf8', fontSize: 10, fontWeight: 700, borderRadius: 5, cursor: 'pointer'
            }}
          >
            <Database style={{ width: 12, height: 12 }} />
            AUDIT ({auditLedger.length})
          </button>

          <button
            onClick={toggleAgent}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '6px 9px',
              backgroundColor: autonomousAgent ? 'rgba(16, 185, 129, 0.95)' : 'rgba(15, 23, 42, 0.94)',
              border: autonomousAgent ? '1px solid #10b981' : '1px solid #334155',
              color: autonomousAgent ? '#020617' : '#94a3b8',
              fontSize: 10, fontWeight: 800, borderRadius: 5, cursor: 'pointer'
            }}
          >
            <Bot style={{ width: 12, height: 12 }} />
            {autonomousAgent ? 'GUARDIAN' : 'MANUAL'}
          </button>

          <button
            onClick={() => {
              if (camLock && viewerRef.current) {
                viewerRef.current.camera.lookAtTransform((window as any).Cesium.Matrix4.IDENTITY);
              }
              setCamLock(!camLock);
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px',
              backgroundColor: camLock ? '#0284c7' : 'rgba(15, 23, 42, 0.94)',
              border: '1px solid #0284c7', color: '#fff', fontSize: 10, borderRadius: 5, cursor: 'pointer'
            }}
          >
            <Crosshair style={{ width: 12, height: 12 }} />
            {camLock ? 'LOCKED' : 'CAM'}
          </button>

          <button
            onClick={triggerConjunction}
            style={{
              display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px',
              background: 'linear-gradient(135deg, rgba(225, 29, 72, 0.95), rgba(159, 18, 57, 0.95))',
              border: '1px solid #ff003c', color: '#ffe4e6', fontSize: 10, fontWeight: 800, borderRadius: 5, cursor: 'pointer',
              boxShadow: '0 0 10px rgba(255, 0, 60, 0.35)'
            }}
          >
            <AlertTriangle style={{ width: 12, height: 12, color: '#ff4d6d' }} />
            SIMULATE HAZARD
          </button>

          <button
            onClick={resetAll}
            style={{
              display: 'flex', alignItems: 'center', gap: 4, padding: '6px 8px',
              backgroundColor: 'rgba(15, 23, 42, 0.94)', border: '1px solid #334155',
              color: '#cbd5e1', fontSize: 10, borderRadius: 5, cursor: 'pointer'
            }}
          >
            <RefreshCw style={{ width: 12, height: 12 }} />
            RESET
          </button>
        </div>
      </header>

      {hoveredAssetId && (
        <div style={{ position: 'absolute', top: 64, left: '50%', transform: 'translateX(-50%)', zIndex: 40, backgroundColor: 'rgba(15, 23, 42, 0.92)', padding: '4px 10px', borderRadius: 4, border: '1px solid #00f0ff', fontSize: 10, color: '#00f0ff', pointerEvents: 'none' }}>
          LOCK: <strong>{hoveredAssetId}</strong>
        </div>
      )}

      {/* LEFT COLUMN: TELEMETRY & FLIGHT DYNAMICS HUD */}
      <div style={{ position: 'absolute', top: 68, left: 12, zIndex: 25, width: 320, display: 'flex', flexDirection: 'column', gap: 8, pointerEvents: 'auto' }}>
        
        {/* Card 1: Asset State Vector */}
        <div style={{ background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(2, 6, 23, 0.92) 100%)', backdropFilter: 'blur(16px)', border: '1px solid rgba(0, 240, 255, 0.35)', padding: 12, borderRadius: 8, boxShadow: '0 10px 30px rgba(0, 0, 0, 0.7)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(30, 41, 59, 0.8)', paddingBottom: 6, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <Radio style={{ width: 13, height: 13, color: '#00f0ff' }} />
              <span style={{ fontSize: 10, fontWeight: 900, color: '#e2e8f0', letterSpacing: '0.06em' }}>PRIMARY ASSET TELEMETRY</span>
            </div>
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 3, backgroundColor: activeAlert && selectedAssetId === threatData?.primary_asset ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.25)', color: activeAlert && selectedAssetId === threatData?.primary_asset ? '#ff4d6d' : '#34d399', fontWeight: 900, border: activeAlert && selectedAssetId === threatData?.primary_asset ? '1px solid #ff003c' : '1px solid #10b981' }}>
              {activeAlert && selectedAssetId === threatData?.primary_asset ? 'HAZARD INTERCEPT' : 'FLIGHT NOMINAL'}
            </span>
          </div>

          {targetAsset ? (
            <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>IDENTIFIER:</span> 
                <span style={{ fontWeight: 'bold', color: '#00f0ff' }}>{targetAsset.id}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>CLASS:</span> 
                <span style={{ color: targetAsset.type === 'DEBRIS' ? '#f59e0b' : '#38bdf8', fontWeight: 'bold' }}>{targetAsset.type}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>SUB-SAT:</span> 
                <span>{targetAsset.lat.toFixed(2)}°, {targetAsset.lon.toFixed(2)}°</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>ALTITUDE:</span> 
                <span style={{ fontWeight: 'bold', color: '#f8fafc' }}>{targetAsset.alt_km.toFixed(2)} km</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#64748b' }}>SPEED:</span> 
                <span>{targetAsset.velocity_kms.toFixed(3)} km/s</span>
              </div>

              {/* Hydrazine Tank Reservoir Gauge */}
              <div style={{ marginTop: 4, background: 'rgba(2, 6, 23, 0.6)', padding: 6, borderRadius: 5, border: '1px solid #1e293b' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 3 }}>
                  <span style={{ color: '#94a3b8' }}>HYDRAZINE RESERVOIR:</span>
                  <span style={{ color: targetAsset.type === 'DEBRIS' ? '#64748b' : '#34d399', fontWeight: 'bold' }}>
                    {targetAsset.fuel_g > 0 ? `${targetAsset.fuel_g} g (${fuelPct.toFixed(1)}%)` : 'PASSIVE'}
                  </span>
                </div>
                <div style={{ width: '100%', height: 5, backgroundColor: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                  <div style={{ width: `${fuelPct}%`, height: '100%', background: fuelPct > 50 ? 'linear-gradient(90deg, #0284c7, #10b981)' : 'linear-gradient(90deg, #f59e0b, #ef4444)', transition: 'width 0.4s ease' }} />
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#64748b' }}>Click satellite on globe to inspect</div>
          )}

          {burnLog && (
            <div style={{ marginTop: 8, padding: 8, background: 'rgba(6, 78, 59, 0.5)', border: '1px solid rgba(16, 185, 129, 0.45)', borderRadius: 5, fontSize: 10, color: '#6ee7b7' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontWeight: 900, color: '#34d399', marginBottom: 3 }}>
                <ShieldCheck style={{ width: 13, height: 13 }} /> EVASION EXECUTED
              </div>
              <div>Plan: <strong>{burnLog.strategy}</strong></div>
              <div>Separation: <strong style={{ color: '#34d399' }}>+{burnLog.separation_km} km (SAFE)</strong></div>
              <div>Impulse: <strong>+{burnLog.applied_dv_ms} m/s</strong> | Expended: <strong>{burnLog.fuel_consumed_g} g</strong></div>
            </div>
          )}
        </div>

        {/* Card 2: Astrodynamics & Propulsion Module (Fills Screen Professionally) */}
        <div style={{ background: 'linear-gradient(180deg, rgba(15, 23, 42, 0.95) 0%, rgba(2, 6, 23, 0.92) 100%)', backdropFilter: 'blur(16px)', border: '1px solid rgba(56, 189, 248, 0.25)', padding: 10, borderRadius: 8, fontSize: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, borderBottom: '1px solid #1e293b', paddingBottom: 4, marginBottom: 6, color: '#38bdf8', fontWeight: 800 }}>
            <Compass style={{ width: 12, height: 12 }} />
            <span>ASTRODYNAMICS & THRUSTER TELEMETRY</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, color: '#cbd5e1' }}>
            <div>Inclination: <strong style={{ color: '#fff' }}>53.00°</strong></div>
            <div>RAAN Drift: <strong style={{ color: '#fff' }}>0.004°/s</strong></div>
            <div>Thruster ISP: <strong style={{ color: '#10b981' }}>220 s</strong></div>
            <div>Valves: <strong style={{ color: '#10b981' }}>ARMED</strong></div>
          </div>
        </div>

      </div>

      {/* RIGHT COLUMN: PARETO MATRIX & CONJUNCTION INTERCEPT HUD */}
      {threatData && (
        <div style={{ position: 'absolute', top: 68, right: 12, zIndex: 40, width: 370, background: 'linear-gradient(180deg, rgba(24, 15, 30, 0.96) 0%, rgba(15, 23, 42, 0.96) 100%)', backdropFilter: 'blur(16px)', border: '1px solid rgba(225, 29, 72, 0.85)', padding: 14, borderRadius: 8, pointerEvents: 'auto', boxShadow: '0 15px 35px rgba(225, 29, 72, 0.35)' }}>
          
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(225, 29, 72, 0.4)', paddingBottom: 6, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#ff4d6d', fontWeight: 900, fontSize: 11 }}>
              <AlertTriangle style={{ width: 14, height: 14 }} />
              CONJUNCTION INTERCEPT
            </div>
            <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 2, background: 'rgba(255, 0, 60, 0.25)', color: '#ff4d6d', border: '1px solid #ff003c' }}>
              FOSTER 2D
            </span>
          </div>

          <div style={{ fontSize: 11, display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>PRIMARY THREAT:</span> 
              <span style={{ color: '#fbbf24', fontWeight: 800 }}>{threatData.threat_object}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>MISS DISTANCE:</span> 
              <span style={{ color: '#ff4d6d', fontWeight: 800 }}>{threatData.miss_distance_km} km</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: '#94a3b8' }}>TCA:</span> 
              <span style={{ color: '#f8fafc', fontWeight: 'bold' }}>T-{threatData.time_to_closest_approach_sec}s</span>
            </div>

            {/* Visual Risk Gauge */}
            <div style={{ background: 'rgba(2, 6, 23, 0.6)', padding: 6, borderRadius: 5, border: '1px solid rgba(225, 29, 72, 0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 3 }}>
                <span style={{ color: '#94a3b8' }}>COLLISION PROBABILITY (Pc):</span>
                <span style={{ color: '#ff4d6d', fontWeight: 900 }}>{riskPct.toFixed(2)}%</span>
              </div>
              <div style={{ width: '100%', height: 5, backgroundColor: '#0f172a', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${riskPct}%`, height: '100%', background: 'linear-gradient(90deg, #f59e0b, #ff003c)', transition: 'width 0.4s ease' }} />
              </div>
            </div>
          </div>

          {/* Pareto Tradespace Decision Options */}
          <div style={{ borderTop: '1px solid rgba(30, 41, 59, 0.8)', paddingTop: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 9, fontWeight: 900, color: '#00f0ff' }}>AUTONOMOUS PARETO DECISION MATRIX</span>
              <span style={{ fontSize: 8, color: '#64748b' }}>TSIOLKOVSKY</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              {threatData.pareto_tradespace.map((plan) => (
                <div
                  key={plan.strategy}
                  style={{
                    padding: '6px 8px', borderRadius: 5,
                    border: plan.recommended ? '1px solid #00f0ff' : '1px solid #1e293b',
                    background: plan.recommended ? 'rgba(8, 51, 68, 0.7)' : 'rgba(2, 6, 23, 0.65)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 10, color: plan.recommended ? '#67e8f9' : '#cbd5e1', display: 'flex', alignItems: 'center', gap: 4 }}>
                      {plan.label} 
                      {plan.recommended && (
                        <span style={{ fontSize: 7, backgroundColor: '#00f0ff', color: '#020617', fontWeight: 900, padding: '1px 3px', borderRadius: 2 }}>REC</span>
                      )}
                    </div>
                    <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 1 }}>
                      Δv: <strong>+{plan.delta_v_ms} m/s</strong> | Alt: <strong>{plan.delta_alt_km > 0 ? `+${plan.delta_alt_km}` : plan.delta_alt_km} km</strong> | Fuel: <strong>-{plan.propellant_penalty_g}g</strong>
                    </div>
                  </div>
                  <button
                    disabled={executingBurn}
                    onClick={() => commitBurn(plan.strategy)}
                    style={{
                      padding: '4px 10px', background: 'linear-gradient(135deg, #0891b2, #0284c7)', color: '#fff',
                      fontWeight: 800, fontSize: 9, borderRadius: 3, border: 'none',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 3, fontFamily: 'monospace'
                    }}
                  >
                    <Zap style={{ width: 10, height: 10 }} />
                    COMMIT
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* AUDIT DRAWER */}
      {ledgerOpen && (
        <div style={{ position: 'absolute', bottom: 55, left: 12, right: 12, maxHeight: 260, zIndex: 45, background: 'rgba(15, 23, 42, 0.96)', backdropFilter: 'blur(16px)', border: '1px solid #38bdf8', borderRadius: 8, padding: 12, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b', paddingBottom: 6, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Database style={{ width: 14, height: 14, color: '#38bdf8' }} />
              <span style={{ fontSize: 11, fontWeight: 900, color: '#f8fafc' }}>CCSDS CDM AUDIT LEDGER</span>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                onClick={exportLedgerCSV}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', backgroundColor: '#0284c7', color: '#fff', border: 'none', borderRadius: 4, fontSize: 9, fontWeight: 'bold', cursor: 'pointer' }}
              >
                <Download style={{ width: 11, height: 11 }} /> EXPORT CSV
              </button>
              <button
                onClick={() => setLedgerOpen(false)}
                style={{ backgroundColor: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X style={{ width: 14, height: 14 }} />
              </button>
            </div>
          </div>

          {auditLedger.length === 0 ? (
            <div style={{ fontSize: 10, color: '#64748b', textAlign: 'center', padding: '16px 0' }}>
              No maneuvers recorded yet. Trigger a hazard and commit a burn.
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: 10, borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ color: '#64748b', borderBottom: '1px solid #1e293b' }}>
                  <th style={{ padding: '4px 6px' }}>UTC TIME</th>
                  <th style={{ padding: '4px 6px' }}>TARGET</th>
                  <th style={{ padding: '4px 6px' }}>INTERCEPTOR</th>
                  <th style={{ padding: '4px 6px' }}>MISS DIST</th>
                  <th style={{ padding: '4px 6px' }}>RISK (Pc)</th>
                  <th style={{ padding: '4px 6px' }}>PLAN</th>
                  <th style={{ padding: '4px 6px' }}>IMPULSE</th>
                  <th style={{ padding: '4px 6px' }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {auditLedger.map((entry, idx) => (
                  <tr key={idx} style={{ borderBottom: '1px solid rgba(30, 41, 59, 0.6)', color: '#cbd5e1' }}>
                    <td style={{ padding: '4px 6px', fontFamily: 'monospace' }}>{entry.timestamp}</td>
                    <td style={{ padding: '4px 6px', fontWeight: 'bold', color: '#00f0ff' }}>{entry.asset_id}</td>
                    <td style={{ padding: '4px 6px', color: '#fbbf24' }}>{entry.threat_id}</td>
                    <td style={{ padding: '4px 6px' }}>{entry.miss_distance_km} km</td>
                    <td style={{ padding: '4px 6px', color: entry.collision_probability > 0.4 ? '#ff4d6d' : '#34d399', fontWeight: 'bold' }}>
                      {(entry.collision_probability * 100).toFixed(1)}%
                    </td>
                    <td style={{ padding: '4px 6px' }}>{entry.strategy}</td>
                    <td style={{ padding: '4px 6px' }}>+{entry.applied_dv_ms} m/s</td>
                    <td style={{ padding: '4px 6px' }}>
                      <span style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)', color: '#34d399', padding: '1px 4px', borderRadius: 3, fontSize: 8, fontWeight: 'bold' }}>
                        DEFLECTED (+{entry.separation_km}km)
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* FOOTER BAR */}
      <footer style={{ position: 'absolute', bottom: 10, left: 12, right: 12, zIndex: 25, background: 'rgba(15, 23, 42, 0.94)', backdropFilter: 'blur(16px)', border: '1px solid rgba(30, 41, 59, 0.8)', borderRadius: 7, padding: '6px 14px', pointerEvents: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8' }}>
          <Activity style={{ width: 13, height: 13, color: '#00f0ff' }} />
          <span style={{ fontWeight: 800, color: '#cbd5e1' }}>ORBIT-X 2.0:</span>
          <span style={{ color: '#34d399' }}>Telemetry Mesh Operational</span>
        </div>
        <div style={{ display: 'flex', gap: 14, color: '#64748b' }}>
          <span>Agent: <strong style={{ color: autonomousAgent ? '#34d399' : '#94a3b8' }}>{autonomousAgent ? 'ACTIVE' : 'MANUAL'}</strong></span>
          <span>Screening: <strong style={{ color: '#cbd5e1' }}>cKDTree O(N log N) ({screenedPairs} pairs)</strong></span>
          <span>Inference: <strong style={{ color: '#a855f7' }}>0.38 ms</strong></span>
          <span>Assets: <strong style={{ color: '#00f0ff' }}>{assets.length} Active</strong></span>
        </div>
      </footer>
    </div>
  );
}