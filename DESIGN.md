# ERP Logistic: sistema de diseño

Interfaz de operación para reparto de última milla en Lima y Callao. Los controles (botones, inputs, selects y demás) son **shadcn/ui de fábrica**, en tema claro. La composición de las pantallas es libre: iconos, mapas, visuales con datos reales y estados vacíos que orientan, sin espacio en blanco desaprovechado.

## Reglas de producto

- **Sin módulos que no existan.** Lo que no exista en el ERP no se simula.
- **Sin cifras inventadas.** Cada número sale de la API o de un cálculo sobre ella. Sin dato hay estado vacío.
- **Español de Perú y hora de Lima** (`America/Lima`) en todas las fechas.

## Base técnica

- Estilo `radix-vega`, color base `neutral`, iconos `lucide`, Tailwind 4 (`apps/web/components.json`).
- Tipografía Inter Variable, la del preset, autoalojada con `@fontsource-variable/inter`.
- `apps/web/src/styles.css` contiene el tema, los colores, la regla de cursor y el estilo de documento (`.doc-form`). No hay CSS por pantalla.

## `components/ui`

Se instala y actualiza con `npx shadcn@latest add`. No se edita, salvo estas excepciones:

1. **`sidebar.tsx`:** `data-active={isActive || undefined}` en `SidebarMenuButton` y `SidebarMenuSubButton`, porque `data-active="false"` también activa el estilo.
2. **`sidebar.tsx` y `sheet.tsx`:** textos ocultos en español.
3. **`badge.tsx`:** forma rectangular con borde y fondo suave; variantes `success`, `info` y `warning`. Los tokens `--badge-*` están en `styles.css`.

`className` sirve únicamente para colocar (ancho, rejilla, márgenes). No se pisan tamaño, radio, sombra ni tipografía.

## Color

| Token | Valor | Motivo |
|---|---|---|
| `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring` | `#0c7a4b` | Marca, con texto blanco |
| `--muted-foreground` | `oklch(0.5 0 0)` | El de fábrica (`0.556`) da 4.35:1 sobre `--muted` |
| `--destructive` | `#b4232f` | El de fábrica da 3.97:1 sobre su propio fondo al 10 % |
| `--success` / `--success-foreground` | `#e3f4ea` / `#0b5c39` | Variante `success` de `Badge` |
| `--warning` / `--warning-foreground` | `#fff4d6` / `#6f4e00` | Variante `warning` de `Badge` |
| `--status-*`, `--chart-1` a `--chart-5` | Ver `styles.css` | Un color fijo por estado de pedido |

Los demás tokens y `--radius` (`0.625rem`) son los de fábrica. `--muted` es un fondo: el texto usa `text-muted-foreground`.

**Pendiente de decisión:** el botón primario en hover (`hover:bg-primary/80` de fábrica) baja a 3.68:1. Ver el informe de la Fase 2.

## Composición propia

Fuera de `components/ui` se compone con libertad, sin restilizar los controles.

| Componente | Para qué |
|---|---|
| `FormFields.tsx` | `TextField`, `SelectField`, `DateField`: `Field`, etiqueta, error y placeholder obligatorio por tipo |
| `DatePicker.tsx` | `Calendar` + `Popover`; recibe y entrega `YYYY-MM-DD` |
| `Notices.tsx` | `ErrorNotice`, `SuccessNotice` y `LoadingRows` |
| `PageHeader.tsx` | Título, descripción y acciones de cada pantalla |
| `OrderStatusBadge.tsx` | Estado de pedido con su etiqueta y variante |
| `FormSheet.tsx` | Registro o edición en panel lateral; el estado queda en quien lo usa y cerrar no borra lo escrito. `paper` y `DocumentSheet` lo muestran como documento |
| `data-table/DataTable.tsx` | Tabla con búsqueda, filtros punteados, orden, columnas visibles y paginación (`@tanstack/react-table` 8) |
| `data-table/columnHelpers.tsx` | Cabecera ordenable, menú de tres puntos y barra de avance para celdas |
| `AnnouncementBanner.tsx` | Aviso con degradado que se oculta durante la sesión |
| `ActivityTimeline.tsx` | Eventos con fecha en columna fija e icono sobre la línea |
| `CardArt.tsx` | Fondos vectoriales propios: destellos y esferas |
| `IconChip.tsx` | Icono sobre fondo suave con color de estado |
| `management/routes/` | Avance real por ruta (`routeProgress.ts`) y paradas en vertical u horizontal (`RouteTimeline.tsx`) |
| `management/dashboard/` | `OperationsMap` de solo lectura y `OrderStatusBar` |

## Patrones

- **Armazón:** como `sidebar-07`, con `SidebarProvider`, `Sidebar collapsible="icon"`, `SidebarInset` y `SidebarTrigger`. `Ctrl+B` activo. "Pedidos" es un `Collapsible` con `SidebarMenuSub`; la cuenta es un `DropdownMenu`.
- **Login:** dos tarjetas sobre fondo gris: mapa isométrico a la izquierda (`public/login-map.svg`) y formulario a la derecha.
- **Formularios:** los registros y ediciones van en `FormSheet`, con `FieldGroup` + `Field`. Los `Input` conservan la validación nativa (`required`, `pattern`, `minLength`, `maxLength`). `Select` y `DatePicker` no la aplican, así que se validan con mensaje en español mediante `FieldError`.
- **`pattern`:** se compila con el flag `v`. Los patrones viven en `lib/patterns.ts`, con test, porque uno inválido se ignora sin avisar.
- **Fechas:** `lib/dates.ts`. Nunca `new Date('YYYY-MM-DD')`, que se interpreta como UTC y en Lima muestra el día anterior.
- **Dialog sin `DialogTrigger`:** usa `useFocusReturn` para devolver el foco a quien lo abrió.
- **Estados:** carga con `Skeleton`, vacío con `Empty`, error y avisos con `Alert`. Un fallo nunca se presenta como lista vacía. Un cero sano dice lo que sí ocurrió (por ejemplo, "Sin incidencias hoy" con las entregas del día) y el Resumen muestra su hora de actualización.
- **Botones:** tamaño por defecto; `icon-sm` solo para cerrar diálogos.
- **Tarjetas:** solo para lo destacado. Las tablas y los buscadores van directos sobre la página.
- **Tablas:** `DataTable` en los listados, con acciones en un menú de tres puntos y detalle al pulsar la fila. En móvil se desplazan dentro de su contenedor, no la página.
- **Indicadores:** solo el Resumen lleva tarjetas de cifras. Las demás pantallas resumen sus cifras en la línea bajo el título, para no repetir el mismo bloque.
- **Estados:** un solo nombre por estado de pedido, en `delivery/orderStatus.ts`.
- **Paneles:** la clase `.doc-form` de `styles.css` aplica fuente Geist Mono, campos de una línea y una trama rayada en lo pendiente; al enfocar aparece el placeholder. Los controles siguen siendo los de shadcn.
- **Imágenes:** los fondos son vectores propios. No se copian imágenes de plantillas de terceros.
- **Cursor:** todo lo accionable lleva `cursor: pointer`, por pedido del usuario.

## Verificación

Capturas a 1440 y 390 px, sin errores de consola ni scroll horizontal, y contraste medido: 4.5:1, o 3:1 en texto grande. Los scripts están en `capturas-rediseno/scripts-verificacion`.
