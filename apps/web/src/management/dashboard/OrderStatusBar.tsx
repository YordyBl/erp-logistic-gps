import type { DispatchDashboardSummary } from '../../api/client.js';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip.js';
import { ORDER_STATUS_LABELS } from '../../delivery/orderStatus.js';
import { STATUS_COLORS, STATUS_ORDER, totalOrders } from './orderStatus.js';

/**
 * Siete estados se leen mejor como barra apilada con leyenda que como rosquilla: las proporciones
 * comparten una misma línea base y cada cifra queda alineada al lado de su nombre.
 */
export function OrderStatusBar({ counts }: { readonly counts: DispatchDashboardSummary['orderStatusCounts'] }) {
  const total = totalOrders(counts);

  return (
    <div className="flex flex-col gap-4">
      <TooltipProvider delayDuration={100}>
        <div className="flex h-3 gap-0.5" aria-hidden="true">
          {STATUS_ORDER.filter((status) => counts[status] > 0).map((status) => (
            <Tooltip key={status}>
              <TooltipTrigger asChild>
                <span className="min-w-1 rounded-sm" style={{ flexGrow: counts[status], background: STATUS_COLORS[status] }} />
              </TooltipTrigger>
              <TooltipContent>{ORDER_STATUS_LABELS[status]}: {counts[status].toLocaleString('es-PE')} de {total.toLocaleString('es-PE')}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      </TooltipProvider>
      <ul className="flex flex-col gap-2 text-sm">
        {STATUS_ORDER.map((status) => (
          <li key={status} className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: STATUS_COLORS[status] }} aria-hidden="true" />
            <span className="flex-1">{ORDER_STATUS_LABELS[status]}</span>
            <span className="text-muted-foreground tabular-nums">{Math.round((counts[status] / total) * 100)} %</span>
            <strong className="w-8 text-right font-medium tabular-nums">{counts[status].toLocaleString('es-PE')}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
