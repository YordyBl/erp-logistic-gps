import { ChevronsUpDown } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';

import type { ApiClient, Customer, Page } from '../../api/client.js';
import { Button } from '../../components/ui/button.js';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../../components/ui/command.js';
import { Field, FieldError, FieldLabel } from '../../components/ui/field.js';
import { Popover, PopoverContent, PopoverTrigger } from '../../components/ui/popover.js';
import { useDebouncedValue } from '../../hooks/use-debounced-value.js';

type CustomerSearchClient = Pick<ApiClient, 'listCustomersPage'>;

/** Clientes activos que muestra cada búsqueda; si hay más, se pide refinarla. */
export const CUSTOMER_SEARCH_PAGE_SIZE = 20;

export function customerLabel(customer: Pick<Customer, 'name' | 'publicCode'>): string {
  return `${customer.name} · ${customer.publicCode}`;
}

/**
 * Selector de cliente activo que busca en el servidor (`status=active&q=`), con espera de 300 ms
 * tras la última tecla. El cliente elegido se conserva y se muestra aunque no esté en los resultados
 * de la búsqueda actual. `onAvailability` informa si la organización no tiene ningún cliente activo
 * (búsqueda vacía sin resultados), para que el formulario lo explique y no deje enviar.
 */
export function CustomerCombobox({ id, label, client, value, onChange, disabled, error, onAvailability }: {
  readonly id: string;
  readonly label: string;
  readonly client: CustomerSearchClient;
  readonly value: Customer | null;
  readonly onChange: (customer: Customer) => void;
  readonly disabled?: boolean;
  readonly error?: string | null;
  readonly onAvailability?: (hasActiveCustomers: boolean) => void;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const search = useDebouncedValue(query.trim(), 300);
  const [page, setPage] = useState<Page<Customer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // `onAvailability` suele escribirse en línea: se lee la última sin volver a pedir por ella.
  const availabilityRef = useRef(onAvailability);
  availabilityRef.current = onAvailability;

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    client.listCustomersPage({
      status: 'active', ...(search === '' ? {} : { q: search }), sort: 'name:asc', pageSize: CUSTOMER_SEARCH_PAGE_SIZE,
    }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setPage(result);
      setLoading(false);
      if (search === '') availabilityRef.current?.(result.meta.total > 0);
    }, () => {
      if (controller.signal.aborted) return;
      setFailed(true);
      setLoading(false);
    });
    return () => controller.abort();
  }, [attempt, client, search]);

  const invalid = error !== undefined && error !== null;
  const results = page?.data ?? [];
  const total = page?.meta.total ?? 0;
  const busy = loading || query.trim() !== search;

  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button id={id} type="button" variant="outline" role="combobox" aria-expanded={open} aria-controls={listId}
            aria-haspopup="listbox" aria-invalid={invalid || undefined} disabled={disabled}
            data-empty={value === null || undefined}
            className="w-full justify-between font-normal data-[empty=true]:text-muted-foreground">
            <span className="truncate">{value === null ? 'Selecciona un cliente' : customerLabel(value)}</span>
            <ChevronsUpDown className="opacity-50" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-(--radix-popover-trigger-width) min-w-64 p-0" align="start">
          {/* El servidor ya filtra: cmdk no debe volver a filtrar ni reordenar. */}
          <Command shouldFilter={false} label="Buscar cliente activo">
            <CommandInput placeholder="Buscar por nombre, código o contacto"
              value={query} onValueChange={setQuery} />
            <CommandList id={listId}>
              {failed && (
                <div className="flex flex-col items-center gap-2 px-2 py-4 text-center text-sm" role="alert">
                  No se pudieron cargar los clientes.
                  <Button type="button" variant="outline" size="sm" onClick={() => setAttempt((current) => current + 1)}>Reintentar</Button>
                </div>
              )}
              {!failed && busy && results.length === 0 && (
                <div className="py-6 text-center text-sm text-muted-foreground" role="status">Buscando clientes…</div>
              )}
              {!failed && !busy && (
                <CommandEmpty>{search === '' ? 'No hay clientes activos.' : 'Ningún cliente activo coincide con la búsqueda.'}</CommandEmpty>
              )}
              {!failed && results.length > 0 && (
                <CommandGroup>
                  {results.map((customer) => (
                    <CommandItem key={customer.id} value={customer.id} data-checked={customer.id === value?.id}
                      onSelect={() => {
                        onChange(customer);
                        setOpen(false);
                      }}>
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{customer.name}</span>
                        <span className="truncate text-xs text-muted-foreground">{customer.publicCode} · {customer.contactName}</span>
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {!failed && total > results.length && (
                <p className="px-2 py-1.5 text-xs text-muted-foreground">
                  Mostrando {results.length.toLocaleString('es-PE')} de {total.toLocaleString('es-PE')}, refina la búsqueda.
                </p>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {invalid && <FieldError>{error}</FieldError>}
    </Field>
  );
}
