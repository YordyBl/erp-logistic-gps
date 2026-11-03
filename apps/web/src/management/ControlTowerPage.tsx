import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';

import type { DispatchRoute } from '../api/client.js';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

export const OPENFREEMAP_STYLE = import.meta.env.VITE_MAP_STYLE_URL?.trim() ||
  'https://tiles.openfreemap.org/styles/bright';
const DATA_SOURCE = 'control-tower-data';

export interface TrackingPosition {
  readonly routeId: string;
  readonly driverId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number;
  readonly speedMetersPerSecond: number;
  readonly source: 'simulated' | 'mobile';
  readonly recordedAt: string;
  readonly receivedAt: string;
}

interface TrackingRoute {
  readonly id: string;
  readonly publicCode: string;
  readonly plannedDate: string;
  readonly status: DispatchRoute['status'];
  readonly stops: readonly Pick<DispatchRoute['stops'][number],
    'id' | 'sequence' | 'addressLine' | 'latitude' | 'longitude'>[];
}

interface TrackingSnapshot {
  readonly routes: readonly TrackingRoute[];
  readonly positions: readonly TrackingPosition[];
}

interface TrackingSocketMessage {
  readonly type: 'snapshot' | 'update';
  readonly data?: unknown;
  readonly snapshot?: unknown;
}

interface TicketClient {
  createTrackingTicket(): Promise<{ readonly ticket: string; readonly expiresAt: string }>;
}

type MapSocket = Pick<WebSocket, 'addEventListener' | 'removeEventListener' | 'close'>;

export function ControlTowerPage({ client, socketFactory = openTrackingSocket }: {
  readonly client: TicketClient;
  readonly socketFactory?: (ticket: string) => MapSocket;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [snapshot, setSnapshot] = useState<TrackingSnapshot>({ routes: [], positions: [] });
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [error, setError] = useState<string | null>(null);

  const geoJson = useMemo(() => toFeatureCollection(snapshot), [snapshot]);
  const geoJsonRef = useRef(geoJson);
  geoJsonRef.current = geoJson;

  useEffect(() => {
    if (mapContainer.current === null) return;
    let disposed = false;
    let map: MapLibreMap | undefined;
    void Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([maplibre]) => {
      if (disposed || mapContainer.current === null) return;
      maplibre.setWorkerUrl(maplibreWorkerUrl);
      map = new maplibre.Map({
        container: mapContainer.current,
        style: OPENFREEMAP_STYLE,
        center: [-77.04, -12.05],
        zoom: 10,
      });
      mapRef.current = map;
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      const addOperationalLayers = () => {
        if (map?.getSource(DATA_SOURCE) !== undefined) return;
        map?.addSource(DATA_SOURCE, { type: 'geojson', data: geoJsonRef.current });
        map?.addLayer({
          id: 'control-tower-stops', type: 'circle', source: DATA_SOURCE,
          filter: ['==', ['get', 'kind'], 'stop'],
          paint: { 'circle-radius': 7, 'circle-color': '#ef8b36', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
        });
        map?.addLayer({
          id: 'control-tower-stop-labels', type: 'symbol', source: DATA_SOURCE,
          filter: ['==', ['get', 'kind'], 'stop'],
          layout: { 'text-field': ['get', 'sequence'], 'text-size': 10, 'text-offset': [0, 1.6] },
          paint: { 'text-color': '#263844', 'text-halo-color': '#ffffff', 'text-halo-width': 1.5 },
        });
        void loadImageElement('/motorcycle-marker.svg').then((image) => {
          if (map === undefined) return;
          map.addImage('control-tower-motorcycle', image, { pixelRatio: 2 });
          map.addLayer({
            id: 'control-tower-positions', type: 'symbol', source: DATA_SOURCE,
            filter: ['==', ['get', 'kind'], 'last-known-position'],
            layout: { 'icon-image': 'control-tower-motorcycle', 'icon-size': 0.75, 'icon-allow-overlap': true },
          });
        }).catch(() => setError('No se pudo cargar el icono de la moto.'));
      };
      map.on('load', addOperationalLayers);
      map.on('error', () => setError('No se pudo cargar el mapa base. La lista de rutas sigue disponible.'));
    }).catch(() => setError('No se pudo inicializar el mapa. La lista de rutas sigue disponible.'));
    return () => {
      disposed = true;
      map?.remove();
      mapRef.current = null;
    };
    // The map instance is created once; changing route data updates its GeoJSON source below.
  }, []);

  useEffect(() => {
    const source = mapRef.current?.getSource(DATA_SOURCE) as GeoJSONSource | undefined;
    source?.setData(geoJson);
  }, [geoJson]);

  const receiveMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(String(event.data)) as TrackingSocketMessage;
      const raw = message.type === 'snapshot' ? message.data : message.snapshot;
      if (message.type !== 'snapshot' && message.type !== 'update') return;
      if (isTrackingSnapshot(raw)) {
        setSnapshot(raw);
        setConnection('connected');
        setError(null);
      }
    } catch {
      setError('Se recibió una actualización de seguimiento inválida.');
    }
  }, []);

  useEffect(() => {
    let active = true;
    let socket: MapSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    let reconnectScheduled = false;

    const scheduleReconnect = (failedSocket?: MapSocket) => {
      if (!active || reconnectScheduled) return;
      reconnectScheduled = true;
      setConnection('reconnecting');
      failedSocket?.close();
      attempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectScheduled = false;
        void connect();
      }, Math.min(1_000 * 2 ** Math.min(attempt, 4), 15_000));
    };

    const connect = async () => {
      try {
        const ticket = await client.createTrackingTicket();
        if (!active) return;
        socket = socketFactory(ticket.ticket);
        const onOpen = () => {
          if (active) {
            attempt = 0;
            setConnection('connected');
          }
        };
        const onMessage = (event: MessageEvent) => receiveMessage(event);
        socket.addEventListener('open', onOpen);
        socket.addEventListener('message', onMessage);
        socket.addEventListener('error', () => scheduleReconnect(socket), { once: true });
        socket.addEventListener('close', () => scheduleReconnect(socket), { once: true });
      } catch {
        scheduleReconnect();
      }
    };

    void connect();
    return () => {
      active = false;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }, [client, receiveMessage, socketFactory]);

  const routes = snapshot.routes.filter((route) => route.status !== 'completed');
  const latestPositionByRoute = new Map(snapshot.positions.map((position) => [position.routeId, position]));

  return (
    <section className="control-tower" aria-labelledby="control-tower-title">
      <header className="control-tower__heading">
        <div>
          <p className="order-management__context">OPERACIÓN · DESPACHO EN VIVO</p>
          <h1 id="control-tower-title">Torre de control</h1>
          <p>Consulta paradas planificadas y la última posición recibida de cada ruta en curso.</p>
        </div>
        <span className={`control-tower__connection control-tower__connection--${connection}`} role="status">
          <i />{connection === 'connected' ? 'Seguimiento conectado' : connection === 'connecting' ? 'Conectando…' : 'Reconectando…'}
        </span>
      </header>
      {error !== null && <p className="order-management__alert" role="alert">{error}</p>}
      <div className="control-tower__layout">
        <div className="control-tower__map-wrap">
          <div className="control-tower__map" ref={mapContainer} role="img" aria-label="Mapa de rutas y últimas posiciones recibidas" />
          <div className="control-tower__legend" aria-label="Leyenda del mapa">
            <span><i className="control-tower__legend-stop" />Parada planificada</span>
            <span><i className="control-tower__legend-position" />Última posición recibida</span>
          </div>
        </div>
        <aside className="control-tower__routes" aria-label="Rutas activas">
          <div className="control-tower__routes-heading">
            <h2>Rutas activas</h2><span>{routes.length}</span>
          </div>
          {routes.length === 0 ? <p className="control-tower__empty">No hay rutas activas para mostrar.</p> : routes.map((route) => {
            const position = latestPositionByRoute.get(route.id);
            return <article className="control-tower__route" key={route.id}>
              <header><h3>{route.publicCode}</h3><span className={`control-tower__route-status control-tower__route-status--${route.status}`}>
                {route.status === 'in_progress' ? 'En curso' : 'Planificada'}
              </span></header>
              <p>{route.stops.length} {route.stops.length === 1 ? 'parada' : 'paradas'} · {route.plannedDate}</p>
              {position === undefined ? <p className="control-tower__position-note">Aún no hay una posición recibida.</p> :
                <p className="control-tower__position-note">Última posición recibida · {formatReceivedTime(position.receivedAt)}</p>}
              <ol>{route.stops.map((stop) => <li key={stop.id}>{stop.addressLine}</li>)}</ol>
            </article>;
          })}
        </aside>
      </div>
      <p className="control-tower__disclaimer">La posición mostrada es la última recibida; no garantiza que el conductor esté allí ahora. ETA no disponible.</p>
    </section>
  );
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load map icon: ${src}`));
    image.src = src;
  });
}

function openTrackingSocket(ticket: string): WebSocket {
  const url = new URL('/api/v1/tracking/socket', window.location.href);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('ticket', ticket);
  return new WebSocket(url);
}

function isTrackingSnapshot(value: unknown): value is TrackingSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<TrackingSnapshot>;
  return Array.isArray(candidate.routes) && candidate.routes.every(isTrackingRoute) &&
    Array.isArray(candidate.positions) && candidate.positions.every(isTrackingPosition);
}

function isTrackingRoute(value: unknown): value is TrackingRoute {
  if (typeof value !== 'object' || value === null) return false;
  const route = value as Partial<TrackingRoute>;
  return typeof route.id === 'string' && typeof route.publicCode === 'string' &&
    typeof route.plannedDate === 'string' && ['planned', 'in_progress', 'completed'].includes(String(route.status)) &&
    Array.isArray(route.stops) && route.stops.every((stop) => typeof stop === 'object' && stop !== null &&
      typeof stop.id === 'string' && typeof stop.sequence === 'number' && typeof stop.addressLine === 'string' &&
      (stop.latitude === null || typeof stop.latitude === 'number') &&
      (stop.longitude === null || typeof stop.longitude === 'number'));
}

function isTrackingPosition(value: unknown): value is TrackingPosition {
  if (typeof value !== 'object' || value === null) return false;
  const position = value as Partial<TrackingPosition>;
  return typeof position.routeId === 'string' && typeof position.driverId === 'string' &&
    typeof position.latitude === 'number' && typeof position.longitude === 'number' &&
    typeof position.accuracyMeters === 'number' && typeof position.speedMetersPerSecond === 'number' &&
    (position.source === 'simulated' || position.source === 'mobile') &&
    typeof position.recordedAt === 'string' && typeof position.receivedAt === 'string';
}

function toFeatureCollection(snapshot: TrackingSnapshot): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const features: GeoJSON.Feature<GeoJSON.Point>[] = [];
  for (const route of snapshot.routes) {
    if (route.status === 'completed') continue;
    for (const stop of route.stops) {
      if (stop.longitude === null || stop.latitude === null || !isCoordinate(stop.longitude, stop.latitude)) continue;
      features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [stop.longitude, stop.latitude] },
        properties: { kind: 'stop', routeId: route.id, sequence: String(stop.sequence), label: stop.addressLine } });
    }
  }
  for (const position of snapshot.positions) {
    if (!isCoordinate(position.longitude, position.latitude)) continue;
    features.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] },
      properties: { kind: 'last-known-position', routeId: position.routeId, source: position.source,
        recordedAt: position.recordedAt, receivedAt: position.receivedAt } });
  }
  return { type: 'FeatureCollection', features };
}

function isCoordinate(longitude: number | null, latitude: number | null): longitude is number {
  return longitude !== null && latitude !== null && Number.isFinite(longitude) && Number.isFinite(latitude) &&
    longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
}

function formatReceivedTime(value: string): string {
  return new Intl.DateTimeFormat('es-PE', {
    hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'America/Lima',
  }).format(new Date(value));
}
