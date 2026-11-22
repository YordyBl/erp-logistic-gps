import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { useEffect, useMemo, useRef } from 'react';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

import { OPENFREEMAP_STYLE } from '../ControlTowerPage.js';
import type { StopState } from '../routes/routeProgress.js';

const DATA_SOURCE = 'operations-map-data';
const STOP_COLORS: Record<StopState, string> = {
  done: '#0c7a4b',
  issue: '#b4232f',
  current: '#ef8b36',
  pending: '#ef8b36',
};

export interface MapRoute {
  readonly id: string;
  readonly stops: readonly {
    readonly latitude: number;
    readonly longitude: number;
    readonly sequence: number;
    readonly state: StopState;
  }[];
  readonly position: { readonly latitude: number; readonly longitude: number } | null;
}

/** Mapa de solo lectura del Resumen. La línea une las paradas en orden; no es el trazado real por calles. */
export function OperationsMap({ routes, onUnavailable }: {
  readonly routes: readonly MapRoute[];
  readonly onUnavailable: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loaded = useRef(false);
  const unavailable = useRef(onUnavailable);
  unavailable.current = onUnavailable;

  const data = useMemo(() => toFeatures(routes), [routes]);
  const dataRef = useRef(data);
  dataRef.current = data;

  useEffect(() => {
    if (container.current === null) return;
    let disposed = false;
    let map: MapLibreMap | undefined;
    void Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([maplibre]) => {
      if (disposed || container.current === null) return;
      maplibre.setWorkerUrl(maplibreWorkerUrl);
      map = new maplibre.Map({
        container: container.current, style: OPENFREEMAP_STYLE, center: [-77.04, -12.05], zoom: 10,
        attributionControl: { compact: true },
      });
      mapRef.current = map;
      map.scrollZoom.disable();
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-right');
      map.on('load', () => {
        const current = map;
        if (current === undefined) return;
        current.addSource(DATA_SOURCE, { type: 'geojson', data: dataRef.current });
        current.addLayer({
          id: 'operations-sequence', type: 'line', source: DATA_SOURCE, filter: ['==', ['get', 'kind'], 'sequence'],
          paint: { 'line-color': '#0c7a4b', 'line-width': 2, 'line-dasharray': [2, 2] },
        });
        current.addLayer({
          id: 'operations-stops', type: 'circle', source: DATA_SOURCE, filter: ['==', ['get', 'kind'], 'stop'],
          paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
        });
        loaded.current = true;
        fitToData(current, dataRef.current);
        const marker = new Image();
        marker.onload = () => {
          if (disposed) return;
          current.addImage('operations-motorcycle', marker, { pixelRatio: 2 });
          current.addLayer({
            id: 'operations-positions', type: 'symbol', source: DATA_SOURCE, filter: ['==', ['get', 'kind'], 'position'],
            layout: { 'icon-image': 'operations-motorcycle', 'icon-size': 0.75, 'icon-allow-overlap': true },
          });
        };
        marker.src = '/motorcycle-marker.svg';
      });
      map.on('error', () => unavailable.current());
    }).catch(() => unavailable.current());
    return () => {
      disposed = true;
      loaded.current = false;
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!loaded.current || mapRef.current === null) return;
    (mapRef.current.getSource(DATA_SOURCE) as GeoJSONSource | undefined)?.setData(data);
    fitToData(mapRef.current, data);
  }, [data]);

  return <div ref={container} className="size-full" role="img" aria-label="Mapa de paradas y última posición de las rutas en curso" />;
}

function fitToData(map: MapLibreMap, data: GeoJSON.FeatureCollection): void {
  const points = data.features.flatMap((feature) => {
    if (feature.geometry.type === 'Point') return [feature.geometry.coordinates];
    return feature.geometry.type === 'LineString' ? feature.geometry.coordinates : [];
  });
  if (points.length === 0) return;
  const longitudes = points.map((point) => point[0] ?? 0);
  const latitudes = points.map((point) => point[1] ?? 0);
  map.fitBounds(
    [[Math.min(...longitudes), Math.min(...latitudes)], [Math.max(...longitudes), Math.max(...latitudes)]],
    { padding: 56, maxZoom: 14, animate: false },
  );
}

function toFeatures(routes: readonly MapRoute[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const route of routes) {
    if (route.stops.length > 1) {
      features.push({
        type: 'Feature', properties: { kind: 'sequence' },
        geometry: { type: 'LineString', coordinates: route.stops.map((stop) => [stop.longitude, stop.latitude]) },
      });
    }
    for (const stop of route.stops) {
      features.push({
        type: 'Feature', properties: { kind: 'stop', color: STOP_COLORS[stop.state] },
        geometry: { type: 'Point', coordinates: [stop.longitude, stop.latitude] },
      });
    }
    if (route.position !== null) {
      features.push({
        type: 'Feature', properties: { kind: 'position' },
        geometry: { type: 'Point', coordinates: [route.position.longitude, route.position.latitude] },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
