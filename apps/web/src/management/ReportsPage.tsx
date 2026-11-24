import type { ColumnDef } from '@tanstack/react-table';
import { ChartColumn, Download, MapPinned, Package, PackageCheck, ShieldCheck, Timer, Undo2, UserRound } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useState } from 'react';

import type { ApiClient, OperationsReport, ReportKpis } from '../api/client.js';
import { SortableHeader } from '../components/data-table/columnHelpers.js';
import { DataTable } from '../components/data-table/DataTable.js';
import { KpiCard, type KpiChange } from '../components/KpiCard.js';
import { ErrorNotice } from '../components/Notices.js';
import { PageHeader } from '../components/PageHeader.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.js';
import { Checkbox } from '../components/ui/checkbox.js';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia } from '../components/ui/empty.js';
import { Label } from '../components/ui/label.js';
import { Skeleton } from '../components/ui/skeleton.js';
import { incidentCategoryLabel } from '../delivery/incidentCategories.js';
import { incidentIcon } from '../delivery/incidentIcons.js';
import { csvBlob, downloadBlob, type CsvCell } from '../lib/download.js';
import { formatDayRange, limaToday, REPORT_PRESETS, reportPeriods, type ReportPreset } from '../lib/reportPeriods.js';
import type { WeeklyOutcome } from './reports/WeeklyOutcomesChart.js';

const WeeklyOutcomesChart = lazy(() => import('./reports/WeeklyOutcomesChart.js'));

export type ReportsClient = Pick<ApiClient, 'getOperationsReport'>;

type District = OperationsReport['districts'][number];
type DriverRow = OperationsReport['drivers'][number];

const NUMBER = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });
const WEEK_LABEL = new Intl.DateTimeFormat('es-PE', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Porcentaje de `part` sobre `whole`; nulo si no hubo base. */
export function rate(part: number, whole: number): number | null {
  return whole === 0 ? null : (part / whole) * 100;
}

const formatRate = (value: number | null) => (value === null ? '—' : `${NUMBER.format(value)} %`);
/** Menos de un minuto se muestra en segundos, para no redondear a «0 min». */
const formatMinutes = (seconds: number | null) => {
  if (seconds === null) return '—';
  if (seconds < 60) return `${Math.round(seconds).toLocaleString('es-PE')} s`;
  return `${NUMBER.format(Math.round(seconds / 6) / 10)} min`;
};

/** Variación de un conteo en %, o de una tasa en puntos. `higherIsBetter` decide el color. */
function change(current: number | null, previous: number | null, unit: 'percent' | 'points' | 'minutes', higherIsBetter: boolean): KpiChange {
  if (current === null || previous === null || (unit === 'percent' && previous === 0)) {
    return { text: 'Sin base en el periodo anterior', direction: 'flat', tone: 'neutral' };
  }
  const delta = unit === 'percent' ? ((current - previous) / previous) * 100 : current - previous;
  const rounded = Math.round(delta * 10) / 10;
  if (rounded === 0) return { text: 'Igual que el periodo anterior', direction: 'flat', tone: 'neutral' };
  const suffix = unit === 'percent' ? ' %' : unit === 'points' ? ' pts' : ' min';
  const sign = rounded > 0 ? '+' : '−';
  return {
    text: `${sign}${NUMBER.format(Math.abs(rounded))}${suffix} vs. periodo anterior`,
    direction: rounded > 0 ? 'up' : 'down',
    tone: (rounded > 0) === higherIsBetter ? 'better' : 'worse',
  };
}

interface KpiValues {
  readonly orders: number;
  readonly firstAttempt: number | null;
  readonly returned: number | null;
  readonly stopMinutes: number | null;
}

function kpiValues(kpis: ReportKpis): KpiValues {
  return {
    orders: kpis.orders,
    firstAttempt: rate(kpis.firstAttemptDelivered, kpis.firstAttempts),
    returned: rate(kpis.returned, kpis.closedAttempts),
    stopMinutes: kpis.avgStopSeconds === null ? null : kpis.avgStopSeconds / 60,
  };
}

const DISTRICT_COLUMNS: readonly ColumnDef<District, unknown>[] = [
  { accessorKey: 'district', header: ({ column }) => <SortableHeader column={column} title="Distrito" />, enableHiding: false },
  {
    accessorKey: 'orders', header: ({ column }) => <SortableHeader column={column} title="Pedidos" />, meta: { title: 'Pedidos' },
    cell: ({ row }) => <span className="tabular-nums">{row.original.orders.toLocaleString('es-PE')}</span>,
  },
  {
    id: 'firstAttempt', accessorFn: (row) => rate(row.firstAttemptDelivered, row.firstAttempts) ?? -1,
    header: ({ column }) => <SortableHeader column={column} title="Primer intento" />, meta: { title: 'Primer intento' },
    cell: ({ row }) => <span className="tabular-nums">{formatRate(rate(row.original.firstAttemptDelivered, row.original.firstAttempts))}</span>,
  },
  {
    id: 'returned', accessorFn: (row) => rate(row.returned, row.closedAttempts) ?? -1,
    header: ({ column }) => <SortableHeader column={column} title="Devueltos" />, meta: { title: 'Devueltos' },
    cell: ({ row }) => <span className="tabular-nums">{formatRate(rate(row.original.returned, row.original.closedAttempts))}</span>,
  },
];

const DRIVER_COLUMNS: readonly ColumnDef<DriverRow, unknown>[] = [
  { accessorKey: 'fullName', header: ({ column }) => <SortableHeader column={column} title="Conductor" />, enableHiding: false },
  {
    accessorKey: 'routes', header: ({ column }) => <SortableHeader column={column} title="Rutas" />, meta: { title: 'Rutas' },
    cell: ({ row }) => <span className="tabular-nums">{row.original.routes.toLocaleString('es-PE')}</span>,
  },
  {
    accessorKey: 'deliveries', header: ({ column }) => <SortableHeader column={column} title="Entregas" />, meta: { title: 'Entregas' },
    cell: ({ row }) => <span className="tabular-nums">{row.original.deliveries.toLocaleString('es-PE')}</span>,
  },
  {
    id: 'firstAttempt', accessorFn: (row) => rate(row.firstAttemptDelivered, row.firstAttempts) ?? -1,
    header: ({ column }) => <SortableHeader column={column} title="Primer intento" />, meta: { title: 'Primer intento' },
    cell: ({ row }) => <span className="tabular-nums">{formatRate(rate(row.original.firstAttemptDelivered, row.original.firstAttempts))}</span>,
  },
];

export function ReportsPage({ client, today }: {
  readonly client: ReportsClient;
  /** Día de Lima que cierra los periodos; por defecto, hoy. */
  readonly today?: string;
}) {
  const [preset, setPreset] = useState<ReportPreset>('month');
  const [includeSimulated, setIncludeSimulated] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [report, setReport] = useState<OperationsReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const periods = useMemo(() => reportPeriods(preset, today ?? limaToday()), [preset, today]);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    client.getOperationsReport({
      from: periods.period.from, to: periods.period.to,
      compareFrom: periods.comparison.from, compareTo: periods.comparison.to, includeSimulated,
    }, controller.signal)
      .then((next) => setReport(next))
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [client, periods, includeSimulated, reloadKey]);

  const description = `${formatDayRange(periods.period)} · comparado con ${formatDayRange(periods.comparison)}`;

  return (
    <section className="flex flex-col gap-6" aria-busy={loading}>
      <PageHeader title="Reportes" description={description}>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Periodo" className="flex flex-wrap gap-1">
            {REPORT_PRESETS.map((option) => (
              <Button key={option.value} type="button" variant={preset === option.value ? 'secondary' : 'ghost'}
                aria-pressed={preset === option.value} onClick={() => setPreset(option.value)}>
                {option.label}
              </Button>
            ))}
          </div>
          <Button type="button" variant="outline" disabled={report === null} onClick={() => report !== null && exportReport(report)}>
            <Download data-icon="inline-start" aria-hidden="true" /> Exportar CSV
          </Button>
        </div>
      </PageHeader>

      {failed && (
        <ErrorNotice action={<Button variant="outline" className="mt-2" onClick={() => setReloadKey((key) => key + 1)}>Reintentar</Button>}>
          No se pudo cargar el reporte. Revisa la conexión e inténtalo de nuevo.
        </ErrorNotice>
      )}

      {report === null && loading && <ReportSkeleton />}

      {report !== null && (
        <>
          <SimulatedToggle report={report} checked={includeSimulated} onChange={setIncludeSimulated} />
          <KpiGrid report={report} />

          <div className="grid gap-4 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle><h2>Pedidos por semana</h2></CardTitle>
                <CardDescription>Entregas, devoluciones y cancelaciones de las últimas 8 semanas.</CardDescription>
              </CardHeader>
              <CardContent>
                {report.weekly.every((week) => week.delivered + week.returned + week.cancelled === 0)
                  ? <ReportEmpty icon={ChartColumn}>Sin entregas, devoluciones ni cancelaciones en estas 8 semanas.</ReportEmpty>
                  : (
                    <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                      <WeeklyOutcomesChart data={weeklyRows(report)} />
                    </Suspense>
                  )}
              </CardContent>
            </Card>
            <IncidentsCard report={report} />
          </div>

          <div className="grid gap-6 xl:grid-cols-2">
            <section aria-labelledby="report-districts" className="flex min-w-0 flex-col gap-3">
              <h2 id="report-districts" className="text-base font-semibold">Por distrito</h2>
              {report.districts.length === 0
                ? <ReportEmpty icon={MapPinned}>Sin entregas cerradas en el periodo.</ReportEmpty>
                : <DataTable label="Resultados por distrito" columns={DISTRICT_COLUMNS} data={report.districts} searchPlaceholder="Buscar distrito" pageSize={5} />}
            </section>
            <section aria-labelledby="report-drivers" className="flex min-w-0 flex-col gap-3">
              <h2 id="report-drivers" className="text-base font-semibold">Por conductor</h2>
              {report.drivers.length === 0
                ? <ReportEmpty icon={UserRound}>Sin entregas cerradas en el periodo.</ReportEmpty>
                : <DataTable label="Resultados por conductor" columns={DRIVER_COLUMNS} data={report.drivers} searchPlaceholder="Buscar conductor" pageSize={5} />}
            </section>
          </div>
        </>
      )}
    </section>
  );
}

function SimulatedToggle({ report, checked, onChange }: {
  readonly report: OperationsReport;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  const simulated = report.kpis.simulatedAttempts;
  if (simulated === 0 && !checked) return null;
  const count = simulated.toLocaleString('es-PE');
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm">
      <Checkbox id="include-simulated" checked={checked} onCheckedChange={(value) => onChange(value === true)} className="mt-0.5" />
      <div className="flex flex-col gap-0.5">
        <Label htmlFor="include-simulated">Incluir entregas del simulador</Label>
        <p className="text-muted-foreground">
          {checked
            ? `Las cifras incluyen ${count} ${simulated === 1 ? 'entrega simulada' : 'entregas simuladas'} del modo demostración.`
            : `Hay ${count} ${simulated === 1 ? 'entrega simulada' : 'entregas simuladas'} en el periodo; no se cuentan en las cifras.`}
        </p>
      </div>
    </div>
  );
}

function KpiGrid({ report }: { readonly report: OperationsReport }) {
  const current = kpiValues(report.kpis);
  const previous = report.comparisonKpis === null ? null : kpiValues(report.comparisonKpis);
  const { kpis } = report;
  return (
    <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Indicadores del periodo">
      <KpiCard className="" icon={Package} tone="primary" label="Pedidos" value={current.orders}
        change={change(current.orders, previous?.orders ?? null, 'percent', true)} detail="Registrados en el periodo" />
      <KpiCard className="" icon={PackageCheck} tone="success" label="Entregados al primer intento" value={formatRate(current.firstAttempt)}
        change={change(current.firstAttempt, previous?.firstAttempt ?? null, 'points', true)}
        detail={kpis.firstAttempts === 0 ? 'Sin primeros intentos cerrados' : `${kpis.firstAttemptDelivered.toLocaleString('es-PE')} de ${kpis.firstAttempts.toLocaleString('es-PE')} primeros intentos`} />
      <KpiCard className="" icon={Undo2} tone={kpis.returned > 0 ? 'destructive' : 'neutral'} label="Devueltos" value={formatRate(current.returned)}
        change={change(current.returned, previous?.returned ?? null, 'points', false)}
        detail={kpis.closedAttempts === 0 ? 'Sin intentos cerrados' : `${kpis.returned.toLocaleString('es-PE')} de ${kpis.closedAttempts.toLocaleString('es-PE')} intentos cerrados`} />
      <KpiCard className="" icon={Timer} tone="neutral" label="Tiempo medio por parada" value={formatMinutes(kpis.avgStopSeconds)}
        change={change(current.stopMinutes, previous?.stopMinutes ?? null, 'minutes', false)}
        detail={kpis.timedStops === 0 ? 'Sin paradas cerradas' : `${kpis.timedStops.toLocaleString('es-PE')} ${kpis.timedStops === 1 ? 'parada medida' : 'paradas medidas'}`} />
    </ul>
  );
}

function IncidentsCard({ report }: { readonly report: OperationsReport }) {
  const top = Math.max(1, ...report.incidents.map((incident) => incident.count));
  const total = report.incidents.reduce((sum, incident) => sum + incident.count, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle><h2>Incidencias por motivo</h2></CardTitle>
        <CardDescription>{total === 0 ? 'Reportadas por los conductores en el periodo.' : `${total.toLocaleString('es-PE')} ${total === 1 ? 'incidencia' : 'incidencias'} en el periodo.`}</CardDescription>
      </CardHeader>
      <CardContent>
        {report.incidents.length === 0
          ? <ReportEmpty icon={ShieldCheck}>{report.kpis.delivered > 0 ? `Sin incidencias en ${report.kpis.delivered.toLocaleString('es-PE')} entregas del periodo.` : 'Sin incidencias en el periodo.'}</ReportEmpty>
          : (
            <ul className="flex flex-col gap-3" aria-label="Incidencias por motivo">
              {report.incidents.map((incident) => {
                const Icon = incidentIcon(incident.category);
                return (
                  <li key={incident.category} className="flex flex-col gap-1.5 text-sm">
                    <span className="flex items-center justify-between gap-2">
                      <span className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" aria-hidden="true" />{incidentCategoryLabel(incident.category)}</span>
                      <span className="font-medium tabular-nums">{incident.count.toLocaleString('es-PE')}</span>
                    </span>
                    <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                      <span className="block h-full rounded-full bg-destructive/80" style={{ width: `${(incident.count / top) * 100}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
      </CardContent>
    </Card>
  );
}

function ReportEmpty({ icon: Icon, children }: { readonly icon: typeof Package; readonly children: string }) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Icon aria-hidden="true" /></EmptyMedia>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" role="status" aria-label="Cargando reporte">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-28 w-full" />)}
      </div>
      <Skeleton className="h-80 w-full" />
    </div>
  );
}

function weeklyRows(report: OperationsReport): readonly WeeklyOutcome[] {
  return report.weekly.map((week) => ({ ...week, label: WEEK_LABEL.format(new Date(`${week.weekStart}T00:00:00Z`)) }));
}

/** CSV con el periodo, los indicadores y cada tabla del reporte, listo para Excel. */
export function reportCsvRows(report: OperationsReport): readonly (readonly CsvCell[])[] {
  const { kpis } = report;
  const pct = (value: number | null) => (value === null ? null : Math.round(value * 10) / 10);
  const rows: CsvCell[][] = [
    ['Reporte de operación'],
    ['Periodo', report.period.from, report.period.to],
    ...(report.comparison === null ? [] : [['Comparado con', report.comparison.from, report.comparison.to]]),
    ['Incluye entregas simuladas', report.includeSimulated ? 'Sí' : 'No'],
    [],
    ['Indicador', 'Valor', 'Base'],
    ['Pedidos registrados', kpis.orders, null],
    ['Entregados al primer intento (%)', pct(rate(kpis.firstAttemptDelivered, kpis.firstAttempts)), kpis.firstAttempts],
    ['Devueltos (%)', pct(rate(kpis.returned, kpis.closedAttempts)), kpis.closedAttempts],
    ['Tiempo medio por parada (min)', kpis.avgStopSeconds === null ? null : Math.round(kpis.avgStopSeconds / 6) / 10, kpis.timedStops],
    [],
    ['Por distrito'],
    ['Distrito', 'Pedidos', 'Primer intento (%)', 'Devueltos (%)'],
    ...report.districts.map((row) => [row.district, row.orders, pct(rate(row.firstAttemptDelivered, row.firstAttempts)), pct(rate(row.returned, row.closedAttempts))]),
    [],
    ['Por conductor'],
    ['Conductor', 'Rutas', 'Entregas', 'Primer intento (%)'],
    ...report.drivers.map((row) => [row.fullName, row.routes, row.deliveries, pct(rate(row.firstAttemptDelivered, row.firstAttempts))]),
    [],
    ['Incidencias por motivo'],
    ['Motivo', 'Incidencias'],
    ...report.incidents.map((row) => [incidentCategoryLabel(row.category), row.count]),
    [],
    ['Pedidos por semana'],
    ['Semana (lunes)', 'Entregados', 'Devueltos', 'Cancelados'],
    ...report.weekly.map((week) => [week.weekStart, week.delivered, week.returned, week.cancelled]),
  ];
  return rows;
}

function exportReport(report: OperationsReport): void {
  downloadBlob(csvBlob(reportCsvRows(report)), `reporte-${report.period.from}-${report.period.to}.csv`);
}
