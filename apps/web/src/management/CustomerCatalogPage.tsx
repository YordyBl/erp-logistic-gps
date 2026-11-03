import { useEffect, useState, type FormEvent } from 'react';

import type { ApiClient, CreateCustomerInput, Customer } from '../api/client.js';
import { Button, StatusPill, Surface } from '../components/Primitives.js';
import './CustomerCatalogPage.css';

type CustomerCatalogClient = Pick<ApiClient, 'listCustomers' | 'createCustomer'>;

const emptyForm: CreateCustomerInput = {
  publicCode: '',
  name: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  status: 'active',
};

export function CustomerCatalogPage({ client }: { readonly client: CustomerCatalogClient }) {
  const [customers, setCustomers] = useState<readonly Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<CreateCustomerInput>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadFailed(false);

    client.listCustomers().then((result) => {
      if (!current) return;
      setCustomers(result);
      setLoading(false);
    }).catch(() => {
      if (!current) return;
      setLoadFailed(true);
      setLoading(false);
    });

    return () => { current = false; };
  }, [client, loadAttempt]);

  function openForm() {
    setSuccessMessage('');
    setSaveFailed(false);
    setFormOpen(true);
  }

  function updateField<Key extends keyof CreateCustomerInput>(key: Key, value: CreateCustomerInput[Key]) {
    setForm((previous) => ({ ...previous, [key]: value }));
    setSaveFailed(false);
  }

  async function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    setSaving(true);
    setSaveFailed(false);
    setSuccessMessage('');
    try {
      const created = await client.createCustomer(form);
      setCustomers((previous) => [...previous, created]);
      setSuccessMessage(`Cliente «${created.name}» registrado.`);
      setForm(emptyForm);
      setFormOpen(false);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="customer-catalog">
      <header className="customer-catalog__header">
        <div>
          <p className="customer-catalog__eyebrow">Maestros · Clientes</p>
          <h1>Clientes</h1>
          <p className="customer-catalog__intro">Empresas que contratan el servicio de entrega.</p>
        </div>
        {!formOpen && <Button onClick={openForm}>Nuevo cliente</Button>}
      </header>

      {successMessage && <p className="customer-catalog__message customer-catalog__message--success" role="status">{successMessage}</p>}

      {formOpen && (
        <Surface className="customer-catalog__form-surface">
          <form className="customer-catalog__form" aria-label="Nuevo cliente" onSubmit={submitForm}>
            <div className="customer-catalog__form-heading">
              <div>
                <h2>Registrar cliente</h2>
                <p>Completa los datos de contacto para identificar a la empresa.</p>
              </div>
              <Button type="button" variant="quiet" onClick={() => setFormOpen(false)} aria-label="Cerrar formulario">
                Cerrar
              </Button>
            </div>
            <div className="customer-catalog__fields">
              <label className="customer-catalog__field">
                <span>Código del cliente</span>
                <input autoComplete="off" className="text-input" maxLength={32} minLength={3} pattern="[A-Za-z0-9]+(-[A-Za-z0-9]+)*" required
                  value={form.publicCode} onChange={(event) => updateField('publicCode', event.target.value)} />
              </label>
              <label className="customer-catalog__field">
                <span>Razón social</span>
                <input autoComplete="organization" className="text-input" maxLength={120} minLength={2} required
                  value={form.name} onChange={(event) => updateField('name', event.target.value)} />
              </label>
              <label className="customer-catalog__field">
                <span>Nombre de contacto</span>
                <input autoComplete="name" className="text-input" maxLength={120} minLength={2} required
                  value={form.contactName} onChange={(event) => updateField('contactName', event.target.value)} />
              </label>
              <label className="customer-catalog__field">
                <span>Correo de contacto</span>
                <input autoComplete="email" className="text-input" maxLength={254} required type="email"
                  value={form.contactEmail} onChange={(event) => updateField('contactEmail', event.target.value)} />
              </label>
              <label className="customer-catalog__field">
                <span>Teléfono de contacto</span>
                <input autoComplete="tel" className="text-input" maxLength={32} minLength={6} pattern="[+]?[0-9][0-9 ()-]*" required type="tel"
                  value={form.contactPhone} onChange={(event) => updateField('contactPhone', event.target.value)} />
              </label>
              <label className="customer-catalog__field">
                <span>Estado</span>
                <select className="text-input" value={form.status} onChange={(event) => updateField('status', event.target.value as NonNullable<CreateCustomerInput['status']>)}>
                  <option value="active">Activo</option>
                  <option value="inactive">Inactivo</option>
                </select>
              </label>
            </div>
            {saveFailed && <p className="customer-catalog__message customer-catalog__message--error" role="alert">No se pudo registrar el cliente. Verifica los datos e inténtalo de nuevo.</p>}
            <div className="customer-catalog__form-actions">
              <Button type="button" variant="secondary" disabled={saving} onClick={() => setFormOpen(false)}>Cancelar</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Guardando…' : 'Guardar cliente'}</Button>
            </div>
          </form>
        </Surface>
      )}

      <Surface className="customer-catalog__list-surface">
        <div className="customer-catalog__list-heading">
          <div>
            <h2>Catálogo de clientes</h2>
            {!loading && !loadFailed && <p>{customers.length} {customers.length === 1 ? 'empresa registrada' : 'empresas registradas'}</p>}
          </div>
        </div>

        {loading && (
          <div className="customer-catalog__loading" role="status" aria-live="polite">
            <span className="customer-catalog__skeleton" aria-hidden="true" />
            <span>Cargando clientes…</span>
          </div>
        )}
        {loadFailed && (
          <div className="customer-catalog__empty-state">
            <p className="customer-catalog__state-title">No se pudo cargar el catálogo. Revisa la conexión e inténtalo de nuevo.</p>
            <Button variant="secondary" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Reintentar</Button>
          </div>
        )}
        {!loading && !loadFailed && customers.length === 0 && (
          <div className="customer-catalog__empty-state">
            <p className="customer-catalog__state-title">Todavía no hay clientes</p>
            <p>Registra la primera empresa para asociarla a sus pedidos de entrega.</p>
            {!formOpen && <Button onClick={openForm}>Registrar cliente</Button>}
          </div>
        )}
        {!loading && !loadFailed && customers.length > 0 && (
          <div className="customer-catalog__table" role="table" aria-label="Clientes registrados">
            <div className="customer-catalog__row customer-catalog__row--head" role="row">
              <span role="columnheader">Código</span>
              <span role="columnheader">Empresa</span>
              <span role="columnheader">Contacto</span>
              <span role="columnheader">Estado</span>
            </div>
            {customers.map((customer) => (
              <div className="customer-catalog__row" role="row" key={customer.id}>
                <span className="customer-catalog__code" role="cell">{customer.publicCode}</span>
                <span className="customer-catalog__company" role="cell">{customer.name}</span>
                <span className="customer-catalog__contact" role="cell">
                  <strong>{customer.contactName}</strong>
                  <span>{customer.contactEmail}</span>
                  <span>{customer.contactPhone}</span>
                </span>
                <span role="cell"><StatusPill tone={customer.status === 'active' ? 'success' : 'neutral'}>{customer.status === 'active' ? 'Activo' : 'Inactivo'}</StatusPill></span>
              </div>
            ))}
          </div>
        )}
      </Surface>
      <p className="customer-catalog__footnote">Los datos de cliente se consultan y registran desde el catálogo.</p>
    </section>
  );
}
