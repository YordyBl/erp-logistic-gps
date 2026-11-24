import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts';

import {
  ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig,
} from '../../components/ui/chart.js';
import { STATUS_COLORS } from '../dashboard/orderStatus.js';

export interface WeeklyOutcome {
  readonly weekStart: string;
  readonly label: string;
  readonly delivered: number;
  readonly returned: number;
  readonly cancelled: number;
}

// Cancelado va entre Entregado y Devuelto, como en la barra de estados del Resumen.
const CONFIG = {
  delivered: { label: 'Entregados', color: STATUS_COLORS.delivered },
  cancelled: { label: 'Cancelados', color: STATUS_COLORS.cancelled },
  returned: { label: 'Devueltos', color: STATUS_COLORS.returned },
} satisfies ChartConfig;

/**
 * Resultados por semana apilados con los colores fijos de cada estado. La tabla oculta sirve a
 * lectores de pantalla. Se exporta por defecto para cargarlo con `lazy`.
 */
export default function WeeklyOutcomesChart({ data }: { readonly data: readonly WeeklyOutcome[] }) {
  return (
    <>
      <ChartContainer config={CONFIG} className="aspect-auto h-64 w-full" aria-hidden="true">
        <BarChart data={[...data]} margin={{ top: 8, right: 4, left: -16, bottom: 0 }} barCategoryGap="24%">
          <CartesianGrid vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} interval="preserveStartEnd" />
          <YAxis tickLine={false} axisLine={false} allowDecimals={false} width={44} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          {/* Sin ordenar: la leyenda sigue el apilado (entregados, cancelados, devueltos). */}
          <ChartLegend itemSorter={null} content={<ChartLegendContent />} />
          <Bar dataKey="delivered" stackId="outcomes" fill="var(--color-delivered)" />
          <Bar dataKey="cancelled" stackId="outcomes" fill="var(--color-cancelled)" />
          <Bar dataKey="returned" stackId="outcomes" fill="var(--color-returned)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ChartContainer>
      <table className="sr-only">
        <caption>Pedidos por semana</caption>
        <thead>
          <tr><th scope="col">Semana</th><th scope="col">Entregados</th><th scope="col">Cancelados</th><th scope="col">Devueltos</th></tr>
        </thead>
        <tbody>
          {data.map((week) => (
            <tr key={week.weekStart}><td>{week.label}</td><td>{week.delivered}</td><td>{week.cancelled}</td><td>{week.returned}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
