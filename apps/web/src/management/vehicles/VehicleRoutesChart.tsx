import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from 'recharts';

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '../../components/ui/chart.js';
import type { MonthlyRoutes } from './vehicleStats.js';

const CONFIG = { routes: { label: 'Rutas', color: 'var(--primary)' } } satisfies ChartConfig;

/**
 * Rutas por mes de un vehículo. Una sola serie sobre un riel gris de altura completa: el mes en curso
 * va en el color principal con su valor encima y el resto en neutro; el tooltip da cada valor y la
 * tabla oculta sirve a lectores de pantalla. Se exporta por defecto para cargarlo con `lazy` y no
 * sumar recharts al paquete inicial.
 */
export default function VehicleRoutesChart({ data }: { readonly data: readonly MonthlyRoutes[] }) {
  const lastIndex = data.length - 1;
  const top = Math.max(1, ...data.map((item) => item.routes));
  // El riel es una segunda barra en un eje X oculto, para quedar justo debajo de la real: recharts
  // no dibuja `background` ni etiquetas en barras con valor 0, y el riel sí existe en todos los meses.
  const rows = data.map((item) => ({ ...item, track: top }));
  return (
    <>
      <ChartContainer config={CONFIG} className="aspect-auto h-64 w-full" aria-hidden="true">
        <BarChart data={rows} margin={{ top: 28, right: 4, left: 4, bottom: 0 }} barCategoryGap="22%">
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
          <XAxis xAxisId="track" dataKey="label" hide />
          <YAxis hide allowDecimals={false} domain={[0, top]} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent hideIndicator />} />
          <Bar xAxisId="track" dataKey="track" fill="color-mix(in oklch, var(--foreground) 6%, transparent)" radius={8} isAnimationActive={false} tooltipType="none">
            <LabelList dataKey="track" content={({ x, y, width, height, index }) => {
              const item = index === undefined ? undefined : data[index];
              if (index !== lastIndex || item === undefined || item.routes === 0) return null;
              // Encima de la barra real: el riel ocupa todo el alto, la barra solo su proporción.
              const barTop = Number(y) + Number(height) * (1 - item.routes / top);
              return (
                <text x={Number(x) + Number(width) / 2} y={barTop - 8} textAnchor="middle" className="fill-foreground text-xs font-semibold">
                  {item.routes}
                </text>
              );
            }} />
          </Bar>
          <Bar dataKey="routes" radius={8}>
            {rows.map((item, index) => (
              <Cell key={item.month} fill={index === lastIndex ? 'var(--color-routes)' : 'var(--muted-foreground)'}
                fillOpacity={index === lastIndex ? 1 : 0.35} />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>Rutas por mes</caption>
        <thead><tr><th scope="col">Mes</th><th scope="col">Rutas</th></tr></thead>
        <tbody>{data.map((item) => <tr key={item.month}><td>{item.label}</td><td>{item.routes}</td></tr>)}</tbody>
      </table>
    </>
  );
}
