export type UserRole = 'ADMIN' | 'DISPATCHER' | 'DRIVER';
export type DriverStatus = 'active' | 'inactive';
export type VehicleStatus = 'active' | 'inactive';
export type DeliveryOrderStatus =
  | 'created' | 'planned' | 'assigned' | 'in_transit' | 'delivered' | 'returned' | 'cancelled';
export type DeliveryTimeWindow = 'AM' | 'PM';

export interface DeliveryOrderStatusHistory {
  readonly fromStatus: DeliveryOrderStatus;
  readonly toStatus: DeliveryOrderStatus;
  readonly actorUserId: string;
  readonly occurredAt: string;
}

export interface Customer {
  readonly id: string;
  readonly organizationId: string;
  readonly publicCode?: string;
  readonly name: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly status: 'active' | 'inactive';
  readonly createdAt: string;
}

export interface CreateCustomerInput {
  readonly publicCode: string;
  readonly name: string;
  readonly contactName: string;
  readonly contactEmail: string;
  readonly contactPhone: string;
  readonly status?: 'active' | 'inactive';
}

export interface CreateDeliveryOrderInput {
  readonly customerId: string;
  readonly timeWindow: DeliveryTimeWindow;
  readonly publicCode?: string;
  readonly recipient: { readonly name: string; readonly phone: string };
  readonly deliveryAddress: {
    readonly addressLine: string;
    readonly district: string;
    readonly googleMapsUrl?: string;
    /** Required: route stops copy the order's coordinates. */
    readonly latitude: number;
    readonly longitude: number;
  };
  readonly packages: readonly {
    readonly code?: string;
    readonly description: string;
    readonly weightKg?: number;
  }[];
}

/**
 * Details an order accepts while it is still `created`. Customer and time window
 * are fixed; a package without `code` is new and gets a generated code.
 */
export interface EditDeliveryOrderInput {
  readonly recipient?: CreateDeliveryOrderInput['recipient'];
  readonly deliveryAddress?: CreateDeliveryOrderInput['deliveryAddress'];
  readonly packages?: CreateDeliveryOrderInput['packages'];
}

/** Path a route already drove (GPS positions) and the path still ahead, for the control tower map. */
export interface RouteTrack {
  readonly traveled: readonly { readonly latitude: number; readonly longitude: number; readonly recordedAt: string }[];
  readonly pending: readonly { readonly latitude: number; readonly longitude: number }[];
  /** `roads` when a routing engine drew `pending`; `straight` when it joins the stops directly. */
  readonly pendingSource: 'roads' | 'straight';
}

export interface DeliveryOrderImportIssue {
  readonly rowNumber: number;
  readonly field: string;
  readonly message: string;
}

export interface RejectedDeliveryOrderImport {
  readonly publicCode: string | null;
  readonly rowNumbers: readonly number[];
  readonly issues: readonly DeliveryOrderImportIssue[];
}

export interface DeliveryOrderImportResult {
  readonly importedOrders: readonly DeliveryOrder[];
  readonly rejectedOrders: readonly RejectedDeliveryOrderImport[];
}

export interface Driver {
  readonly id: string;
  readonly organizationId: string;
  readonly fullName: string;
  readonly documentNumber: string;
  readonly phone: string;
  readonly licenseNumber: string;
  readonly status: DriverStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateDriverInput {
  readonly fullName: string;
  readonly documentNumber: string;
  readonly phone: string;
  readonly licenseNumber: string;
  readonly status?: DriverStatus;
}

export interface UpdateDriverInput {
  readonly fullName?: string;
  readonly phone?: string;
  readonly licenseNumber?: string;
  readonly status?: DriverStatus;
}

export interface DriverAccountOption {
  readonly userId: string;
  readonly email: string;
  readonly status: 'active' | 'disabled';
  readonly driverId: string | null;
}

export interface DriverAccountBinding {
  readonly driverId: string;
  readonly userId: string | null;
}

export interface Vehicle {
  readonly id: string;
  readonly organizationId: string;
  readonly plate: string;
  readonly type: string;
  readonly capacityKg: number | null;
  readonly status: VehicleStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateVehicleInput {
  readonly plate: string;
  readonly type: string;
  readonly capacityKg?: number;
  readonly status?: VehicleStatus;
}

export interface UpdateVehicleInput {
  readonly type?: string;
  readonly capacityKg?: number | null;
  readonly status?: VehicleStatus;
}

export interface SessionUser {
  readonly id: string;
  readonly organizationId: string;
  readonly email: string;
  readonly role: UserRole;
}

export interface AuthSession {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshTokenExpiresAt: string;
  readonly user: SessionUser;
}

export interface DeliveryOrder {
  readonly id: string;
  readonly organizationId: string;
  readonly customerId: string;
  readonly publicCode: string;
  readonly timeWindow: DeliveryTimeWindow;
  readonly status: DeliveryOrderStatus;
  readonly recipient: { readonly name: string; readonly phone: string };
  readonly deliveryAddress: {
    readonly addressLine: string;
    readonly district: string;
    /** The API always sends it (null when absent); optional so partial fixtures stay valid. */
    readonly googleMapsUrl?: string | null;
    readonly latitude: number | null;
    readonly longitude: number | null;
  };
  readonly packages: readonly {
    readonly code: string;
    readonly description: string;
    readonly weightKg: number | null;
  }[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DeliveryRoute {
  readonly id: string;
  readonly publicCode: string;
  readonly plannedDate: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly status: 'planned' | 'in_progress' | 'completed';
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly stops: readonly {
    readonly id: string;
    readonly sequence: number;
    readonly addressLine: string;
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly orders: readonly DeliveryOrder[];
  }[];
}

export interface DispatchRoute {
  readonly id: string;
  readonly organizationId: string;
  readonly publicCode: string;
  readonly plannedDate: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly status: 'planned' | 'in_progress' | 'completed';
  /** Present and true only for development simulations. */
  readonly simulatedCompletionEnabled?: boolean;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly stops: readonly {
    readonly id: string;
    readonly sequence: number;
    readonly addressLine: string;
    readonly latitude: number | null;
    readonly longitude: number | null;
    readonly orderIds: readonly string[];
  }[];
}

/** Actividad de rutas de un vehículo (`GET /vehicles/route-stats`); las rutas canceladas no cuentan. */
export interface VehicleRouteStats {
  readonly vehicleId: string;
  readonly routes: number;
  readonly completed: number;
  readonly stops: number;
  readonly orders: number;
  /** Día planificado (`YYYY-MM-DD`) de la ruta más reciente, o `null` si nunca salió. */
  readonly lastRouteDay: string | null;
  /** Rutas por mes planificado (`YYYY-MM`), del más antiguo al mes actual en Lima. */
  readonly monthly: readonly { readonly month: string; readonly routes: number }[];
}

/** Whether route simulation is available (development only) and which drivers it may use. */
export interface RouteSimulationAvailability {
  readonly enabled: boolean;
  readonly eligibleDriverIds: readonly string[];
}

export interface DispatchDashboardSummary {
  readonly ordersAwaitingPlanning: number;
  readonly routesInProgress: number;
  readonly deliveriesToday: number;
  readonly incidentsToday: number;
  readonly orderStatusCounts: Readonly<Record<DeliveryOrderStatus, number>>;
  readonly recentOrders: readonly {
    readonly id: string;
    readonly publicCode: string;
    readonly status: DeliveryOrderStatus;
    readonly createdAt: string;
  }[];
  readonly recentIncidents: readonly {
    readonly id: string;
    readonly orderId: string;
    readonly publicCode: string;
    readonly category: string;
    readonly description: string;
    readonly occurredAt: string;
  }[];
  readonly activeRoutes: readonly {
    readonly id: string;
    readonly publicCode: string;
    readonly plannedDate: string;
    readonly lastPosition: {
      readonly latitude: number;
      readonly longitude: number;
      readonly receivedAt: string;
    } | null;
  }[];
}

export interface CreateDispatchRouteInput {
  /** Optional: the API generates `RUT-00000001` codes when it is omitted. */
  readonly publicCode?: string;
  readonly plannedDate: string;
  readonly driverId: string;
  readonly vehicleId: string;
  /** Start of a simulated route: a Google Maps link, or coordinates already resolved from it. */
  readonly origin?: { readonly addressLine: string; readonly googleMapsUrl: string }
    | { readonly addressLine: string; readonly latitude: number; readonly longitude: number };
  readonly simulatedCompletionEnabled?: boolean;
  /** One stop per order; the API copies each order's address and coordinates into its stop. */
  readonly stops: readonly {
    readonly sequence: number;
    readonly orderId: string;
  }[];
}

export interface DeliveryEvidence {
  readonly id: string;
  readonly orderId: string;
  readonly attemptId: string;
  readonly incidentId: string | null;
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  readonly byteSize: number;
  readonly checksum: string;
  readonly uploadedBy: string;
  readonly status: 'pending_upload' | 'available';
  readonly createdAt: string;
  readonly availableAt: string | null;
}

/** Foto de la bóveda: la evidencia más un resumen del pedido al que pertenece. */
export interface EvidenceVaultItem extends DeliveryEvidence {
  readonly order: {
    readonly id: string;
    readonly publicCode: string;
    readonly status: 'delivered' | 'returned';
    readonly recipientName: string;
    readonly district: string;
  };
}

interface ApiEnvelope<T> {
  readonly data: T;
}

/** Valor de un parámetro de consulta: las listas viajan separadas por comas (`status=a,b`). */
export type QueryValue = string | number | boolean | readonly (string | number)[] | null | undefined;

/**
 * Parámetros de un listado paginado en el servidor. `sort` va como `campo:asc|desc`; el resto son
 * los filtros propios de cada recurso (`status`, `ids`, `customerId`...).
 */
export interface PageParams {
  readonly page?: number;
  readonly pageSize?: number;
  readonly q?: string;
  readonly sort?: string;
  readonly [filter: string]: QueryValue;
}

/** Una página de un listado: las filas y el total del servidor, con conteos por faceta si los hay. */
export interface Page<T> {
  readonly data: readonly T[];
  readonly meta: {
    readonly page: number;
    readonly pageSize: number;
    readonly total: number;
    /** Conteos por faceta y valor, por ejemplo `{ status: { created: 12 } }`. */
    readonly counts?: Readonly<Record<string, Readonly<Record<string, number>>>>;
  };
}

/**
 * Arma la query (`?a=1&b=x,y`) omitiendo valores vacíos: `undefined`, `null`, `''` y listas sin
 * elementos. Devuelve `''` si no queda ningún parámetro.
 */
export function buildQuery(params: Readonly<Record<string, QueryValue>>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    const text = Array.isArray(value) ? value.join(',') : String(value);
    if (text === '') continue;
    search.append(key, text);
  }
  const query = search.toString();
  return query === '' ? '' : `?${query}`;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
    /** Structured, client-safe context from the API (`error.details`), when present. */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Marca sin datos sensibles: la cookie de refresco es httpOnly y no se puede leer, así que
 * este indicador evita un 401 seguro en cada visita de quien nunca inició sesión.
 */
const SESSION_HINT_KEY = 'erp-logistic.has-session';

function hasSessionHint(): boolean {
  try {
    return window.localStorage.getItem(SESSION_HINT_KEY) === '1';
  } catch {
    // Sin almacenamiento disponible se consulta la cookie: es el comportamiento seguro.
    return true;
  }
}

function rememberSessionHint(active: boolean): void {
  try {
    if (active) window.localStorage.setItem(SESSION_HINT_KEY, '1');
    else window.localStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    // La marca solo evita una petición; sin ella la sesión sigue funcionando.
  }
}

export class ApiClient {
  private accessToken: string | null = null;
  private sessionRestore: Promise<AuthSession | null> | null = null;

  constructor(
    private readonly options: {
      readonly fetcher?: typeof fetch;
      readonly baseUrl?: string;
    } = {},
  ) {}

  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  async login(email: string, password: string): Promise<AuthSession> {
    const session = await this.requestData<AuthSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }, false);
    this.accessToken = session.accessToken;
    rememberSessionHint(true);
    return session;
  }

  /**
   * El refresco rota la cookie: dos peticiones simultáneas harían que la segunda reciba 401 y
   * cierre una sesión válida. Por eso quienes lleguen mientras hay una en curso la comparten.
   */
  restoreSession(): Promise<AuthSession | null> {
    return hasSessionHint() ? this.refreshOnce() : Promise.resolve(null);
  }

  private refreshOnce(): Promise<AuthSession | null> {
    this.sessionRestore ??= this.refreshSession().finally(() => { this.sessionRestore = null; });
    return this.sessionRestore;
  }

  private async refreshSession(): Promise<AuthSession | null> {
    try {
      const session = await this.requestData<AuthSession>('/auth/refresh', {
        method: 'POST',
      }, false);
      this.accessToken = session.accessToken;
      return session;
    } catch (error) {
      this.accessToken = null;
      if (error instanceof ApiError && error.status === 401) {
        rememberSessionHint(false);
        return null;
      }
      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.send('/auth/logout', { method: 'POST' }, false);
    } finally {
      this.accessToken = null;
      rememberSessionHint(false);
    }
  }

  async getMyRoute(): Promise<DeliveryRoute> {
    return this.requestData('/delivery-routes/mine');
  }

  /**
   * Una página de rutas con sus paradas. Filtros: `status`, `ids`, `driverId`, `vehicleId`,
   * `plannedFrom`/`plannedTo` (`YYYY-MM-DD`, inclusivos); `q` busca en el código, el conductor y la
   * placa; orden por `publicCode`, `plannedDate` (por defecto `plannedDate:desc`) o `status`.
   * `meta.counts` trae `status`.
   */
  listDispatchRoutesPage(params: PageParams, signal?: AbortSignal): Promise<Page<DispatchRoute>> {
    return this.requestPage('/delivery-routes', params, signal);
  }

  /** Totales y serie mensual de rutas por vehículo, agregados en el servidor (1 a 12 meses, por defecto 6). */
  async getVehicleRouteStats(months?: number): Promise<readonly VehicleRouteStats[]> {
    return this.requestData(`/vehicles/route-stats${buildQuery({ months })}`);
  }

  async getDispatchDashboardSummary(): Promise<DispatchDashboardSummary> {
    return this.requestData('/dashboard');
  }

  async createTrackingTicket(): Promise<{ readonly ticket: string; readonly expiresAt: string }> {
    return this.requestData('/tracking/ticket', { method: 'POST', body: '{}' });
  }

  async getRouteTrack(routeId: string): Promise<RouteTrack> {
    return this.requestData(`/tracking/routes/${encodeURIComponent(routeId)}/track`);
  }

  async getRouteSimulation(): Promise<RouteSimulationAvailability> {
    return this.requestData('/delivery-routes/simulation');
  }

  async createDispatchRoute(input: CreateDispatchRouteInput): Promise<DispatchRoute> {
    return this.requestData('/delivery-routes', { method: 'POST', body: JSON.stringify(input) });
  }

  async reassignDispatchRoute(routeId: string, input: {
    readonly driverId?: string;
    readonly vehicleId?: string;
  }): Promise<DispatchRoute> {
    return this.requestData(`/delivery-routes/${encodeURIComponent(routeId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
  }

  async startRoute(routeId: string): Promise<DeliveryRoute> {
    return this.requestData(`/delivery-routes/${encodeURIComponent(routeId)}/start`, {
      method: 'POST',
      body: '{}',
    });
  }

  async completeRoute(routeId: string): Promise<DeliveryRoute> {
    return this.requestData(`/delivery-routes/${encodeURIComponent(routeId)}/complete`, {
      method: 'POST',
      body: '{}',
    });
  }

  async uploadEvidence(
    orderId: string,
    file: File,
    idempotencyKey: string,
  ): Promise<DeliveryEvidence> {
    const evidence = await this.requestData<DeliveryEvidence>(
      `/delivery-orders/${encodeURIComponent(orderId)}/evidence`,
      {
        method: 'POST',
        body: file,
        headers: {
          'Content-Type': file.type,
          'Idempotency-Key': idempotencyKey,
        },
      },
    );
    if (evidence.status !== 'available') {
      throw new ApiError('La foto aún no está disponible. Reintenta la carga.', 503, 'EVIDENCE_PENDING');
    }
    return evidence;
  }

  async listEvidence(orderId: string): Promise<readonly DeliveryEvidence[]> {
    return this.requestData(`/delivery-orders/${encodeURIComponent(orderId)}/evidence`);
  }

  /**
   * Una página de la bóveda: fotos disponibles de pedidos entregados o devueltos, de la más nueva a
   * la más antigua (orden fijo). `q` busca por código de pedido o destinatario; filtro `orderId`.
   */
  listEvidencePage(params: PageParams, signal?: AbortSignal): Promise<Page<EvidenceVaultItem>> {
    return this.requestPage('/delivery-evidence', params, signal);
  }

  async downloadEvidence(evidenceId: string): Promise<Blob> {
    const response = await this.send(
      `/evidence/${encodeURIComponent(evidenceId)}/download`,
      { method: 'GET' },
    );
    return response.blob();
  }

  async confirmDelivery(input: {
    readonly orderId: string;
    readonly evidenceIds: readonly string[];
    readonly receiverName: string | null;
    readonly notes: string | null;
  }): Promise<void> {
    await this.requestData(`/delivery-routes/orders/${encodeURIComponent(input.orderId)}/confirm`, {
      method: 'POST',
      body: JSON.stringify({
        evidenceIds: input.evidenceIds,
        receiverName: input.receiverName,
        notes: input.notes,
      }),
    });
  }

  async reportIncident(input: {
    readonly orderId: string;
    readonly category: string;
    readonly description: string;
    readonly evidenceIds: readonly string[];
  }): Promise<void> {
    await this.requestData(`/delivery-routes/orders/${encodeURIComponent(input.orderId)}/incidents`, {
      method: 'POST',
      body: JSON.stringify({
        category: input.category,
        description: input.description,
        evidenceIds: input.evidenceIds,
      }),
    });
  }

  async findOrderByPublicCode(publicCode: string): Promise<DeliveryOrder> {
    return this.requestData(`/delivery-orders?publicCode=${encodeURIComponent(publicCode.trim())}`);
  }

  /**
   * Una página del catálogo de clientes. Filtros: `status` e `ids`; `q` busca en nombre, código y
   * datos de contacto; orden por `name` (por defecto, ascendente) o `createdAt`. `meta.counts` trae
   * `status`.
   */
  listCustomersPage(params: PageParams, signal?: AbortSignal): Promise<Page<Customer>> {
    return this.requestPage('/customers', params, signal);
  }

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    return this.requestData('/customers', { method: 'POST', body: JSON.stringify(input) });
  }

  /**
   * Una página de pedidos. Filtros: `status`, `timeWindow`, `customerId`, `ids`; orden por
   * `publicCode`, `createdAt`, `recipientName` o `district`. `meta.counts` trae `status` y
   * `timeWindow`.
   */
  listDeliveryOrdersPage(params: PageParams, signal?: AbortSignal): Promise<Page<DeliveryOrder>> {
    return this.requestPage('/delivery-orders', params, signal);
  }

  async createDeliveryOrder(input: CreateDeliveryOrderInput): Promise<DeliveryOrder> {
    return this.requestData('/delivery-orders', { method: 'POST', body: JSON.stringify(input) });
  }

  async resolveGoogleMapsLink(url: string): Promise<{ readonly latitude: number; readonly longitude: number }> {
    return this.requestData('/delivery-orders/resolve-map-link', {
      method: 'POST', body: JSON.stringify({ url }),
    });
  }

  async importDeliveryOrders(file: File): Promise<DeliveryOrderImportResult> {
    const isCsv = file.name.toLowerCase().endsWith('.csv');
    const isXlsx = file.name.toLowerCase().endsWith('.xlsx');
    if (!isCsv && !isXlsx) {
      throw new ApiError('Selecciona un archivo CSV o XLSX.', 400, 'DELIVERY_ORDER_IMPORT_UNSUPPORTED_TYPE');
    }
    return this.requestData('/delivery-orders/import', {
      method: 'POST',
      body: file,
      headers: {
        'Content-Type': isCsv ? 'text/csv' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
    });
  }

  async downloadDeliveryOrderImportTemplate(): Promise<Blob> {
    const response = await this.send('/delivery-orders/import/template', { method: 'GET' });
    return response.blob();
  }

  async editDeliveryOrder(orderId: string, changes: EditDeliveryOrderInput): Promise<DeliveryOrder> {
    return this.requestData(`/delivery-orders/${encodeURIComponent(orderId)}`, {
      method: 'PATCH', body: JSON.stringify(changes),
    });
  }

  async cancelDeliveryOrder(orderId: string): Promise<DeliveryOrder> {
    return this.requestData(`/delivery-orders/${encodeURIComponent(orderId)}/cancel`, {
      method: 'POST', body: '{}',
    });
  }

  async listDeliveryOrderStatusHistory(orderId: string): Promise<readonly DeliveryOrderStatusHistory[]> {
    return this.requestData(`/delivery-orders/${encodeURIComponent(orderId)}/history`);
  }

  async listDrivers(): Promise<readonly Driver[]> {
    return this.requestData('/drivers');
  }

  async listDriverAccounts(): Promise<readonly DriverAccountOption[]> {
    return this.requestData('/drivers/accounts');
  }

  async createDriver(input: CreateDriverInput): Promise<Driver> {
    return this.requestData('/drivers', { method: 'POST', body: JSON.stringify(input) });
  }

  async updateDriver(driverId: string, input: UpdateDriverInput): Promise<Driver> {
    return this.requestData(`/drivers/${encodeURIComponent(driverId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
  }

  async bindDriverAccount(driverId: string, userId: string | null): Promise<DriverAccountBinding> {
    return this.requestData(`/drivers/${encodeURIComponent(driverId)}/account`, {
      method: 'PUT', body: JSON.stringify({ userId }),
    });
  }

  async listVehicles(): Promise<readonly Vehicle[]> {
    return this.requestData('/vehicles');
  }

  async createVehicle(input: CreateVehicleInput): Promise<Vehicle> {
    return this.requestData('/vehicles', { method: 'POST', body: JSON.stringify(input) });
  }

  async updateVehicle(vehicleId: string, input: UpdateVehicleInput): Promise<Vehicle> {
    return this.requestData(`/vehicles/${encodeURIComponent(vehicleId)}`, {
      method: 'PATCH', body: JSON.stringify(input),
    });
  }

  private async requestData<T>(
    path: string,
    init: RequestInit = {},
    allowRefresh = true,
  ): Promise<T> {
    const response = await this.send(path, init, allowRefresh);
    if (response.status === 204) return undefined as T;
    const envelope = await response.json() as ApiEnvelope<T>;
    return envelope.data;
  }

  /**
   * Pide una página de un listado y conserva `meta`, que `requestData` descarta. `signal` cancela
   * la petición, también el reintento tras refrescar la sesión.
   */
  private async requestPage<T>(path: string, params: PageParams, signal?: AbortSignal): Promise<Page<T>> {
    const response = await this.send(`${path}${buildQuery(params)}`, signal === undefined ? {} : { signal });
    return await response.json() as Page<T>;
  }

  /** `init.signal` llega a la petición y a su reintento tras el 401: cancelar corta ambos. */
  private async send(path: string, init: RequestInit, allowRefresh = true): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Accept', 'application/json');
    if (this.accessToken !== null && !path.startsWith('/auth/')) {
      headers.set('Authorization', `Bearer ${this.accessToken}`);
    }
    if (init.body !== undefined && typeof init.body === 'string' && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }

    const response = await (this.options.fetcher ?? fetch)(
      `${this.options.baseUrl ?? '/api/v1'}${path}`,
      { ...init, headers, credentials: 'include' },
    );

    if (response.status === 401 && allowRefresh && this.accessToken !== null &&
        !path.startsWith('/auth/')) {
      const session = await this.refreshOnce();
      if (session === null) throw await this.toApiError(response);
      // Si se canceló mientras se refrescaba la sesión, no se repite la petición.
      init.signal?.throwIfAborted();
      return this.send(path, init, false);
    }

    if (!response.ok) throw await this.toApiError(response);
    return response;
  }

  private async toApiError(response: Response): Promise<ApiError> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const error = typeof body === 'object' && body !== null
      ? (body as { readonly error?: unknown; readonly message?: unknown })
      : undefined;
    const nested = typeof error?.error === 'object' && error.error !== null
      ? error.error as { readonly code?: unknown; readonly message?: unknown; readonly details?: unknown }
      : undefined;
    const message = typeof nested?.message === 'string' ? nested.message
      : typeof error?.message === 'string' ? error.message
        : 'No se pudo completar la solicitud. Inténtalo de nuevo.';
    const code = typeof nested?.code === 'string' ? nested.code : undefined;
    return new ApiError(message, response.status, code, nested?.details);
  }
}

export const api = new ApiClient();
