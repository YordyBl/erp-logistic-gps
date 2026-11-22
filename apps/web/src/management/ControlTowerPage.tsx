import { Route } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GeoJSONSource, Map as MapLibreMap, MapLayerMouseEvent, Popup } from 'maplibre-gl';

import type { ApiClient, DeliveryOrder, DispatchRoute, RouteTrack } from '../api/client.js';
import { ErrorNotice, LoadingRows } from '../components/Notices.js';
import { Card } from '../components/ui/card.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '../components/ui/empty.js';
import { formatTimeAgo } from '../lib/format.js';
import { ActiveRouteItem, routeCrew } from './routes/ActiveRouteItem.js';
import type { RouteDetails } from './routes/routeDetails.js';
import { ORDER_STATUS_LABELS } from '../delivery/orderStatus.js';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import { OPENFREEMAP_STYLE } from '../lib/mapStyle.js';

export { OPENFREEMAP_STYLE };
const DATA_SOURCE = 'control-tower-data';
const TRACK_SOURCE = 'control-tower-track';
const POSITIONS_LAYER = 'control-tower-positions';
const MAP_STOP_COLOR = '#ef8b36';
const TRAVELED_COLOR = '#1d6fb8';
const PENDING_COLOR = '#5f7480';

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
  readonly driverId: string;
  readonly vehicleId: string;
  readonly stops: readonly Pick<DispatchRoute['stops'][number],
    'id' | 'sequence' | 'addressLine' | 'latitude' | 'longitude' | 'orderIds'>[];
}

type TrackingOrder = Pick<DeliveryOrder, 'id' | 'publicCode' | 'status'>;

interface TrackingSnapshot {
  readonly routes: readonly TrackingRoute[];
  readonly orders: readonly TrackingOrder[];
  readonly positions: readonly TrackingPosition[];
}

interface TrackingSocketMessage {
  readonly type: 'snapshot' | 'update' | 'position';
  readonly kind?: string;
  readonly data?: unknown;
  readonly snapshot?: unknown;
  readonly position?: unknown;
}

/** Conductores y vehículos: cambian poco, así que se cargan una vez al abrir la página. */
interface Catalogs {
  readonly drivers: RouteDetails['drivers'];
  readonly vehicles: RouteDetails['vehicles'];
}

const NO_CATALOGS: Catalogs = { drivers: [], vehicles: [] };
const EMPTY_SNAPSHOT: TrackingSnapshot = { routes: [], orders: [], positions: [] };

interface TicketClient extends Partial<Pick<ApiClient, 'listDrivers' | 'listVehicles'>> {
  createTrackingTicket(): Promise<{ readonly ticket: string; readonly expiresAt: string }>;
  /** Optional: without it (or if it fails) the map shows no driven or pending path. */
  getRouteTrack?(routeId: string): Promise<RouteTrack>;
}

type MapSocket = Pick<WebSocket, 'addEventListener' | 'removeEventListener' | 'close'>;

/** A selected route and whether the choice came from the map (then its card scrolls into view). */
interface Selection {
  readonly routeId: string;
  readonly from: 'map' | 'list';
}

/** The fetched track of the selected route plus the live positions received after the fetch. */
interface SelectedTrack extends RouteTrack {
  readonly routeId: string;
}

type TrailPoint = RouteTrack['traveled'][number];

export function ControlTowerPage({ client, socketFactory = openTrackingSocket }: {
  readonly client: TicketClient;
  readonly socketFactory?: (ticket: string) => MapSocket;
}) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [snapshot, setSnapshot] = useState<TrackingSnapshot>(EMPTY_SNAPSHOT);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<Catalogs>(NO_CATALOGS);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [track, setTrack] = useState<SelectedTrack | null>(null);
  const [liveTrail, setLiveTrail] = useState<readonly TrailPoint[]>([]);
  // Bumped by order and route news, which can settle stops and shorten the pending path.
  const [trackVersion, setTrackVersion] = useState(0);
  const cardRefs = useRef(new Map<string, HTMLLIElement>());
  const selectedRouteId = selection?.routeId ?? null;

  useEffect(() => {
    let active = true;
    void Promise.allSettled([
      client.listDrivers?.() ?? Promise.resolve([]),
      client.listVehicles?.() ?? Promise.resolve([]),
    ]).then(([drivers, vehicles]) => {
      if (!active) return;
      setCatalogs({
        drivers: drivers.status === 'fulfilled' ? drivers.value : [],
        vehicles: vehicles.status === 'fulfilled' ? vehicles.value : [],
      });
    });
    return () => { active = false; };
  }, [client]);
  // Rutas y pedidos llegan en el snapshot; solo la tripulación sale de los catálogos.
  const details = useMemo<RouteDetails>(() => ({
    routes: snapshot.routes, orders: snapshot.orders, drivers: catalogs.drivers, vehicles: catalogs.vehicles,
  }), [catalogs, snapshot.orders, snapshot.routes]);

  const geoJson = useMemo(() => toFeatureCollection(snapshot), [snapshot]);
  const geoJsonRef = useRef(geoJson);
  geoJsonRef.current = geoJson;
  const trackGeoJson = useMemo(() => toTrackCollection(track, liveTrail), [track, liveTrail]);
  const trackGeoJsonRef = useRef(trackGeoJson);
  trackGeoJsonRef.current = trackGeoJson;

  // Map event handlers are bound once, so they read the latest data through refs.
  const popupContentRef = useRef<(routeId: string) => HTMLElement>(() => document.createElement('div'));
  popupContentRef.current = (routeId) => popupContent(routeId, snapshot, details);
  const selectFromMapRef = useRef<(routeId: string | null) => void>(() => undefined);
  selectFromMapRef.current = (routeId) => setSelection(routeId === null ? null : { routeId, from: 'map' });

  useEffect(() => {
    if (mapContainer.current === null) return;
    let disposed = false;
    let map: MapLibreMap | undefined;
    let popup: Popup | undefined;
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
      popup = new maplibre.Popup({ closeButton: false, closeOnClick: false, offset: 18, className: 'control-tower-popup' });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      const addOperationalLayers = () => {
        if (map?.getSource(DATA_SOURCE) !== undefined) return;
        // Paths go first so stops and the driver marker are drawn on top of them.
        map?.addSource(TRACK_SOURCE, { type: 'geojson', data: trackGeoJsonRef.current });
        map?.addLayer({
          id: 'control-tower-traveled', type: 'line', source: TRACK_SOURCE,
          filter: ['==', ['get', 'kind'], 'traveled'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': TRAVELED_COLOR, 'line-width': 4, 'line-opacity': 0.9 },
        });
        map?.addLayer({
          id: 'control-tower-pending', type: 'line', source: TRACK_SOURCE,
          filter: ['==', ['get', 'kind'], 'pending'],
          layout: { 'line-join': 'round' },
          paint: { 'line-color': PENDING_COLOR, 'line-width': 3, 'line-dasharray': [2, 2] },
        });
        map?.addSource(DATA_SOURCE, { type: 'geojson', data: geoJsonRef.current });
        map?.addLayer({
          id: 'control-tower-stops', type: 'circle', source: DATA_SOURCE,
          filter: ['==', ['get', 'kind'], 'stop'],
          paint: { 'circle-radius': 7, 'circle-color': MAP_STOP_COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
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
            id: POSITIONS_LAYER, type: 'symbol', source: DATA_SOURCE,
            filter: ['==', ['get', 'kind'], 'last-known-position'],
            layout: { 'icon-image': 'control-tower-motorcycle', 'icon-size': 0.75, 'icon-allow-overlap': true },
          });
        }).catch(() => setError('No se pudo cargar el icono de la moto.'));
      };
      map.on('load', addOperationalLayers);
      map.on('mouseenter', POSITIONS_LAYER, (event: MapLayerMouseEvent) => {
        const feature = event.features?.[0];
        const routeId = feature?.properties?.routeId;
        if (map === undefined || feature?.geometry.type !== 'Point' || typeof routeId !== 'string') return;
        map.getCanvas().style.cursor = 'pointer';
        const [longitude, latitude] = feature.geometry.coordinates as [number, number];
        popup?.setLngLat([longitude, latitude]).setDOMContent(popupContentRef.current(routeId)).addTo(map);
      });
      map.on('mouseleave', POSITIONS_LAYER, () => {
        if (map !== undefined) map.getCanvas().style.cursor = '';
        popup?.remove();
      });
      // A click on a driver selects its route; a click anywhere else clears the selection.
      map.on('click', (event) => {
        if (map === undefined) return;
        const hit = map.getLayer(POSITIONS_LAYER) === undefined ? []
          : map.queryRenderedFeatures(event.point, { layers: [POSITIONS_LAYER] });
        const routeId = hit[0]?.properties?.routeId;
        selectFromMapRef.current(typeof routeId === 'string' ? routeId : null);
      });
      map.on('error', () => setError('No se pudo cargar el mapa base. La lista de rutas sigue disponible.'));
    }).catch(() => setError('No se pudo inicializar el mapa. La lista de rutas sigue disponible.'));
    return () => {
      disposed = true;
      popup?.remove();
      map?.remove();
      mapRef.current = null;
    };
    // The map instance is created once; changing route data updates its GeoJSON sources below.
  }, []);

  useEffect(() => {
    const source = mapRef.current?.getSource(DATA_SOURCE) as GeoJSONSource | undefined;
    source?.setData(geoJson);
  }, [geoJson]);

  useEffect(() => {
    const source = mapRef.current?.getSource(TRACK_SOURCE) as GeoJSONSource | undefined;
    source?.setData(trackGeoJson);
  }, [trackGeoJson]);

  // Fetch the selected route's path; refetch when deliveries or incidents change what is left.
  useEffect(() => {
    setTrack(null);
    setLiveTrail([]);
    if (selectedRouteId === null || client.getRouteTrack === undefined) return;
    let active = true;
    client.getRouteTrack(selectedRouteId)
      .then((loaded) => { if (active) { setTrack({ ...loaded, routeId: selectedRouteId }); setLiveTrail([]); } })
      .catch(() => undefined);
    return () => { active = false; };
  }, [client, selectedRouteId, trackVersion]);

  // Positions that arrive after the fetch extend the driven path without asking the API again.
  const selectedPosition = snapshot.positions.find((position) => position.routeId === selectedRouteId);
  useEffect(() => {
    if (selectedPosition === undefined || track?.routeId !== selectedPosition.routeId) return;
    const point = { latitude: selectedPosition.latitude, longitude: selectedPosition.longitude, recordedAt: selectedPosition.recordedAt };
    setLiveTrail((current) => {
      const last = current.at(-1) ?? track.traveled.at(-1);
      return last !== undefined && Date.parse(last.recordedAt) >= Date.parse(point.recordedAt) ? current : [...current, point];
    });
  }, [selectedPosition, track]);

  const receiveMessage = useCallback((event: MessageEvent) => {
    try {
      const message = JSON.parse(String(event.data)) as TrackingSocketMessage;
      if (message.type === 'position') {
        const position = message.position;
        if (isTrackingPosition(position)) setSnapshot((current) => withPosition(current, position));
        return;
      }
      const raw = message.type === 'snapshot' ? message.data : message.snapshot;
      if (message.type !== 'snapshot' && message.type !== 'update') return;
      if (isTrackingSnapshot(raw)) {
        setSnapshot((current) => withNewerPositions(raw, current));
        setConnection('connected');
        setError(null);
        // Las novedades de rutas y pedidos traen su avance en el snapshot; solo el recorrido pendiente se vuelve a pedir.
        if (message.type === 'update') setTrackVersion((version) => version + 1);
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

  // Primero las rutas en curso: son las que se están siguiendo.
  const routes = snapshot.routes.filter((route) => route.status !== 'completed')
    .sort((left, right) => Number(right.status === 'in_progress') - Number(left.status === 'in_progress'));
  const latestPositionByRoute = new Map(snapshot.positions.map((position) => [position.routeId, position]));

  // A route that finished or left the snapshot can no longer be followed.
  const selectionVisible = selectedRouteId === null || routes.some((route) => route.id === selectedRouteId);
  useEffect(() => { if (!selectionVisible) setSelection(null); }, [selectionVisible]);

  // Only a selection made on the map scrolls the list; a click on the card is already in view.
  useEffect(() => {
    if (selection?.from !== 'map') return;
    cardRefs.current.get(selection.routeId)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [selection]);

  function selectFromList(route: TrackingRoute): void {
    if (selectedRouteId === route.id) {
      setSelection(null);
      return;
    }
    setSelection({ routeId: route.id, from: 'list' });
    const position = latestPositionByRoute.get(route.id);
    const firstStop = route.stops.find((stop) => isCoordinate(stop.longitude, stop.latitude));
    const center = position !== undefined ? [position.longitude, position.latitude] as [number, number]
      : firstStop !== undefined ? [firstStop.longitude!, firstStop.latitude!] as [number, number] : undefined;
    const map = mapRef.current;
    if (map !== null && center !== undefined) map.flyTo({ center, zoom: Math.max(map.getZoom(), 13) });
  }

  return (
    <section className="flex flex-col gap-6" aria-label="Torre de control">
      {error !== null && <ErrorNotice>{error}</ErrorNotice>}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <Card className="overflow-hidden p-0">
          <div className="relative h-96 md:h-[36rem]">
            <div className="size-full" ref={mapContainer} role="img" aria-label="Mapa de rutas y últimas posiciones recibidas" />
            <div className="absolute top-4 left-4 flex flex-col gap-2 rounded-lg border bg-background p-3 text-xs" aria-label="Leyenda del mapa">
              <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: MAP_STOP_COLOR }} />Parada planificada</span>
              <span className="flex items-center gap-2"><img src="/motorcycle-marker.svg" alt="" className="size-4" />Última posición recibida</span>
              {track !== null && (
                <>
                  <span className="flex items-center gap-2"><span className="h-1 w-4 rounded-full" style={{ background: TRAVELED_COLOR }} />Recorrido realizado</span>
                  <span className="flex items-center gap-2">
                    <span className="w-4 border-t-2 border-dashed" style={{ borderColor: PENDING_COLOR }} />
                    Recorrido pendiente{track.pendingSource === 'straight' ? ' (en línea recta)' : ''}
                  </span>
                </>
              )}
            </div>
          </div>
        </Card>
        <div className="flex min-h-0 flex-col gap-4 xl:h-[36rem]">
          <h2 className="text-base font-semibold">{routes.length} {routes.length === 1 ? 'Ruta activa' : 'Rutas activas'}</h2>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
            {routes.length === 0 && connection !== 'connected' && <LoadingRows label="Conectando con el seguimiento…" rows={2} />}
            {routes.length === 0 && connection === 'connected' && (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Route aria-hidden="true" /></EmptyMedia>
                  <EmptyDescription>No hay rutas activas para mostrar.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            {routes.length > 0 && (
              <ul className="flex flex-col gap-3 p-1">
                {routes.map((route) => (
                  <ActiveRouteItem key={route.id} route={route} position={latestPositionByRoute.get(route.id)} details={details}
                    selected={route.id === selectedRouteId} onSelect={() => selectFromList(route)}
                    elementRef={(element) => {
                      if (element === null) cardRefs.current.delete(route.id);
                      else cardRefs.current.set(route.id, element);
                    }} />
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">La posición mostrada es la última recibida; no garantiza que el conductor esté allí ahora. ETA no disponible.</p>
    </section>
  );
}

/** Hover card for a driver marker. Built with text nodes only: names come from user data. */
function popupContent(routeId: string, snapshot: TrackingSnapshot, details: RouteDetails): HTMLElement {
  const route = snapshot.routes.find((item) => item.id === routeId);
  const position = snapshot.positions.find((item) => item.routeId === routeId);
  const { driver, plate } = routeCrew(details, routeId);
  const container = document.createElement('div');
  container.className = 'flex flex-col gap-0.5 text-xs';
  const line = (text: string, className = '') => {
    const element = document.createElement('span');
    element.className = className;
    element.textContent = text;
    container.append(element);
  };
  line(driver ?? 'Conductor no disponible', 'font-medium text-sm');
  line(`Placa ${plate ?? '—'}`, 'tabular-nums');
  if (route !== undefined) line(`Ruta ${route.publicCode}`, 'tabular-nums');
  if (position !== undefined) line(`Señal ${formatTimeAgo(position.receivedAt)}`, 'text-muted-foreground');
  return container;
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

function isNewer(candidate: TrackingPosition, than: TrackingPosition | undefined): boolean {
  return than === undefined || Date.parse(candidate.recordedAt) >= Date.parse(than.recordedAt);
}

/** Replaces the last known position of one route without touching the rest of the snapshot. */
function withPosition(snapshot: TrackingSnapshot, position: TrackingPosition): TrackingSnapshot {
  const index = snapshot.positions.findIndex((item) => item.routeId === position.routeId);
  if (index !== -1 && !isNewer(position, snapshot.positions[index])) return snapshot;
  if (index === -1 && !snapshot.routes.some((route) => route.id === position.routeId)) return snapshot;
  const positions = index === -1 ? [...snapshot.positions, position]
    : snapshot.positions.map((item, itemIndex) => itemIndex === index ? position : item);
  return { ...snapshot, positions };
}

/**
 * A snapshot loaded on the server can be older than a position delta that overtook it,
 * so for each route it keeps the newer of the two. Routes that left the snapshot drop out.
 */
function withNewerPositions(incoming: TrackingSnapshot, current: TrackingSnapshot): TrackingSnapshot {
  const known = new Map(current.positions.map((position) => [position.routeId, position]));
  return { ...incoming, positions: incoming.positions.map((position) => {
    const live = known.get(position.routeId);
    return live !== undefined && !isNewer(position, live) ? live : position;
  }) };
}

function isTrackingSnapshot(value: unknown): value is TrackingSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<TrackingSnapshot>;
  return Array.isArray(candidate.routes) && candidate.routes.every(isTrackingRoute) &&
    Array.isArray(candidate.orders) && candidate.orders.every(isTrackingOrder) &&
    Array.isArray(candidate.positions) && candidate.positions.every(isTrackingPosition);
}

function isTrackingRoute(value: unknown): value is TrackingRoute {
  if (typeof value !== 'object' || value === null) return false;
  const route = value as Partial<TrackingRoute>;
  return typeof route.id === 'string' && typeof route.publicCode === 'string' &&
    typeof route.plannedDate === 'string' && ['planned', 'in_progress', 'completed'].includes(String(route.status)) &&
    typeof route.driverId === 'string' && typeof route.vehicleId === 'string' &&
    Array.isArray(route.stops) && route.stops.every((stop) => typeof stop === 'object' && stop !== null &&
      typeof stop.id === 'string' && typeof stop.sequence === 'number' && typeof stop.addressLine === 'string' &&
      (stop.latitude === null || typeof stop.latitude === 'number') &&
      (stop.longitude === null || typeof stop.longitude === 'number') &&
      Array.isArray(stop.orderIds) && (stop.orderIds as unknown[]).every((id) => typeof id === 'string'));
}

function isTrackingOrder(value: unknown): value is TrackingOrder {
  if (typeof value !== 'object' || value === null) return false;
  const order = value as Partial<TrackingOrder>;
  return typeof order.id === 'string' && typeof order.publicCode === 'string' &&
    typeof order.status === 'string' && Object.hasOwn(ORDER_STATUS_LABELS, order.status);
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

/**
 * Driven path (fetched trail plus live positions) and pending path of the selected route.
 * A straight pending path starts again at the newest position, so it never lags behind the driver.
 */
export function toTrackCollection(track: SelectedTrack | null, liveTrail: readonly TrailPoint[]): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  if (track === null) return { type: 'FeatureCollection', features: [] };
  const traveled = [...track.traveled, ...liveTrail];
  const newest = traveled.at(-1);
  const pending = track.pendingSource === 'straight' && newest !== undefined && track.pending.length > 0
    ? [newest, ...track.pending.slice(1)] : track.pending;
  const line = (kind: 'traveled' | 'pending', points: readonly { latitude: number; longitude: number }[]) => {
    const coordinates = points.filter((point) => isCoordinate(point.longitude, point.latitude))
      .map((point) => [point.longitude, point.latitude]);
    return coordinates.length < 2 ? [] : [{
      type: 'Feature' as const, geometry: { type: 'LineString' as const, coordinates }, properties: { kind, routeId: track.routeId },
    }];
  };
  return { type: 'FeatureCollection', features: [...line('traveled', traveled), ...line('pending', pending)] };
}

function isCoordinate(longitude: number | null, latitude: number | null): longitude is number {
  return longitude !== null && latitude !== null && Number.isFinite(longitude) && Number.isFinite(latitude) &&
    longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
}
