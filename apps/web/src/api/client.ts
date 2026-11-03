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
    readonly latitude?: number;
    readonly longitude?: number;
  };
  readonly packages: readonly {
    readonly code?: string;
    readonly description: string;
    readonly weightKg?: number;
  }[];
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
  readonly publicCode: string;
  readonly plannedDate: string;
  readonly driverId: string;
  readonly vehicleId: string;
  readonly stops: readonly {
    readonly sequence: number;
    readonly addressLine: string;
    readonly googleMapsUrl?: string;
    readonly latitude?: number;
    readonly longitude?: number;
    readonly orderIds: readonly string[];
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

interface ApiEnvelope<T> {
  readonly data: T;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | undefined,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class ApiClient {
  private accessToken: string | null = null;

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
    return session;
  }

  async restoreSession(): Promise<AuthSession | null> {
    try {
      const session = await this.requestData<AuthSession>('/auth/refresh', {
        method: 'POST',
      }, false);
      this.accessToken = session.accessToken;
      return session;
    } catch (error) {
      this.accessToken = null;
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  }

  async logout(): Promise<void> {
    try {
      await this.send('/auth/logout', { method: 'POST' }, false);
    } finally {
      this.accessToken = null;
    }
  }

  async getMyRoute(): Promise<DeliveryRoute> {
    return this.requestData('/delivery-routes/mine');
  }

  async listDispatchRoutes(): Promise<readonly DispatchRoute[]> {
    return this.requestData('/delivery-routes');
  }

  async getDispatchDashboardSummary(): Promise<DispatchDashboardSummary> {
    return this.requestData('/dashboard');
  }

  async createTrackingTicket(): Promise<{ readonly ticket: string; readonly expiresAt: string }> {
    return this.requestData('/tracking/ticket', { method: 'POST', body: '{}' });
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

  async listCustomers(): Promise<readonly Customer[]> {
    return this.requestData('/customers');
  }

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    return this.requestData('/customers', { method: 'POST', body: JSON.stringify(input) });
  }

  async listDeliveryOrders(): Promise<readonly DeliveryOrder[]> {
    return this.requestData('/delivery-orders');
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
      const session = await this.restoreSession();
      if (session === null) throw await this.toApiError(response);
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
      ? error.error as { readonly code?: unknown; readonly message?: unknown }
      : undefined;
    const message = typeof nested?.message === 'string' ? nested.message
      : typeof error?.message === 'string' ? error.message
        : 'No se pudo completar la solicitud. Inténtalo de nuevo.';
    const code = typeof nested?.code === 'string' ? nested.code : undefined;
    return new ApiError(message, response.status, code);
  }
}

export const api = new ApiClient();
