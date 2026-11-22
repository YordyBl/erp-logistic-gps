import { CalendarDays, Check, LinkIcon, MessageCircle, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import { Button } from '@/components/ui/button.js';
import { Skeleton } from '@/components/ui/skeleton.js';

import { momentLabel, plannedDayLabel, stopsLabel, timeWindowLabel } from './format.js';
import { fetchPublicTracking } from './mockTrackingApi.js';
import { RouteMap } from './RouteMap.js';
import type { PublicTracking } from './types.js';

/** Refresh while the order can still change; a closed order stops polling. */
const REFRESH_MS = 30_000;

type Load = { readonly kind: 'loading' } | { readonly kind: 'ready'; readonly data: PublicTracking } | { readonly kind: 'unavailable' };

/** The link key travels after `#`, so it never reaches server logs or Referer headers. */
export function readTrackingKey(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, '')).get('k') ?? '';
}

export function TrackingPage({ trackingKey, load = fetchPublicTracking }: {
  readonly trackingKey: string;
  readonly load?: (key: string) => Promise<PublicTracking>;
}) {
  const [state, setState] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      load(trackingKey)
        .then((data) => {
          if (!active) return;
          setState({ kind: 'ready', data });
          if (data.status === 'scheduled' || data.status === 'in_transit') timer = setTimeout(refresh, REFRESH_MS);
        })
        .catch(() => { if (active) setState({ kind: 'unavailable' }); });
    };
    refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [trackingKey, load]);

  if (state.kind === 'loading') return <Shell layout="panel"><LoadingView /></Shell>;
  if (state.kind === 'unavailable') return <Shell layout="panel"><UnavailableView /></Shell>;
  const { data } = state;
  // With a live route the map is the main content: full screen on desktop. Otherwise a centered panel.
  const layout = data.status === 'in_transit' && data.route ? 'map' : 'panel';
  return <Shell layout={layout}><TrackingView data={data} /></Shell>;
}

/**
 * Phone: everything stacks in one column.
 * Desktop: `map` fills the window with the details in a side panel; `panel` is a centered card.
 */
function Shell({ layout, children }: { readonly layout: 'map' | 'panel'; readonly children: ReactNode }) {
  const frame = layout === 'map'
    ? 'flex min-h-svh w-full flex-col bg-white lg:h-svh lg:flex-row'
    : 'mx-auto flex min-h-svh w-full max-w-xl flex-col bg-white sm:my-10 sm:min-h-0 sm:overflow-hidden sm:rounded-2xl sm:border sm:shadow-sm';
  return <main className={`${frame} text-sm text-foreground`}>{children}</main>;
}

/** The delivery company, floating over the map or heading the panel. */
function CompanyCard({ data, floating }: { readonly data: PublicTracking; readonly floating?: boolean }) {
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${floating ? 'rounded-xl bg-white/95 py-2 pr-4 pl-2 shadow-md backdrop-blur-sm' : ''}`}>
      <span className="grid size-9 shrink-0 place-items-center rounded-lg text-[13px] font-bold text-white" style={{ backgroundColor: data.company.color }}>
        {data.company.initials}
      </span>
      <span className="flex min-w-0 flex-col leading-tight">
        <strong className="text-[15px]">{data.company.name}</strong>
        <span className="truncate text-xs text-muted-foreground">Pedido de {data.sender} · <span className="font-mono">{data.publicCode}</span></span>
      </span>
    </div>
  );
}

function ContactButton({ company }: { readonly company: PublicTracking['company'] }) {
  if (!company.whatsapp) return null;
  return (
    <Button asChild className="w-full" style={{ backgroundColor: company.color }}>
      <a href={`https://wa.me/${company.whatsapp}`} target="_blank" rel="noopener noreferrer">
        <MessageCircle data-icon="inline-start" aria-hidden="true" /> Escribir a {company.name}
      </a>
    </Button>
  );
}

function TrackingView({ data }: { readonly data: PublicTracking }) {
  const driverName = data.driver?.firstName ?? 'El motorizado';
  const route = data.status === 'in_transit' ? data.route : null;
  return (
    <>
      {route && <RouteMap route={route} driverName={driverName} overlay={<CompanyCard data={data} floating />} />}
      <section className={`flex flex-1 flex-col gap-4 p-4 sm:p-6 ${route ? 'lg:w-[420px] lg:flex-none lg:overflow-y-auto lg:border-l lg:p-8' : ''}`}>
        {!route && <div className="border-b pb-4"><CompanyCard data={data} /></div>}
        <Summary data={data} driverName={driverName} />
        <Steps status={data.status} />
        <Details data={data} />
        <footer className="mt-auto flex flex-col gap-2.5 border-t pt-4">
          <ContactButton company={data.company} />
          <p className="text-center text-[11px] text-muted-foreground">Este enlace solo muestra tu pedido · Seguimiento con ERP Logistic</p>
        </footer>
      </section>
    </>
  );
}

function Summary({ data, driverName }: { readonly data: PublicTracking; readonly driverName: string }) {
  const when = `${plannedDayLabel(data.plannedDate)} · ${timeWindowLabel(data.timeWindow)}`;
  switch (data.status) {
    case 'scheduled':
      return (
        <Headline icon={<CalendarDays aria-hidden="true" />} tone="green" eyebrow="Entrega programada" title={`Llega ${when.replace(' · ', ', ')}`}>
          Cuando el motorizado salga a reparto, aquí verás a cuántas paradas está.
        </Headline>
      );
    case 'in_transit': {
      const before = data.route?.stopsBefore ?? 0;
      const near = data.route?.driver.state === 'at_other_stop'
        ? `${driverName} está entregando otro pedido; luego quedan ${stopsLabel(before)} antes de la tuya`
        : before === 0 ? `${driverName} va hacia tu dirección` : `${driverName} está a ${stopsLabel(before)} de ti`;
      return <Headline eyebrow={capitalize(when)} title="Tu pedido está en camino" highlight={near} />;
    }
    case 'delivered': {
      const { delivery } = data;
      if (delivery === null) return null;
      const [photo] = delivery.photoUrls;
      return (
        <div className="flex flex-col gap-3">
          <Headline icon={<Check aria-hidden="true" />} tone="solid" title="Entregado">
            {capitalize(momentLabel(delivery.deliveredAt))} · recibió {delivery.receivedBy}
          </Headline>
          {photo && (
            <figure className="overflow-hidden rounded-xl border">
              <img src={photo} alt="Foto de la entrega en la puerta" className="aspect-[5/3] w-full object-cover" />
              <figcaption className="bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
                Foto 1 de {delivery.photoUrls.length} · tomada por el motorizado al entregar
              </figcaption>
            </figure>
          )}
        </div>
      );
    }
    case 'failed': {
      const { failure } = data;
      if (failure === null) return null;
      return (
        <div className="flex flex-col gap-3">
          <Headline icon={<TriangleAlert aria-hidden="true" />} tone="red" title="No pudimos entregar tu pedido">
            El motorizado pasó {momentLabel(failure.at)}. {failure.reason}.
          </Headline>
          <p className="rounded-lg bg-amber-50 px-3.5 py-3 text-[13px] text-amber-900">
            Tu pedido vuelve al almacén de {data.company.name}. Te escribirán para coordinar una nueva entrega.
          </p>
        </div>
      );
    }
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const TONES = {
  green: 'bg-emerald-50 text-emerald-800',
  red: 'bg-red-50 text-red-800',
  solid: 'bg-primary text-primary-foreground rounded-full',
} as const;

function Headline({ icon, tone = 'green', eyebrow, title, highlight, children }: {
  readonly icon?: ReactNode;
  readonly tone?: keyof typeof TONES;
  readonly eyebrow?: string;
  readonly title: string;
  readonly highlight?: string;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3">
      {icon && <span className={`grid size-12 shrink-0 place-items-center rounded-xl [&_svg]:size-6 ${TONES[tone]}`}>{icon}</span>}
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <span className="text-xs text-muted-foreground">{eyebrow}</span>}
        <h1 className="text-2xl leading-tight font-semibold">{title}</h1>
        {highlight && <p className="font-semibold text-primary">{highlight}</p>}
        {children && <p className="text-[13px] text-foreground/80">{children}</p>}
      </div>
    </div>
  );
}

const STEP_LABELS = ['Recibido', 'Preparado', 'En camino', 'Entregado'] as const;
const REACHED: Record<PublicTracking['status'], number> = { scheduled: 2, in_transit: 3, failed: 3, delivered: 4 };

function Steps({ status }: { readonly status: PublicTracking['status'] }) {
  const reached = REACHED[status];
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Avance del pedido">
      {STEP_LABELS.map((label, i) => {
        const step = i + 1;
        const done = step < reached || status === 'delivered';
        const current = step === reached && status !== 'delivered';
        const bar = done ? 'bg-primary' : current ? (status === 'failed' ? 'bg-orange-600' : 'bg-amber-500') : 'bg-muted';
        return (
          <li key={label} aria-current={current ? 'step' : undefined}
            className={`flex flex-col gap-1.5 text-[11px] ${done || current ? 'text-foreground' : 'text-muted-foreground'} ${current ? 'font-semibold' : ''}`}>
            <span className={`h-1.5 rounded-full ${bar}`} aria-hidden="true" />
            {status === 'failed' && step === 3 ? 'No entregado' : label}
          </li>
        );
      })}
    </ol>
  );
}

function Details({ data }: { readonly data: PublicTracking }) {
  if (data.status === 'in_transit' && data.driver) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-muted/60 p-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-emerald-100 font-semibold text-emerald-800" aria-hidden="true">
          {data.driver.firstName.charAt(0)}
        </span>
        <span className="flex min-w-0 flex-col">
          <strong>{data.driver.firstName} · {data.driver.vehicle} <span className="font-mono font-medium">{data.driver.plate}</span></strong>
          <span className="text-xs text-muted-foreground">Entrega en {data.deliveryAddress}</span>
        </span>
      </div>
    );
  }
  if (data.status === 'scheduled') {
    return (
      <dl className="grid grid-cols-[92px_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-xl bg-muted/60 p-3.5 text-[13px]">
        <dt className="text-muted-foreground">Entrega en</dt><dd>{data.deliveryAddress}</dd>
        <dt className="text-muted-foreground">Recibe</dt><dd>{data.recipientName}</dd>
        <dt className="text-muted-foreground">Paquetes</dt><dd>{data.packages}</dd>
      </dl>
    );
  }
  return null;
}

function LoadingView() {
  return (
    <div className="flex flex-col gap-4 p-4" role="status" aria-label="Cargando tu pedido">
      <Skeleton className="h-56 w-full" />
      <Skeleton className="h-7 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}

function UnavailableView() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-6 py-24 text-center">
      <span className="grid size-16 place-items-center rounded-2xl bg-muted text-muted-foreground [&_svg]:size-7"><LinkIcon aria-hidden="true" /></span>
      <h1 className="text-xl leading-snug font-semibold">Este enlace ya no está disponible</h1>
      <p className="max-w-[30ch] text-muted-foreground">
        Los enlaces de seguimiento vencen 7 días después de cerrarse el pedido. Si necesitas algo, escribe a la empresa que te lo envió.
      </p>
      <p className="mt-6 text-[11px] text-muted-foreground">Seguimiento con ERP Logistic</p>
    </div>
  );
}
