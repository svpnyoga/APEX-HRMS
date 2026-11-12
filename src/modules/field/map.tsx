import { useEffect } from 'react'
import { MapContainer, TileLayer, CircleMarker, Circle, Polyline, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'

const TILE = (import.meta.env.VITE_MAP_TILE_URL as string | undefined) || 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const ATTR = (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined) || '&copy; OpenStreetMap contributors'

export type MapPoint = { id: string; lat: number; lng: number; label: string; sub?: string; tone?: 'primary' | 'success' | 'warning' | 'danger' }
export type MapSite = { id: string; lat: number; lng: number; radius: number; name: string }
const COLORS = { primary: '#3F3CBB', success: '#15803D', warning: '#B45309', danger: '#B91C1C' }

function Fit({ pts }: { pts: [number, number][] }) {
  const map = useMap()
  useEffect(() => { if (pts.length === 1) map.setView(pts[0], 14); else if (pts.length > 1) map.fitBounds(pts, { padding: [40, 40] }) }, [JSON.stringify(pts)]) // eslint-disable-line
  return null
}

export function FieldMap({ points = [], sites = [], path, height = 420, onPick }: { points?: MapPoint[]; sites?: MapSite[]; path?: [number, number][]; height?: number; onPick?: (lat: number, lng: number) => void }) {
  const all: [number, number][] = [...points.map((p) => [p.lat, p.lng] as [number, number]), ...sites.map((s) => [s.lat, s.lng] as [number, number]), ...(path ?? [])]
  return (
    <div style={{ height }} className="overflow-hidden rounded-xl border border-line">
      <MapContainer center={all[0] ?? [13.0827, 80.2707]} zoom={11} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <TileLayer url={TILE} attribution={ATTR} />
        <Fit pts={all} />
        {onPick && <Picker onPick={onPick} />}
        {sites.map((s) => (
          <Circle key={s.id} center={[s.lat, s.lng]} radius={s.radius} pathOptions={{ color: '#0891B2', weight: 1.5, fillOpacity: 0.08 }}>
            <Tooltip>{s.name} · {s.radius} m geofence</Tooltip>
          </Circle>
        ))}
        {path && path.length > 1 && <Polyline positions={path} pathOptions={{ color: '#3F3CBB', weight: 3, opacity: 0.8 }} />}
        {points.map((p) => (
          <CircleMarker key={p.id} center={[p.lat, p.lng]} radius={8} pathOptions={{ color: '#fff', weight: 2, fillColor: COLORS[p.tone ?? 'primary'], fillOpacity: 1 }}>
            <Tooltip><b>{p.label}</b>{p.sub && <><br />{p.sub}</>}</Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  )
}

function Picker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  const map = useMap()
  useEffect(() => {
    const h = (e: any) => onPick(Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6)))
    map.on('click', h)
    return () => { map.off('click', h) }
  }, [map, onPick])
  return null
}
