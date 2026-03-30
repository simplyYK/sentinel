"use client";

import { useEffect, useRef, useState } from "react";
import {
  MapContainer,
  TileLayer,
  ZoomControl,
  Marker,
  useMap,
  useMapEvents,
  CircleMarker,
  Popup,
  Polyline,
  Circle,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

import { useMapStore, type MapResource } from "@/store/mapStore";
import { useAppStore } from "@/store/appStore";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useReports } from "@/hooks/useReports";
import { useConflictData } from "@/hooks/useConflictData";
import { useFirmsHotspots } from "@/hooks/useFirmsHotspots";
import { useResourceLayers } from "@/hooks/useResourceLayers";
import { MAP_CONFIG } from "@/lib/constants/map-config";
import { REPORT_CATEGORIES } from "@/lib/constants/report-types";
import { safetyScoreColor } from "@/lib/utils/safety-score";
import type { Report } from "@/types/report";
import type { ConflictEvent } from "@/types/conflict";
import type { ThermalHotspot } from "@/lib/risk-intelligence";

// Fix Leaflet icon in webpack/Next.js
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
});

// SVG icon paths for crisp rendering at any size (no emoji inconsistency)
const SVG_ICONS: Record<string, string> = {
  // Hospital: cross
  hospital: `<path d="M7 3v4H3v4h4v4h4v-4h4V7h-4V3H7z" fill="white"/>`,
  // Clinic: heart + cross
  clinic: `<path d="M9 3C6.8 3 5 4.8 5 7c0 3.5 4 6.5 4 6.5s4-3 4-6.5c0-2.2-1.8-4-4-4zm0 5.5c-.8 0-1.5-.7-1.5-1.5S8.2 5.5 9 5.5s1.5.7 1.5 1.5S9.8 8.5 9 8.5z" fill="white"/>`,
  // Pharmacy: Rx symbol
  pharmacy: `<path d="M5 3v12h2V9h1.5l2.5 6h2.2L10.6 9C12 8.5 13 7.4 13 6c0-1.7-1.3-3-3-3H5zm2 2h3c.6 0 1 .4 1 1s-.4 1-1 1H7V5z" fill="white"/>`,
  // Shelter: house
  shelter: `<path d="M9 2L2 8h2v6h4v-4h2v4h4V8h2L9 2z" fill="white"/>`,
  // Police: shield
  police: `<path d="M9 1L3 4v4c0 4 2.6 7.7 6 9 3.4-1.3 6-5 6-9V4L9 1zm0 2.2L13 5v3c0 3.1-1.9 6-4 7.2C6.9 14 5 11.1 5 8V5l4-1.8z" fill="white"/>`,
  // Fire station: flame
  fire_station: `<path d="M9 1C7 4 5 5.5 5 8.5 5 11 7 13 9 13s4-2 4-4.5c0-1.5-.5-2.5-1-3.5-.3.8-1 1.5-2 1.5s-1.7-.7-2-1.5C8.5 3.5 9 2 9 1z" fill="white"/>`,
  // Embassy: building with columns
  embassy: `<path d="M9 1L3 4v1h12V4L9 1zM3 6v7h2V6H3zm4 0v7h2V6H7zm4 0v7h2V6h-2zM2 14v1h14v-1H2z" fill="white"/>`,
  // Water: droplet
  water_point: `<path d="M9 1C9 1 4 7 4 10c0 2.8 2.2 5 5 5s5-2.2 5-5C14 7 9 1 9 1zm0 12c-1.7 0-3-1.3-3-3 0-.3.1-.6.2-.9l.1.1c.5.5 1.2.8 2 .8 1.4 0 2.5-1.1 2.5-2.5 0-.3 0-.5-.1-.7C11.5 8.3 12 9.6 12 10c0 1.7-1.3 3-3 3z" fill="white"/>`,
  // Conflict: warning triangle
  conflict: `<path d="M9 2L1 16h16L9 2zm0 3l5.5 9.5H3.5L9 5zm-.5 3v4h1V8h-1zm0 5v1h1v-1h-1z" fill="white"/>`,
  // Default: pin
  default: `<path d="M9 1C6.2 1 4 3.2 4 6c0 4 5 9 5 9s5-5 5-9c0-2.8-2.2-5-5-5zm0 7c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" fill="white"/>`,
};

/** Compute icon size based on zoom level. Smaller when zoomed out, larger when zoomed in. */
function iconSizeForZoom(zoom: number, base = 28): number {
  // zoom 6 → 14px, zoom 10 → 22px, zoom 13 → 28px, zoom 16 → 36px, zoom 18 → 42px
  const clamped = Math.max(4, Math.min(zoom, 19));
  return Math.round(base * (0.35 + (clamped - 4) * 0.05));
}

function createSvgIcon(type: string, bg: string, size: number, extraClass = "") {
  const svgPath = SVG_ICONS[type] || SVG_ICONS.default;
  return L.divIcon({
    className: "",
    html: `<div class="${extraClass}" style="width:${size}px;height:${size}px;background:${bg};border-radius:${size < 20 ? '50%' : '30%'};display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,0.35);border:${size < 18 ? 1 : 2}px solid rgba(255,255,255,0.9)">
      <svg viewBox="0 0 18 18" width="${Math.round(size * 0.6)}" height="${Math.round(size * 0.6)}">${svgPath}</svg>
    </div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
  });
}

// Legacy wrapper for conflict markers that still use emoji
function createDivIcon(emoji: string, bg: string, size = 32, extraClass = "") {
  return L.divIcon({
    className: "",
    html: `<div class="${extraClass}" style="width:${size}px;height:${size}px;background:${bg};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${size * 0.5}px;box-shadow:0 2px 6px rgba(0,0,0,0.3);border:2px solid white">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2)],
  });
}

const RESOURCE_COLORS: Record<string, string> = {
  hospital: "#DC2626",
  clinic: "#F97316",
  pharmacy: "#22C55E",
  shelter: "#3B82F6",
  police: "#1E40AF",
  fire_station: "#B91C1C",
  embassy: "#7C3AED",
  water_point: "#06B6D4",
};

/** Hook to track current zoom level reactively */
function useZoomLevel(): number {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());
  useEffect(() => {
    const handler = () => setZoom(map.getZoom());
    map.on("zoomend", handler);
    return () => { map.off("zoomend", handler); };
  }, [map]);
  return zoom;
}

function FlyToHandler() {
  const map = useMap();
  const flyTarget = useMapStore((s) => s.flyTarget);
  const clearFlyTarget = useMapStore((s) => s.clearFlyTarget);

  useEffect(() => {
    if (flyTarget) {
      map.flyTo(flyTarget, 14, { animate: true, duration: 1.2 });
      clearFlyTarget();
    }
  }, [flyTarget, map, clearFlyTarget]);

  return null;
}

function MapEvents() {
  const setCenter = useMapStore((s) => s.setCenter);
  const setZoom = useMapStore((s) => s.setZoom);
  const setBounds = useMapStore((s) => s.setBounds);
  const map = useMap();
  const lastCenter = useRef<[number, number]>([0, 0]);

  useMapEvents({
    moveend() {
      const c = map.getCenter();
      // Only update store if center moved meaningfully (prevents infinite loop
      // where setCenter triggers re-render which triggers moveend again)
      const dx = Math.abs(c.lat - lastCenter.current[0]);
      const dy = Math.abs(c.lng - lastCenter.current[1]);
      if (dx > 0.0001 || dy > 0.0001) {
        lastCenter.current = [c.lat, c.lng];
        setCenter([c.lat, c.lng]);
        setZoom(map.getZoom());
        const b = map.getBounds();
        setBounds({ south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() });
      }
    },
  });
  return null;
}

function UserLocationMarker() {
  const map = useMap();
  const { latitude, longitude } = useGeolocation();
  const setUserLocation = useAppStore((s) => s.setUserLocation);

  useEffect(() => {
    if (latitude && longitude) {
      map.flyTo([latitude, longitude], 13, { animate: true, duration: 1.5 });
      setUserLocation({ lat: latitude, lng: longitude });
    }
  }, [latitude, longitude, map, setUserLocation]);

  if (!latitude || !longitude) return null;

  return (
    <CircleMarker
      center={[latitude, longitude]}
      radius={8}
      pathOptions={{ color: "#0EA5E9", fillColor: "#0EA5E9", fillOpacity: 1, weight: 3 }}
    >
      <Popup>
        <div className="text-sm font-medium">📍 Your Location</div>
        <div className="text-xs text-slate-500">{latitude.toFixed(4)}, {longitude.toFixed(4)}</div>
      </Popup>
    </CircleMarker>
  );
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#DC2626",
  high: "#F97316",
  medium: "#F59E0B",
  low: "#3B82F6",
};
const SEVERITY_LABELS: Record<string, string> = {
  critical: "CRITICAL",
  high: "HIGH",
  medium: "MODERATE",
  low: "LOW",
};

function conflictTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  if (!Number.isFinite(diff) || diff < 0) return "";
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "< 1 hour ago";
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function ConflictMarkers({ events, conflictIconClass }: { events: ConflictEvent[]; conflictIconClass: string }) {
  const zoom = useZoomLevel();
  const size = iconSizeForZoom(zoom, 26);

  return (
    <>
      {events.map((e) => {
        const color = SEVERITY_COLORS[e.severity] || "#6B7280";
        const icon = createSvgIcon("conflict", color, size, conflictIconClass);
        const ago = conflictTimeAgo(e.event_date);
        return (
          <Marker
            key={e.id}
            position={[e.latitude, e.longitude]}
            icon={icon}
          >
            <Popup maxWidth={320}>
              <div style={{ fontFamily: "Inter, system-ui, sans-serif", fontSize: "12px", lineHeight: "1.5", maxWidth: "300px" }}>
                {/* Header: severity badge + event type */}
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px" }}>
                  <span style={{
                    backgroundColor: color,
                    color: "#fff",
                    fontSize: "9px",
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: "4px",
                    letterSpacing: "0.05em",
                  }}>
                    {SEVERITY_LABELS[e.severity] || "UNKNOWN"}
                  </span>
                  <span style={{ fontWeight: 600, color: "#1e293b" }}>{e.event_type}</span>
                </div>

                {/* Sub-event type */}
                {e.sub_event_type && (
                  <p style={{ color: "#64748b", fontSize: "11px", margin: "0 0 4px" }}>
                    {e.sub_event_type}
                  </p>
                )}

                {/* Location + Date */}
                <p style={{ color: "#475569", fontSize: "11px", margin: "0 0 4px" }}>
                  📍 {e.location}{e.admin1 && e.admin1 !== e.location ? `, ${e.admin1}` : ""}
                  <span style={{ color: "#94a3b8", marginLeft: "6px" }}>{e.event_date}{ago ? ` (${ago})` : ""}</span>
                </p>

                {/* Actors involved */}
                {(e.actor1 || e.actor2) && (
                  <div style={{ background: "#f1f5f9", borderRadius: "6px", padding: "5px 8px", margin: "4px 0", fontSize: "11px" }}>
                    <span style={{ color: "#64748b", fontWeight: 600, fontSize: "9px", textTransform: "uppercase", letterSpacing: "0.05em" }}>Actors</span>
                    <p style={{ color: "#334155", margin: "2px 0 0" }}>{e.actor1}{e.actor2 ? ` vs ${e.actor2}` : ""}</p>
                  </div>
                )}

                {/* Fatalities */}
                {e.fatalities > 0 && (
                  <p style={{ color: "#DC2626", fontWeight: 600, fontSize: "11px", margin: "4px 0" }}>
                    ☠ {e.fatalities} fatalit{e.fatalities === 1 ? "y" : "ies"} reported
                  </p>
                )}
                {e.fatalities === 0 && (
                  <p style={{ color: "#16a34a", fontSize: "11px", margin: "4px 0" }}>
                    No fatalities reported
                  </p>
                )}

                {/* Notes / Description */}
                {e.notes && (
                  <p style={{ color: "#475569", fontSize: "11px", margin: "4px 0", borderTop: "1px solid #e2e8f0", paddingTop: "4px" }}>
                    {e.notes.length > 300 ? e.notes.slice(0, 300) + "…" : e.notes}
                  </p>
                )}

                {/* Source citation */}
                <p style={{ color: "#94a3b8", fontSize: "10px", margin: "6px 0 0", borderTop: "1px solid #e2e8f0", paddingTop: "4px" }}>
                  Source: {e.source || "ACLED"}
                </p>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

// Danger zones: radius circles around critical/high severity conflict events
function DangerZones({ events }: { events: ConflictEvent[] }) {
  const dangerEvents = events.filter((e) => e.severity === "critical" || e.severity === "high");

  const radiusMap: Record<string, number> = {
    critical: 2000, // 2km radius
    high: 1000,     // 1km radius
  };

  return (
    <>
      {dangerEvents.map((e) => (
        <Circle
          key={`dz-${e.id}`}
          center={[e.latitude, e.longitude]}
          radius={radiusMap[e.severity] ?? 1000}
          pathOptions={{
            color: e.severity === "critical" ? "#DC2626" : "#F97316",
            fillColor: e.severity === "critical" ? "#DC2626" : "#F97316",
            fillOpacity: 0.08,
            weight: 1,
            dashArray: "5 5",
          }}
        />
      ))}
    </>
  );
}

function ReportMarkers({ reports }: { reports: Report[] }) {
  const zoom = useZoomLevel();
  const size = iconSizeForZoom(zoom, 28);

  return (
    <>
      {reports.map((r) => {
        const cat = REPORT_CATEGORIES.find((c) => c.id === r.category);
        const icon = createDivIcon(cat?.icon || "📍", cat?.color || "#6B7280", size);
        const timeAgo = new Date(r.created_at);
        const diffMin = Math.round((Date.now() - timeAgo.getTime()) / 60000);
        const timeStr = diffMin < 60 ? `${diffMin}m ago` : `${Math.round(diffMin / 60)}h ago`;

        return (
          <Marker key={r.id} position={[r.latitude, r.longitude]} icon={icon}>
            <Popup maxWidth={280}>
              <div className="text-sm space-y-1">
                <p className="font-bold">{r.title}</p>
                <p className="text-xs text-slate-500">{cat?.label} · {timeStr}</p>
                {r.description && <p className="text-xs">{r.description}</p>}
                <p className="text-xs text-slate-400">
                  ✓ {r.confirmations} confirmations
                </p>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

function ResourceMarkers({ resources }: { resources: MapResource[] }) {
  const zoom = useZoomLevel();
  const size = iconSizeForZoom(zoom, 30);

  return (
    <>
      {resources.map((r) => {
        const color = RESOURCE_COLORS[r.type] || "#6B7280";
        const icon = createSvgIcon(r.type, color, size);
        return (
          <Marker key={r.id} position={[r.latitude, r.longitude]} icon={icon}>
            <Popup maxWidth={300}>
              <div className="text-sm space-y-1">
                <p className="font-bold">{r.name}</p>
                <p className="text-xs text-slate-500 capitalize">{r.type.replace("_", " ")}</p>
                {r.address && <p className="text-xs text-slate-600">{r.address}</p>}
                {r.phone && (
                  <a href={`tel:${r.phone}`} className="text-xs text-blue-600 block">
                    📞 {r.phone}
                  </a>
                )}
                {r.website && (
                  <a href={r.website} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 block">
                    🌐 Website
                  </a>
                )}
                {r.operating_hours && (
                  <p className="text-xs text-slate-500">{r.operating_hours}</p>
                )}
                {r.source && (
                  <p className="text-[10px] text-slate-400">Source: {r.source}</p>
                )}
                <a
                  href={`/route?destLat=${r.latitude}&destLng=${r.longitude}&destName=${encodeURIComponent(r.name)}`}
                  className="inline-flex items-center gap-1 text-xs text-teal font-medium mt-1"
                >
                  🧭 Navigate here
                </a>
              </div>
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}

function ThermalLayer({ hotspots }: { hotspots: ThermalHotspot[] }) {
  return (
    <>
      {hotspots.map((h, i) => {
        const radius = Math.min(Math.max(h.frp / 5, 4), 18);
        return (
          <CircleMarker
            key={`firms-${i}-${h.lat}-${h.lng}`}
            center={[h.lat, h.lng]}
            radius={radius}
            pathOptions={{
              color: "#DC2626",
              fillColor: h.confidence === "high" ? "#FF4500" : "#DC2626",
              fillOpacity: 0.55,
              weight: 1,
            }}
          >
            <Popup maxWidth={240}>
              <div className="text-sm space-y-1">
                <p className="font-bold text-red-600">Thermal Anomaly</p>
                <p className="text-xs text-slate-500">{h.acq_date} {h.acq_time}</p>
                <p className="text-xs">Brightness: {h.brightness.toFixed(0)} K</p>
                <p className="text-xs">Fire Power: {h.frp.toFixed(1)} MW</p>
                <p className="text-xs">Confidence: {h.confidence}</p>
                <p className="text-[9px] text-slate-500 mt-1 italic">FIRMS detects heat signatures via satellite. In conflict zones, thermal anomalies may indicate fires, explosions, or industrial activity.</p>
                <p className="text-[10px] text-slate-400">Source: NASA FIRMS VIIRS</p>
              </div>
            </Popup>
          </CircleMarker>
        );
      })}
    </>
  );
}

function RouteLayer() {
  const { selectedRoute, routes } = useMapStore();

  return (
    <>
      {routes
        .filter((r) => r.id !== selectedRoute?.id)
        .map((route) => (
          <Polyline
            key={route.id}
            positions={route.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])}
            pathOptions={{ color: "#94A3B8", weight: 4, opacity: 0.5, dashArray: "10 10" }}
          />
        ))}
      {selectedRoute && (
        <Polyline
          positions={selectedRoute.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number])}
          pathOptions={{
            color: safetyScoreColor(selectedRoute.safetyScore),
            weight: 6,
            opacity: 0.85,
          }}
        />
      )}
    </>
  );
}


interface CrisisMapProps {
  onMapClick?: (lat: number, lng: number) => void;
  country?: string;
}

export default function CrisisMap({ country = "Ukraine" }: CrisisMapProps) {
  const { center, zoom, activeLayers, selectedRoute, routes, setViewCountry, resources } = useMapStore();
  const visualMode = useAppStore((s) => s.visualMode);
  const { reports } = useReports();
  const { events } = useConflictData(country);
  const { hotspots } = useFirmsHotspots(true);
  // Auto-fetch resources when per-type layers are toggled on
  useResourceLayers();

  useEffect(() => {
    setViewCountry(country);
  }, [country, setViewCountry]);

  const conflictIconClass = visualMode === "flir" ? "conflict-marker-flir" : "";

  const defaultCenter: [number, number] = [
    center[0] || MAP_CONFIG.DEFAULT_LAT,
    center[1] || MAP_CONFIG.DEFAULT_LNG,
  ];

  return (
    <MapContainer
      center={defaultCenter}
      zoom={zoom || MAP_CONFIG.DEFAULT_ZOOM}
      zoomControl={false}
      style={{ width: "100%", height: "100%" }}
      minZoom={MAP_CONFIG.MIN_ZOOM}
      maxZoom={MAP_CONFIG.MAX_ZOOM}
    >
      <TileLayer
        url={MAP_CONFIG.TILE_URL}
        attribution={MAP_CONFIG.ATTRIBUTION}
        maxZoom={19}
      />
      <ZoomControl position="bottomleft" />
      <MapEvents />
      <FlyToHandler />
      <UserLocationMarker />

      {activeLayers.conflictEvents && (
        <ConflictMarkers events={events} conflictIconClass={conflictIconClass} />
      )}
      {activeLayers.reports && <ReportMarkers reports={reports} />}

      {/* Resources: show when generic resources OR any per-type layer is on */}
      {(activeLayers.resources || activeLayers.hospitals || activeLayers.pharmacies || activeLayers.shelters || activeLayers.police || activeLayers.water) && resources.length > 0 && (
        <ResourceMarkers resources={
          activeLayers.resources
            ? resources
            : resources.filter((r) => {
                if (activeLayers.hospitals && (r.type === "hospital" || r.type === "clinic" || r.type === "doctors")) return true;
                if (activeLayers.pharmacies && r.type === "pharmacy") return true;
                if (activeLayers.shelters && (r.type === "shelter" || r.type === "community_centre" || r.type === "place_of_worship" || r.type === "school" || r.type === "fire_station" || r.type === "social_facility")) return true;
                if (activeLayers.police && r.type === "police") return true;
                if (activeLayers.water && (r.type === "water_point" || r.type === "drinking_water")) return true;
                return false;
              })
        } />
      )}

      {/* Danger zones: buffer circles around critical conflict events */}
      {activeLayers.dangerZones && events.length > 0 && (
        <DangerZones events={events} />
      )}

      {/* Thermal hotspots: shown when dangerZones layer is on */}
      {activeLayers.dangerZones && hotspots.length > 0 && (
        <ThermalLayer hotspots={hotspots} />
      )}

      {(selectedRoute || routes.length > 0) && <RouteLayer />}
    </MapContainer>
  );
}
