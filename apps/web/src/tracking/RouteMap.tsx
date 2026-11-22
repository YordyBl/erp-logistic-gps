import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, LngLatBoundsLike, Map as MapLibreMap } from 'maplibre-gl';
import { WifiOff } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import { OPENFREEMAP_STYLE } from '@/lib/mapStyle.js';

import { ago } from './format.js';
import type { MapPoint, PublicTracking } from './types.js';

type Driver = NonNullable<PublicTracking['route']>['driver'];

const SOURCE = 'tracking';
const ROUTE_COLOR = '#0c7a4b';
const STALE_COLOR = '#8f9a93';
const DESTINATION_COLOR = '#16201a';
const DESTINATION_ZOOM = 15;

interface RouteMapProps {
  readonly destination: MapPoint;
  /** Route still to drive and the driver; absent before departure or once the order is closed. */
  readonly path?: readonly MapPoint[];
  readonly driver?: Driver;
  readonly driverName?: string;
  /** Floating content over the top-left corner (the company card). */
  readonly overlay?: ReactNode;
}

/**
 * Real map (MapLibre + OpenFreeMap, as in the control tower). Shows the delivery address and,
 * while the route is in progress, the path and the driver. While the driver hands over another
 * order the driver is hidden. MapLibre loads lazily, so the order status shows first.
 */
export function RouteMap({ destination, path, driver, driverName = 'El motorizado', overlay }: RouteMapProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const latest = useRef({ destination, path, driver });
  latest.current = { destination, path, driver };
  const [failed, setFailed] = useState(false);
  const hidden = driver?.state === 'at_other_stop';

  useEffect(() => {
    if (container.current === null) return;
    let disposed = false;
    void Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([maplibre]) => {
      if (disposed || container.current === null) return;
      maplibre.setWorkerUrl(maplibreWorkerUrl);
      const { destination: target, path: line, driver: who } = latest.current;
      const instance = new maplibre.Map({
        container: container.current,
        style: OPENFREEMAP_STYLE,
        ...(line && line.length > 1
          ? { bounds: boundsOf([...line, target, ...(who ? [who.at] : [])]), fitBoundsOptions: { padding: 64 } }
          : { center: [target[0], target[1]] as [number, number], zoom: DESTINATION_ZOOM }),
        // On phones one finger scrolls the page; two fingers move the map.
        cooperativeGestures: true,
        attributionControl: { compact: true },
      });
      map.current = instance;
      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      instance.on('load', () => {
        instance.addSource(SOURCE, { type: 'geojson', data: toGeoJson(latest.current) });
        instance.addLayer({
          id: 'tracking-route', type: 'line', source: SOURCE, filter: ['==', ['get', 'kind'], 'route'],
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': ROUTE_COLOR, 'line-width': 5, 'line-opacity': 0.85 },
        });
        instance.addLayer({
          id: 'tracking-destination', type: 'circle', source: SOURCE, filter: ['==', ['get', 'kind'], 'destination'],
          paint: { 'circle-radius': 9, 'circle-color': DESTINATION_COLOR, 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
        });
        instance.addLayer({
          id: 'tracking-driver-halo', type: 'circle', source: SOURCE, filter: ['==', ['get', 'kind'], 'driver'],
          paint: { 'circle-radius': 18, 'circle-color': ['get', 'color'], 'circle-opacity': 0.2 },
        });
        instance.addLayer({
          id: 'tracking-driver', type: 'circle', source: SOURCE, filter: ['==', ['get', 'kind'], 'driver'],
          paint: { 'circle-radius': 9, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 3 },
        });
      });
      instance.on('error', () => setFailed(true));
    }).catch(() => setFailed(true));
    return () => {
      disposed = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Each refresh moves the driver (or hides it) without rebuilding the map.
  useEffect(() => {
    map.current?.getSource<GeoJSONSource>(SOURCE)?.setData(toGeoJson({ destination, path, driver }));
  }, [destination, path, driver]);

  const label = hidden
    ? `${driverName} está entregando otro pedido; su posición no se muestra`
    : driver?.state === 'stale' ? `Mapa con la ruta y la última posición conocida de ${driverName}, sin señal`
    : driver ? 'Mapa con la ruta, tu dirección y la posición del motorizado' : 'Mapa con tu dirección de entrega';

  return (
    <div className="relative h-72 shrink-0 overflow-hidden bg-muted sm:h-96 md:h-auto md:min-w-0 md:flex-1">
      {/* MapLibre's CSS makes this container position: relative; it takes the parent's full size. */}
      <div ref={container} className="size-full" role="img" aria-label={label} />

      {overlay && <div className="absolute top-3 left-3 z-10 max-w-[calc(100%-4.5rem)]">{overlay}</div>}
      {failed && (
        <p className="absolute inset-x-3 top-20 rounded-lg bg-white/95 px-3 py-2 text-xs text-muted-foreground shadow-md">
          No se pudo cargar el mapa. El estado de tu pedido sigue actualizándose.
        </p>
      )}
      {hidden && (
        <div className="absolute inset-x-3 bottom-8 rounded-lg bg-white/95 px-3 py-2 text-sm shadow-md md:right-auto md:max-w-sm">
          <strong className="font-semibold">{driverName} está entregando otro pedido.</strong>{' '}
          <span className="text-muted-foreground">Verás su posición cuando retome el camino.</span>
        </div>
      )}
      {driver?.state === 'stale' && (
        <div className="absolute inset-x-3 bottom-8 flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 shadow-md md:right-auto md:max-w-sm">
          <WifiOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span><strong className="font-semibold">Sin señal desde {ago(driver.updatedAt)}.</strong> El punto gris es la última posición conocida de {driverName}; puede estar más adelante.</span>
        </div>
      )}
      {driver?.state === 'moving' && !failed && (
        <span className="absolute bottom-8 left-3 flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold shadow-md">
          <span className="size-2 rounded-full bg-[#22b573]" aria-hidden="true" />
          Última posición · {ago(driver.updatedAt)}
        </span>
      )}
    </div>
  );
}

function boundsOf(points: readonly MapPoint[]): LngLatBoundsLike {
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

function toGeoJson({ destination, path, driver }: Pick<RouteMapProps, 'destination' | 'path' | 'driver'>): FeatureCollection {
  const features: FeatureCollection['features'] = [
    { type: 'Feature', properties: { kind: 'destination' }, geometry: { type: 'Point', coordinates: [...destination] } },
  ];
  if (path && path.length > 1) {
    features.unshift({ type: 'Feature', properties: { kind: 'route' }, geometry: { type: 'LineString', coordinates: path.map(([lng, lat]) => [lng, lat]) } });
  }
  if (driver && driver.state !== 'at_other_stop') {
    features.push({
      type: 'Feature',
      properties: { kind: 'driver', color: driver.state === 'stale' ? STALE_COLOR : ROUTE_COLOR },
      geometry: { type: 'Point', coordinates: [...driver.at] },
    });
  }
  return { type: 'FeatureCollection', features };
}
