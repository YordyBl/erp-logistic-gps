# ERP logístico de última milla — Lima

> Estado: borrador técnico v0.2 | Fecha: 2026-10-26 | Documento vivo

## repositorio visual Manifest — Logistics Management Panel
> Referencia externa, fuera de este repositorio: /home/yordypc/Escritorio/Proyectos/manifest
> Usado SOLO como referencia visual de UI. Su stack (better-sqlite3, bcrypt, etc.) NO se reutiliza; el stack autorizado es el de la tabla de la sección 2.

## 1. Objetivo

Construir desde cero una demo funcional de un sistema de gestión de distribución de última milla para Lima Metropolitana y Callao. Un conductor puede transportar varios pedidos, efectuar varias paradas y confirmar cada entrega independientemente. Un operador planifica y monitorea las rutas; cada destinatario puede seguir solamente su pedido mediante un acceso público limitado.

### Alcance MVP
- Administración de clientes, pedidos, conductores y vehículos.
- Creación de rutas con múltiples paradas y múltiples pedidos por parada.
- Asignación de conductor y vehículo; seguimiento de progreso de la ruta.
- GPS simulado con puntos sobre calles y actualizaciones en tiempo real.
- Vista web móvil del conductor para completar o fallar entregas.
- Captura de fotografías como constancia de entrega y reporte de incidencias con evidencia fotográfica desde el detalle de cada pedido/parada.
- Tracking público por pedido con controles de privacidad.
- Dashboard e indicadores mínimos de reparto.

### Fuera del alcance inicial
- Facturación SUNAT, contabilidad, inventario avanzado, aplicación móvil nativa, optimización compleja de rutas y rastreadores GPS físicos.

## 2. Stack y decisiones establecidas

| Área | Decisión | Estado |
|---|---|---|
| Backend | Node.js + Express + TypeScript estricto | Confirmado |
| Arquitectura | Monolito modular, hexagonal, vertical slicing por caso de uso | Confirmado |
| ORM | TypeORM (Data Mapper) | Confirmado |
| Base de datos | PostgreSQL | Confirmado |
| Contenedores | Docker, Docker Compose, multi-stage builds | Confirmado |
| Autenticación | JWT | Confirmado; política pendiente |
| Frontend | React + TypeScript; stack propio definido en esta tabla. Manifest como referencia visual de UI únicamente, sin reutilizar su stack | Confirmado en principio; tooling exacto pendiente |
| Tiempo real | WebSocket; librería `ws` como candidato | Propuesta |
| Mapas | MapLibre o Leaflet | Pendiente |
| Datos espaciales | PostGIS | Recomendado, pendiente |
| Validación runtime | Zod | Recomendado, pendiente |
| Testing | Vitest o Jest; Supertest; Testcontainers | Pendiente |
| API | REST versionada + OpenAPI 3.1 | Recomendado, pendiente |
| Paquetes | Monorepo con workspaces | Propuesta |
| Infraestructura | Docker Compose para desarrollo/demo | Confirmado |
| Zona horaria | America/Lima en todo el sistema: BD, API, UI, logs y auditoría | Confirmado |

Referencia: Manifest (https://github.com/vugarfamiloglu/manifest) como referencia visual de UI y UX, no dependencia técnica. Su stack NO se reutiliza; el stack de esta tabla es el único autorizado. El clon de referencia vive fuera de este repositorio.

## 3. Reglas de arquitectura

1. El dominio no importa Express, TypeORM, librerías HTTP ni servicios externos.
2. Los casos de uso dependen de puertos/interfaces, nunca de adaptadores concretos.
3. TypeORM vive exclusivamente en infraestructura; sus entidades se separan de los agregados de dominio.
4. Un slice agrupa comando/consulta, casos de uso, validación, puertos necesarios, pruebas y contrato de salida. Los puertos compartidos del módulo se mantienen en `application/ports` cuando convenga.
5. La composición de dependencias se hace en un composition root.
6. No se permiten accesos directos entre repositorios de módulos distintos. La coordinación ocurre a través de contratos de aplicación/eventos.
7. Configuración estricta de TypeScript: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`; prohibir `any` explícito mediante ESLint.
8. Validar todo input externo en runtime. Los tipos TypeScript no sustituyen la validación HTTP.
9. Errores de dominio tipados; middleware central de errores, códigos HTTP consistentes.
10. Transacciones para operaciones que modifican pedido, parada y ruta de forma coordinada.
11. Nombres semánticos en inglés para código, base de datos, endpoints y documentos de arquitectura. Interfaz de usuario en español.
12. IDs internos UUID; códigos públicos legibles separados de identificadores y tokens de rastreo.

## 4. Propuesta de estructura

```text
logistics-platform/
├── apps/
│   ├── api/
│   │   ├── src/
│   │   │   ├── modules/
│   │   │   │   ├── identity-and-access/
│   │   │   │   ├── customers/
│   │   │   │   ├── delivery-orders/
│   │   │   │   ├── delivery-routes/
│   │   │   │   ├── dispatch/
│   │   │   │   ├── drivers/
│   │   │   │   ├── fleet-management/
│   │   │   │   ├── delivery-execution/
│   │   │   │   ├── live-tracking/
│   │   │   │   └── public-tracking/
│   │   │   ├── shared/
│   │   │   ├── infrastructure/
│   │   │   └── main.ts
│   │   ├── migrations/
│   │   ├── Dockerfile
│   │   └── tsconfig.json
│   └── web/
│       ├── src/
│       └── Dockerfile
├── packages/
│   └── api-contracts/
├── docs/
│   ├── architecture/
│   │   ├── context.md
│   │   ├── containers.md
│   │   ├── deployment.md
│   │   └── decisions/
│   ├── product/
│   ├── modules/
│   └── api/
├── docker-compose.yml
├── docker-compose.demo.yml
├── .env.example
└── README.md
```

### Plantilla interna por módulo

```text
module-name/
├── domain/
│   ├── entities/
│   ├── value-objects/
│   ├── events/
│   ├── policies/
│   └── errors/
├── application/
│   ├── ports/
│   └── use-cases/
│       └── use-case-name/
│           ├── CommandOrQuery.ts
│           ├── UseCase.ts
│           └── Result.ts
├── infrastructure/
│   ├── persistence/
│   ├── http/
│   └── messaging/
├── composition/
├── tests/
└── docs/
    ├── README.md
    ├── architecture.md
    ├── business-rules.md
    ├── data-model.md
    ├── api-contracts.md
    └── decisions.md
```

## 5. Modelo de negocio inicial

Todas las entidades del modelo pertenecen a una `Organization` (plataforma multi-tenant, ver apartado 11).

- `CustomerAccount`: empresa que contrata servicios.
- `DeliveryOrder`: pedido a transportar, con destinatario y dirección de entrega.
- `DeliveryRoute`: recorrido planificado y ejecutado por vehículo y conductor.
- `DeliveryStop`: parada física, secuenciada y con coordenadas.
- `DeliveryStopOrder`: relación que permite varios pedidos por parada.
- `Driver`: conductor.
- `Vehicle`: vehículo y disponibilidad.
- `VehiclePosition`: lectura GPS con fecha de captura y recepción.
- `DeliveryAttempt`: resultado de un intento de entrega (exitoso o fallido).
- `ProofOfDelivery`: constancia de entrega asociada a pedido e intento, con receptor, fecha, ubicación opcional y archivos.
- `DeliveryEvidence`: metadatos de fotografías adjuntas a una entrega o incidencia, referenciando un objeto almacenado fuera de PostgreSQL.
- `IncidentEvidence`: relación entre una incidencia y uno o varios archivos de evidencia.
- `TrackingAccessToken`: permiso público revocable por pedido.
- `OperationalIncident`: evento o incidencia de operación.

Invariantes prioritarias:
1. Una ruta contiene una o varias paradas; una parada puede tener varios pedidos.
2. Un pedido no pertenece a dos rutas activas simultáneamente.
3. Un vehículo/conductor no puede tener asignaciones activas incompatibles.
4. La confirmación de cada entrega es independiente del movimiento GPS.
5. La entrega de un pedido no termina automáticamente la ruta.
6. El seguimiento público nunca revela otros pedidos/paradas/clientes.
7. Una posición sin actualización debe mostrarse como última posición conocida, no como ubicación actual.
8. Toda operación que cambia estados se audita.
9. La confirmación de entrega es por pedido, incluso si varios pedidos comparten parada.
10. Una entrega confirmada requiere al menos una fotografía válida en el MVP, salvo excepción autorizada y auditada.
11. Una incidencia puede asociarse a un pedido, parada o ruta; para incidencias de entrega, exige categoría, descripción y al menos una evidencia fotográfica, salvo excepción autorizada.
12. Adjuntar evidencias no cambia por sí solo el estado del pedido; debe ejecutarse el caso de uso correspondiente.
13. El cliente público no tiene acceso por defecto a todas las evidencias internas; sólo a las expresamente permitidas.
14. Toda incidencia de entrega registrada marca el intento como fallido y el pedido retorna a almacén (`returned`); no hay reintentos en campo. Un nuevo reparto es una nueva decisión de despacho del operador.

## 6. Documentación obligatoria por módulo

- `README.md`: responsabilidad, alcance, límites, dependencias y escenarios.
- `architecture.md`: componentes, puertos/adaptadores, dependencias, diagramas Mermaid (C4/sequence cuando aplique), transacciones y eventos.
- `business-rules.md`: estados, invariantes, decisiones, validaciones, casos límite y ejemplos.
- `data-model.md`: entidades de dominio, Value Objects, DTO, persistencia, nulabilidad, enums, índices, constraints y diccionario de datos.
- `api-contracts.md`: endpoints, request/response, errores, JWT/permisos, filtros, paginación y ejemplos; OpenAPI como fuente de verdad para HTTP.
- `decisions.md`: ADR locales, justificaciones y riesgos.
- Pruebas de dominio/unidad, integración con PostgreSQL, pruebas HTTP y pruebas de autorización.

Definition of Done: código tipado, lint y tests pasan, migración generada y probada cuando aplica, API documentada, reglas de negocio documentadas y docker build correcto.

## 7. Seguridad y JWT: ratificado (2026-10-26)

- Access JWT de 15 min, firmado con algoritmo permitido explícitamente.
- Refresh token rotativo de 7 días con persistencia server-side (hash), revocación y detección de reutilización.
- Frontend web: refresh token en cookie HttpOnly, Secure y SameSite=Strict; sin token CSRF extra en el MVP.
- Logout revoca el refresh token actual (la sesión del dispositivo).
- Validar `iss`, `aud`, `exp`, `nbf`, `sub`, `jti` y algoritmo esperado.
- Hash de contraseñas: Argon2id; rate limiting de login.
- RBAC mínimo: ADMIN, DISPATCHER, DRIVER; cliente empresarial como futuro rol autenticado.
- Control de pertenencia a la organización y propiedad de recursos en cada caso de uso.
- Rastreo público mediante token opaco de alta entropía, no JWT de sesión ni código de pedido; vencimiento y revocación.
- WebSocket autenticado/autorizado; suscripciones por organización, ruta y pedido según permisos.
- HTTPS, CORS restrictivo, headers de seguridad, redacción de PII en logs y auditoría.

## 8. GPS, mapas y ETA: propuestas pendientes

- GPS simulado en el servidor como proveedor que implementa `PositionProvider`.
- Fuente GPS real futura usando el mismo contrato, sin tocar dominio.
- Posición con `recordedAt`, `receivedAt`, precisión, velocidad y fuente.
- Frecuencia demo: 3–5 segundos; consolidación e historial configurable.
- Para calles: motor de routing OSRM/Valhalla/servicio de mapas (decisión pendiente).
- ETA calculada inicialmente con heurística explícita y señalada como estimación, nunca valor garantizado.
- Ventana de acceso público: definir si se muestra posición exacta solo al aproximarse o mientras el pedido está en reparto.

## 9. Operación y despliegue Docker

Servicios mínimos: `web`, `api`, `postgres`, `minio` (objetos de evidencias en demo). PostGIS opcional recomendado. Servicios opcionales: `redis` (más adelante), `reverse-proxy` si se necesita HTTPS local/demo, `gps-simulator` si se desacopla del API.

- Dockerfiles multi-stage y ejecución como usuario no-root.
- Healthchecks, `depends_on` con readiness adecuado y volúmenes persistentes para PostgreSQL.
- Migraciones como job separado; `synchronize: false`.
- `.env.example`, secretos fuera del repositorio, perfiles `development`, `test`, `demo`.
- CI: lint, typecheck, unit, integration, build images.
- Backups y procedimiento de restore antes de operar con clientes reales.


## 9A. Evidencias de entrega e incidencias (requisito MVP confirmado)

### Experiencia del motorizado
- En **Mi ruta → Parada → Pedido**, mostrar acciones `Confirmar entrega` y `Reportar incidencia`.
- **Confirmar entrega**: capturar o seleccionar fotografías con cámara del móvil, previsualizar, eliminar/repetir una toma, registrar nombre del receptor (si aplica) y observación opcional. No cerrar el pedido hasta que se hayan guardado las fotos obligatorias y se confirme explícitamente la entrega.
- **Reportar incidencia**: elegir categoría (`recipient_absent`, `incorrect_address`, `delivery_refused`, `damaged_package`, `access_restricted`, `vehicle_issue`, `other`), escribir descripción, adjuntar fotografías y registrar fecha/hora. Toda incidencia registrada marca el intento como fallido y el pedido retorna a almacén (`returned`); no hay reintentos en campo en el MVP (aplica a destinatario ausente, dirección equivocada, falta de respuesta del destinatario y demás categorías). Un nuevo reparto es una nueva decisión de despacho del operador.
- Las evidencias deben quedar vinculadas al **pedido e intento de entrega**, y opcionalmente a la parada/ruta; no asociarlas únicamente al conductor o a la ruta.
- Si el usuario está sin conexión, la demo mostrará error y reintento explícito; soporte offline confiable queda para una fase posterior.

### Hexagonal + slices
- Módulo propietario: `delivery-execution`, con slices `confirm-delivery`, `report-delivery-incident`, `attach-delivery-evidence`, `attach-incident-evidence`, `get-delivery-evidence`.
- Puerto `EvidenceObjectStorage` con adaptador `S3EvidenceObjectStorage`; en Docker demo usar MinIO.
- Puertos `DeliveryAttemptRepository`, `DeliveryEvidenceRepository` e `IncidentRepository` (contratos del módulo); contratos internos entre módulos en vez de consultas directas a su persistencia.
- No almacenar imágenes binarias en PostgreSQL: persistir sólo metadatos (`objectKey`, `mimeType`, `byteSize`, `checksum`, `uploadedBy`, `createdAt`, `orderId`, `attemptId`, `incidentId?`).
- Estado inicial `pending_upload` y posterior `available`; limpieza de objetos huérfanos y consistencia ante fallos de DB/almacenamiento.

### Contratos HTTP propuestos (sujetos a OpenAPI)

```http
POST /api/v1/delivery-orders/:orderId/evidence
POST /api/v1/delivery-orders/:orderId/confirm-delivery
POST /api/v1/delivery-orders/:orderId/incidents
POST /api/v1/incidents/:incidentId/evidence
GET  /api/v1/delivery-orders/:orderId/evidence
GET  /api/v1/evidence/:evidenceId/download-url
```

Todas las operaciones requieren JWT y verificación servidor de que el motorizado está asignado al pedido/ruta activos. El administrador/operador accede sólo a evidencias de su organización. Los archivos se sirven mediante URL firmada de duración corta o endpoint de streaming autorizado, nunca bucket público.

### Seguridad y validación
- Permitir JPEG, PNG y WebP (formatos exactos a cerrar); límite inicial propuesto: 5 MB por foto, hasta 5 fotografías por entrega/incidencia.
- Verificar contenido real del archivo, no sólo extensión ni `Content-Type`; usar nombres/keys generados por servidor y bloquear archivos ejecutables.
- Eliminar metadatos EXIF/GPS de las versiones compartibles para proteger ubicación y datos personales; conservar sólo los datos operativos explícitamente consentidos y necesarios.
- Requerir HTTPS, controles de autorización sobre descarga y retención/borrado definidos.
- En el tracking público mostrar `Entregado` y la constancia permitida, no compartir por defecto fotos de incidencias.

### Pruebas de aceptación
1. Un motorizado autenticado puede adjuntar dos fotos al pedido asignado y confirmar la entrega.
2. Sin foto obligatoria la confirmación es rechazada con error de negocio explícito.
3. Puede reportar ausencia de destinatario con foto y explicación; el pedido pasa a intento fallido y retorna a almacén.
4. Dos pedidos en la misma parada tienen evidencias y estados independientes.
5. Otro conductor y otro cliente no pueden leer o modificar fotografías ajenas.
6. Al fallar la subida, el pedido no figura entregado.
7. Administración ve fotos e incidencias desde el detalle de pedido y recibe actualización en tiempo real.

## 10. Plan por fases (estimación inicial)

| Fase | Entregables | Dependencias |
|---|---|---|
| 0. Fundaciones | Monorepo, Docker, PostgreSQL, TS strict, arquitectura, lint, testing, CI, OpenAPI, logging y healthchecks | Ninguna |
| 1. Identidad y catálogos | JWT, roles, empresas/clientes, conductores, vehículos | Fase 0 |
| 2. Pedidos | CRUD pedidos, destinatarios, direcciones, estados, eventos | Fase 1 |
| 3. Rutas y despacho | Múltiples paradas/pedidos, secuencia y asignación | Fase 2 |
| 4. Ejecución | Vista conductor, fotos de entrega, incidencias con fotos, carga y visualización segura de evidencias | Fase 3 |
| 5. Rastreo | Simulación GPS, WebSocket, mapa administrativo, tracking público | Fases 3–4 |
| 6. Demo integral | Dashboard, seeds Lima, pruebas e2e, hardening, despliegue | Fases anteriores |

Estimación revisable: el plazo de 4 semanas solo es plausible con alcance controlado y pruebas acotadas; el compromiso debe validarse tras la Fase 0.

## 11. Decisiones pendientes (orden recomendado)

### Bloqueantes — RATIFICADAS (2026-10-26)
1. **Tenancy**: plataforma multi-tenant desde el inicio con `organizationId` en cada entidad/agregado.
2. **Identidad**: usuarios creados únicamente por ADMIN (invitación); cliente corporativo fuera del MVP (solo tracking público con token). Roles MVP: ADMIN, DISPATCHER, DRIVER.
3. **Pedido**: un pedido puede tener uno o varios bultos (`Package`); creación manual + importación CSV; franjas horarias simples (AM/PM), ampliables después.
4. **Rutas**: planificación manual; reasignación y redespacho. Política de incidencias: toda incidencia registrada marca el intento como fallido y el pedido retorna a almacén (`returned`), sin reintentos en campo (destinatario ausente, dirección equivocada, no responde, etc.). Un nuevo reparto es una nueva decisión de despacho. La falta de respuesta del destinatario se registra con la categoría `other` (sin categoría propia).
5. **GPS**: demo 100% simulada en el MVP; el contrato `PositionProvider` aísla la fuente para un proveedor real futuro.
6. **Frontend**: React + TypeScript con stack propio; Vite + Tailwind + shadcn/ui; Leaflet para empezar, con la capa de mapas aislada para migrar a MapLibre sin dolor.
7. **Política JWT**: access 15 min; refresh rotativo de 7 días con detección de reutilización; cookie HttpOnly + Secure + SameSite=Strict (sin token CSRF extra en MVP); logout revoca el refresh actual.

### A definir durante Fundaciones
8. **Validaciones y contratos**: Zod + OpenAPI; generación/compartición de tipos públicos.
9. **IDs y fechas**: UUIDv7 o UUIDv4; hora America/Lima en todo el sistema (decidido, ver sección 2).
10. **Geo**: habilitar PostGIS, geocodificación, restricciones del área Lima y proveedor de rutas.
11. **Eventos**: WebSocket nativo `ws`; garantías de entrega, reconexión y replay/snapshot.
12. **Errores/observabilidad**: formato de errores, correlation IDs, logs estructurados y métricas.
13. **Calidad**: Vitest/Jest, Supertest, Testcontainers, Playwright; umbral de cobertura y CI.
14. **Convenciones**: formatos de nombres de archivos/clases/tablas/columnas, imports y reglas ESLint.
15. **Documentación**: README por módulo, ADR, Mermaid, OpenAPI y diagramas C4.
16. **Entorno demo**: hosting, dominio, TLS, costes, seeds, reset reproducible y política de datos ficticios.
17. **Seguridad**: tratamiento de datos personales, control de acceso público, retención GPS, rate limits y backups.
18. **Operación**: tratamiento de concurrencia, idempotencia, estados, reintentos y evidencia de entrega.
19. **Evidencias**: almacenamiento S3 compatible (MinIO en Docker demo), formato/tamaño máximo, compresión, política de retención, cantidad mínima de fotos y permisos de descarga.

## 12. Siguiente hito

Las decisiones bloqueantes están cerradas (ver apartado 11). Crear ADR-001 (monolito modular hexagonal + slices), ADR-002 (PostgreSQL/TypeORM), ADR-003 (JWT), modelo conceptual de datos y el primer módulo piloto `delivery-orders` con sus documentos y pruebas.
