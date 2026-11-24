import { Building2, IdCard, Package, Route, Search, Truck } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';

import type { ApiClient, Customer, DeliveryOrder, DispatchRoute, Driver, Page, PageParams, Vehicle } from '../api/client.js';
import { OrderStatusBadge } from '../components/OrderStatusBadge.js';
import { Button } from '../components/ui/button.js';
import {
  Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from '../components/ui/command.js';
import { Spinner } from '../components/ui/spinner.js';
import { ROUTE_STATUS_LABELS } from '../delivery/orderStatus.js';
import { useDebouncedValue } from '../hooks/use-debounced-value.js';

export type GlobalSearchClient = Pick<ApiClient,
  'listDeliveryOrdersPage' | 'listDispatchRoutesPage' | 'listCustomersPage' | 'listDrivers' | 'listVehicles'>;

/** Resultados por grupo: cuántos se muestran y desde cuántas letras se busca. */
const RESULTS_PER_GROUP = 5;
const MIN_QUERY_LENGTH = 2;

interface Results {
  readonly orders: readonly DeliveryOrder[];
  readonly routes: readonly DispatchRoute[];
  readonly customers: readonly Customer[];
  /** Algún origen falló: se muestran los que respondieron y se avisa. */
  readonly partial: boolean;
}

interface Catalogs {
  readonly drivers: readonly Driver[];
  readonly vehicles: readonly Vehicle[];
}

const NO_RESULTS: Results = { orders: [], routes: [], customers: [], partial: false };

/**
 * Buscador de toda la app (Ctrl K o ⌘K): pedidos, rutas y clientes se buscan en el servidor;
 * conductores y vehículos son catálogos cortos y se filtran aquí. Al elegir un resultado se llama
 * a `onOpen` con la ruta de la pantalla que lo muestra.
 */
export function GlobalSearch({ client, onOpen }: {
  readonly client: GlobalSearchClient;
  readonly onOpen: (target: SearchTarget) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const term = useDebouncedValue(query.trim(), 250);
  const searchable = term.length >= MIN_QUERY_LENGTH;
  const [results, setResults] = useState<Results>(NO_RESULTS);
  const [loadedTerm, setLoadedTerm] = useState<string | null>(null);
  const [catalogs, setCatalogs] = useState<Catalogs>({ drivers: [], vehicles: [] });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.repeat) return;
      // El navegador usa Ctrl K para su propia barra de búsqueda.
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Conductores y vehículos cambian poco: se vuelven a pedir cada vez que se abre el buscador.
  useEffect(() => {
    if (!open) return;
    let active = true;
    void Promise.allSettled([client.listDrivers(), client.listVehicles()]).then(([drivers, vehicles]) => {
      if (!active) return;
      setCatalogs({
        drivers: drivers.status === 'fulfilled' ? drivers.value : [],
        vehicles: vehicles.status === 'fulfilled' ? vehicles.value : [],
      });
    });
    return () => { active = false; };
  }, [client, open]);

  useEffect(() => {
    if (!open || !searchable) return;
    const controller = new AbortController();
    const params: PageParams = { q: term, page: 1, pageSize: RESULTS_PER_GROUP };
    const rows = <T,>(page: PromiseSettledResult<Page<T>>) => page.status === 'fulfilled' ? page.value.data : [];
    void Promise.allSettled([
      client.listDeliveryOrdersPage(params, controller.signal),
      client.listDispatchRoutesPage(params, controller.signal),
      client.listCustomersPage(params, controller.signal),
    ]).then(([orders, routes, customers]) => {
      if (controller.signal.aborted) return;
      setResults({
        orders: rows(orders), routes: rows(routes), customers: rows(customers),
        partial: [orders, routes, customers].some((page) => page.status === 'rejected'),
      });
      setLoadedTerm(term);
    });
    return () => controller.abort();
  }, [client, open, searchable, term]);

  const needle = normalizeText(term);
  const drivers = searchable ? catalogs.drivers.filter((driver) =>
    [driver.fullName, driver.documentNumber, driver.phone].some((value) => normalizeText(value).includes(needle)))
    .slice(0, RESULTS_PER_GROUP) : [];
  const vehicles = searchable ? catalogs.vehicles.filter((vehicle) =>
    [vehicle.plate, vehicle.type].some((value) => normalizeText(value).includes(needle)))
    .slice(0, RESULTS_PER_GROUP) : [];
  const driverName = new Map(catalogs.drivers.map((driver) => [driver.id, driver.fullName]));
  const vehiclePlate = new Map(catalogs.vehicles.map((vehicle) => [vehicle.id, vehicle.plate]));

  // Mientras llega la respuesta del término actual no se muestran resultados de otro término.
  const current = searchable && loadedTerm === term ? results : NO_RESULTS;
  const loading = searchable && loadedTerm !== term;
  const total = current.orders.length + current.routes.length + current.customers.length + drivers.length + vehicles.length;

  function changeOpen(next: boolean): void {
    setOpen(next);
    if (!next) setQuery('');
  }

  function choose(target: SearchTarget): void {
    changeOpen(false);
    onOpen(target);
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}
        className="text-muted-foreground sm:w-64 sm:justify-start" aria-label="Buscar en ERP Logistic" aria-keyshortcuts="Control+K Meta+K">
        <Search data-icon="inline-start" aria-hidden="true" />
        <span className="hidden sm:inline">Buscar…</span>
        <kbd className="ml-auto hidden rounded border bg-muted px-1.5 font-mono text-[11px] sm:inline">Ctrl K</kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={changeOpen} title="Buscar en ERP Logistic"
        description="Busca pedidos, rutas, conductores, vehículos y clientes." className="sm:max-w-xl">
        <Command shouldFilter={false}>
          <CommandInput value={query} onValueChange={setQuery} placeholder="Buscar pedido, ruta, conductor, placa o cliente" />
          <CommandList className="max-h-[min(28rem,60vh)]">
            {!searchable && <p className="px-3 py-6 text-center text-sm text-muted-foreground">Escribe al menos {MIN_QUERY_LENGTH} letras para buscar.</p>}
            {loading && total === 0 && (
              <p className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground" role="status">
                <Spinner aria-hidden="true" /> Buscando…
              </p>
            )}
            {searchable && !loading && <CommandEmpty>Sin resultados para «{term}».</CommandEmpty>}
            {current.partial && <p className="px-3 pt-2 text-xs text-badge-warning-text">No se pudieron cargar todos los resultados.</p>}

            <ResultGroup heading="Pedidos">
              {current.orders.map((order) => (
                <ResultItem key={order.id} value={`order-${order.id}`} icon={<Package aria-hidden="true" />}
                  title={<><span className="font-medium tabular-nums">{order.publicCode}</span> · {order.recipient.name}</>}
                  detail={`${order.deliveryAddress.addressLine}, ${order.deliveryAddress.district}`}
                  aside={<OrderStatusBadge status={order.status} />}
                  onSelect={() => choose({ kind: 'order', publicCode: order.publicCode })} />
              ))}
            </ResultGroup>
            <ResultGroup heading="Rutas">
              {current.routes.map((route) => (
                <ResultItem key={route.id} value={`route-${route.id}`} icon={<Route aria-hidden="true" />}
                  title={<span className="font-medium tabular-nums">{route.publicCode}</span>}
                  detail={[driverName.get(route.driverId), vehiclePlate.get(route.vehicleId)].filter(Boolean).join(' · ')}
                  aside={<span className="text-xs text-muted-foreground">{ROUTE_STATUS_LABELS[route.status]}</span>}
                  onSelect={() => choose({ kind: 'route', publicCode: route.publicCode, inProgress: route.status === 'in_progress' })} />
              ))}
            </ResultGroup>
            <ResultGroup heading="Conductores">
              {drivers.map((driver) => (
                <ResultItem key={driver.id} value={`driver-${driver.id}`} icon={<IdCard aria-hidden="true" />}
                  title={driver.fullName} detail={`DNI ${driver.documentNumber} · ${driver.phone}`}
                  onSelect={() => choose({ kind: 'driver', query: driver.fullName })} />
              ))}
            </ResultGroup>
            <ResultGroup heading="Vehículos">
              {vehicles.map((vehicle) => (
                <ResultItem key={vehicle.id} value={`vehicle-${vehicle.id}`} icon={<Truck aria-hidden="true" />}
                  title={<span className="font-medium tabular-nums">{vehicle.plate}</span>} detail={vehicle.type}
                  onSelect={() => choose({ kind: 'vehicle', query: vehicle.plate })} />
              ))}
            </ResultGroup>
            <ResultGroup heading="Clientes">
              {current.customers.map((customer) => (
                <ResultItem key={customer.id} value={`customer-${customer.id}`} icon={<Building2 aria-hidden="true" />}
                  title={customer.name} detail={[customer.publicCode, customer.contactName].filter(Boolean).join(' · ')}
                  onSelect={() => choose({ kind: 'customer', query: customer.name })} />
              ))}
            </ResultGroup>
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}

/** Lo que se eligió en el buscador; `App` decide a qué pantalla lleva. */
export type SearchTarget =
  | { readonly kind: 'order'; readonly publicCode: string }
  | { readonly kind: 'route'; readonly publicCode: string; readonly inProgress: boolean }
  | { readonly kind: 'driver' | 'vehicle' | 'customer'; readonly query: string };

function ResultGroup({ heading, children }: { readonly heading: string; readonly children: ReactNode[] }) {
  return children.length === 0 ? null : <CommandGroup heading={heading}>{children}</CommandGroup>;
}

function ResultItem({ value, icon, title, detail, aside, onSelect }: {
  readonly value: string;
  readonly icon: ReactNode;
  readonly title: ReactNode;
  readonly detail: string;
  readonly aside?: ReactNode;
  readonly onSelect: () => void;
}) {
  return (
    <CommandItem value={value} onSelect={onSelect} className="gap-3">
      {icon}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        {detail !== '' && <span className="truncate text-xs text-muted-foreground">{detail}</span>}
      </span>
      {aside}
    </CommandItem>
  );
}

/** Minúsculas y sin tildes, para que "gomez" encuentre a "Gómez". */
function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es-PE');
}
