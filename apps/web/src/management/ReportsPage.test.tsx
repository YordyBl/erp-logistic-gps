/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OperationsReport, ReportKpis } from '../api/client.js';
import { toCsv } from '../lib/download.js';
import { setupUser } from '../test/ui.js';
import { rate, reportCsvRows, ReportsPage, type ReportsClient } from './ReportsPage.js';

vi.mock('./reports/WeeklyOutcomesChart.js', () => ({
  default: ({ data }: { data: readonly { label: string; delivered: number }[] }) => (
    <ol aria-label="Gráfico semanal">{data.map((week) => <li key={week.label}>{week.label}: {week.delivered}</li>)}</ol>
  ),
}));

const KPIS: ReportKpis = {
  orders: 120, closedAttempts: 100, delivered: 90, returned: 10, firstAttempts: 95, firstAttemptDelivered: 86,
  avgStopSeconds: 660, timedStops: 80, simulatedAttempts: 0,
};

function makeReport(overrides: Partial<OperationsReport> = {}): OperationsReport {
  return {
    period: { from: '2026-11-01', to: '2026-11-18' },
    comparison: { from: '2026-10-01', to: '2026-10-18' },
    includeSimulated: false,
    kpis: KPIS,
    comparisonKpis: { ...KPIS, orders: 100, firstAttemptDelivered: 80, avgStopSeconds: 780 },
    weekly: [
      { weekStart: '2026-11-09', delivered: 40, returned: 4, cancelled: 1 },
      { weekStart: '2026-11-16', delivered: 50, returned: 6, cancelled: 0 },
    ],
    incidents: [{ category: 'recipient_absent', count: 6 }, { category: 'incorrect_address', count: 4 }],
    districts: [{ district: 'Callao', orders: 40, firstAttempts: 38, firstAttemptDelivered: 30, closedAttempts: 40, returned: 6 }],
    drivers: [{ driverId: 'driver-1', fullName: 'María Rojas', routes: 4, deliveries: 45, firstAttempts: 46, firstAttemptDelivered: 44, closedAttempts: 47, returned: 2 }],
    ...overrides,
  };
}

function makeClient(report: OperationsReport = makeReport()) {
  return { getOperationsReport: vi.fn().mockResolvedValue(report) } satisfies ReportsClient;
}

afterEach(cleanup);

describe('ReportsPage', () => {
  it('asks for the month to date against the same stretch of the previous month', async () => {
    const client = makeClient();
    render(<ReportsPage client={client} today="2026-11-18" />);

    expect(await screen.findByText('1 al 18 de noviembre · comparado con 1 al 18 de octubre')).toBeTruthy();
    expect(client.getOperationsReport).toHaveBeenCalledWith({
      from: '2026-11-01', to: '2026-11-18', compareFrom: '2026-10-01', compareTo: '2026-10-18', includeSimulated: false,
    }, expect.any(AbortSignal));
  });

  it('shows the four indicators with their base and change', async () => {
    render(<ReportsPage client={makeClient()} today="2026-11-18" />);

    const kpis = await screen.findByRole('list', { name: 'Indicadores del periodo' });
    expect(within(kpis).getByText('120')).toBeTruthy();
    expect(within(kpis).getByText('+20 % vs. periodo anterior')).toBeTruthy();
    expect(within(kpis).getByText(/90[.,]5 %/)).toBeTruthy();
    expect(within(kpis).getByText('86 de 95 primeros intentos')).toBeTruthy();
    expect(within(kpis).getByText('10 %')).toBeTruthy();
    expect(within(kpis).getByText('11 min')).toBeTruthy();
    expect(within(kpis).getByText('−2 min vs. periodo anterior')).toBeTruthy();
  });

  it('lists incidents, districts and drivers', async () => {
    render(<ReportsPage client={makeClient()} today="2026-11-18" />);

    const incidents = await screen.findByRole('list', { name: 'Incidencias por motivo' });
    expect(within(incidents).getByText('Destinatario ausente')).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'Resultados por distrito' })).getByText('Callao')).toBeTruthy();
    expect(within(screen.getByRole('table', { name: 'Resultados por conductor' })).getByText('María Rojas')).toBeTruthy();
    expect(await screen.findByRole('list', { name: 'Gráfico semanal' })).toBeTruthy();
  });

  it('changes period with the segmented control', async () => {
    const user = setupUser();
    const client = makeClient();
    render(<ReportsPage client={client} today="2026-11-18" />);
    await screen.findByRole('list', { name: 'Indicadores del periodo' });

    await user.click(screen.getByRole('button', { name: '7 días' }));

    await waitFor(() => expect(client.getOperationsReport).toHaveBeenLastCalledWith({
      from: '2026-11-12', to: '2026-11-18', compareFrom: '2026-11-05', compareTo: '2026-11-11', includeSimulated: false,
    }, expect.any(AbortSignal)));
    expect(screen.getByRole('button', { name: '7 días' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('offers simulator completions only when the period has them', async () => {
    const user = setupUser();
    const client = makeClient(makeReport({ kpis: { ...KPIS, simulatedAttempts: 75 } }));
    render(<ReportsPage client={client} today="2026-11-18" />);

    expect(await screen.findByText('Hay 75 entregas simuladas en el periodo; no se cuentan en las cifras.')).toBeTruthy();
    await user.click(screen.getByLabelText('Incluir entregas del simulador'));

    await waitFor(() => expect(client.getOperationsReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeSimulated: true }), expect.any(AbortSignal)));
  });

  it('says what did happen when a period is quiet', async () => {
    const quiet = makeReport({
      kpis: { ...KPIS, orders: 0, closedAttempts: 0, delivered: 0, returned: 0, firstAttempts: 0, firstAttemptDelivered: 0, avgStopSeconds: null, timedStops: 0 },
      comparisonKpis: null, weekly: [{ weekStart: '2026-11-16', delivered: 0, returned: 0, cancelled: 0 }], incidents: [], districts: [], drivers: [],
    });
    render(<ReportsPage client={makeClient(quiet)} today="2026-11-18" />);

    expect(await screen.findByText('Sin entregas, devoluciones ni cancelaciones en estas 8 semanas.')).toBeTruthy();
    expect(screen.getByText('Sin incidencias en el periodo.')).toBeTruthy();
    expect(screen.getAllByText('Sin entregas cerradas en el periodo.')).toHaveLength(2);
    expect(screen.getByText('Sin primeros intentos cerrados')).toBeTruthy();
  });

  it('offers a retry when the report fails', async () => {
    const user = setupUser();
    const client = { getOperationsReport: vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(makeReport()) };
    render(<ReportsPage client={client} today="2026-11-18" />);

    await user.click(await screen.findByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('list', { name: 'Indicadores del periodo' })).toBeTruthy();
  });
});

describe('report CSV', () => {
  it('carries the period, indicators and every table', () => {
    const csv = toCsv(reportCsvRows(makeReport()));
    expect(csv).toContain('Periodo;2026-11-01;2026-11-18');
    expect(csv).toContain('Entregados al primer intento (%);90.5;95');
    expect(csv).toContain('Callao;40;78.9;15');
    expect(csv).toContain('María Rojas;4;45;95.7');
    expect(csv).toContain('Destinatario ausente;6');
    expect(csv).toContain('2026-11-16;50;6;0');
  });

  it('shows stop times under a minute in seconds', async () => {
    render(<ReportsPage client={makeClient(makeReport({ kpis: { ...KPIS, avgStopSeconds: 42 } }))} today="2026-11-18" />);
    expect(await screen.findByText('42 s')).toBeTruthy();
  });

  it('has no rate without a base', () => {
    expect(rate(3, 0)).toBeNull();
    expect(rate(1, 4)).toBe(25);
  });
});
