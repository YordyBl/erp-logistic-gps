import type { FeatureCollection } from 'geojson';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import { OPENFREEMAP_STYLE } from '@/lib/mapStyle.js';

import { ago } from './format.js';
import type { PublicTracking } from './types.js';

type Route = NonNullable<PublicTracking['route']>;

const SOURCE = 'tracking';
const ROUTE_COLOR = '#0c7a4b';
const STALE_COLOR = '#8f9a93';
const DESTINATION_COLOR = '#16201a';

/**
 * Real map (MapLibre + OpenFreeMap, as in the control tower) with the route, the delivery
 * address and the driver. While the driver hands over another order, the driver is hidden.
 * MapLibre loads lazily, so the order status shows before the map is ready.
 */
export function RouteMap({ route, driverName, overlay }: {
  readonly route: Route;
  readonly driverName: string;
  /** Floating content over the top-left corner (the company card). */
  readonly overlay?: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const routeRef = useRef(route);
  routeRef.current = route;
  const [failed, setFailed] = useState(false);
  const { state, updatedAt } = route.driver;
  const hidden = state === 'at_other_stop';

  useEffect(() => {
    if (container.current === null) return;
    let disposed = false;
    void Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([maplibre]) => {
      if (disposed || container.current === null) return;
      maplibre.setWorkerUrl(maplibreWorkerUrl);
      const instance = new maplibre.Map({
        container: container.current,
        style: OPENFREEMAP_STYLE,
        bounds: boundsOf(routeRef.current),
        fitBoundsOptions: { padding: 56 },
        // On phones one finger scrolls the page; two fingers move the map.
        cooperativeGestures: true,
        attributionControl: { compact: true },
      });
      map.current = instance;
      instance.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      instance.on('load', () => {
        instance.addSource(SOURCE, { type: 'geojson', data: toGeoJson(routeRef.current) });
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
    const source = map.current?.getSource<GeoJSONSource>(SOURCE);
    source?.setData(toGeoJson(route));
  }, [route]);

  return (
    <div className="relative h-72 shrink-0 overflow-hidden bg-muted sm:h-96 lg:h-auto lg:min-w-0 lg:flex-1">
      {/* MapLibre's CSS makes this container position: relative; it takes the parent's full size. */}
      <div ref={container} className="size-full"
        role="img" aria-label={hidden ? `${driverName} está entregando otro pedido; su posición no se muestra` : 'Mapa con la ruta, tu dirección y la posición del motorizado'} />

      {overlay && <div className="absolute top-3 left-3 z-10 max-w-[calc(100%-4.5rem)]">{overlay}</div>}
      {failed && (
        <p className="absolute inset-x-3 top-20 rounded-lg bg-white/95 px-3 py-2 text-xs text-muted-foreground shadow-md">
          No se pudo cargar el mapa. El estado de tu pedido sigue actualizándose.
        </p>
      )}
      {hidden ? (
        <div className="absolute inset-x-3 bottom-8 rounded-lg bg-white/95 px-3 py-2 text-sm shadow-md lg:right-auto lg:max-w-sm">
          <strong className="font-semibold">{driverName} está entregando otro pedido.</strong>{' '}
          <span className="text-muted-foreground">Verás su posición cuando retome el camino.</span>
        </div>
      ) : !failed && (
        <span className="absolute bottom-8 left-3 flex items-center gap-1.5 rounded-full bg-white px-2.5 py-1 text-xs font-semibold shadow-md">
          <span className={`size-2 rounded-full ${state === 'stale' ? 'bg-[#8f9a93]' : 'bg-[#22b573]'}`} aria-hidden="true" />
          {state === 'stale' ? `Última posición conocida · ${ago(updatedAt)}` : `Última posición · ${ago(updatedAt)}`}
        </span>
      )}
    </div>
  );
}

function boundsOf(route: Route): [[number, number], [number, number]] {
  const points = [...route.path, route.destination, route.driver.at];
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}

function toGeoJson(route: Route): FeatureCollection {
  const features: FeatureCollection['features'] = [
    { type: 'Feature', properties: { kind: 'route' }, geometry: { type: 'LineString', coordinates: route.path.map(([lng, lat]) => [lng, lat]) } },
    { type: 'Feature', properties: { kind: 'destination' }, geometry: { type: 'Point', coordinates: [...route.destination] } },
  ];
  if (route.driver.state !== 'at_other_stop') {
    features.push({
      type: 'Feature',
      properties: { kind: 'driver', color: route.driver.state === 'stale' ? STALE_COLOR : ROUTE_COLOR },
      geometry: { type: 'Point', coordinates: [...route.driver.at] },
    });
  }
  return { type: 'FeatureCollection', features };
}
