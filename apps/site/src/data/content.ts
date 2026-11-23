/** Landing copy and sample data. Everything here describes what the product does today. */

export type Tone = 'green' | 'amber' | 'red' | 'gray';

export interface Pain {
  readonly pain: string;
  readonly title: string;
  readonly body: string;
  readonly code: string;
  readonly state: string;
  readonly tone: Tone;
  readonly rows: readonly { readonly k: string; readonly v: string }[];
}

export const PAINS: readonly Pain[] = [
  {
    pain: 'No sé qué salió hoy ni con quién', title: 'Cada pedido con ruta, conductor y estado',
    body: 'Sabes qué salió, en qué vehículo y en qué orden. Un pedido no puede estar en dos rutas activas a la vez.',
    code: 'LIM-0147', state: 'En ruta', tone: 'green',
    rows: [{ k: 'Ruta', v: 'R-0408 · parada 5' }, { k: 'Conductor', v: 'María Rojas' }, { k: 'Vehículo', v: 'Moto BXK-482' }, { k: 'Cliente', v: 'Librería Ática' }],
  },
  {
    pain: 'Me dicen «nunca me llegó»', title: 'Sin foto no hay entrega',
    body: 'Para confirmar una entrega el sistema pide al menos una foto. Queda quién recibió, la hora y el conductor responsable.',
    code: 'LIM-0142', state: 'Entregado', tone: 'green',
    rows: [{ k: 'Recibió', v: 'Carmen Paredes' }, { k: 'Hora', v: '18 nov · 10:42' }, { k: 'Fotos', v: '2, privadas' }, { k: 'Conductor', v: 'María Rojas' }],
  },
  {
    pain: 'No sé dónde está un pedido', title: 'Respondes con datos, no con suposiciones',
    body: 'Ves en qué parada va cada ruta y cuánto falta. Si el GPS se queda viejo, se muestra como última posición conocida.',
    code: 'R-0410', state: 'Sin señal', tone: 'gray',
    rows: [{ k: 'Conductor', v: 'Jorge Ccori' }, { k: 'Avance', v: '2 de 6 paradas' }, { k: 'Última posición', v: 'Hace 12 min' }, { k: 'Siguiente', v: 'Av. Brasil 1820, Jesús María' }],
  },
  {
    pain: 'Las rutas se arman de memoria', title: 'Paradas en orden, varios pedidos por parada',
    body: 'Armas la ruta con sus paradas y el motorizado la ve en orden en su celular. Si algo falla, reasignas conductor o vehículo.',
    code: 'R-0411', state: 'Por salir', tone: 'amber',
    rows: [{ k: 'Paradas', v: '7' }, { k: 'Pedidos', v: '11' }, { k: 'Conductor', v: 'Ana Quispe' }, { k: 'Vehículo', v: 'Camioneta AQT-219' }],
  },
  {
    pain: 'Las incidencias no quedan registradas', title: 'Cada falla, con evidencia',
    body: 'Destinatario ausente, dirección equivocada o paquete dañado: se reporta con foto, el intento queda fallido y el pedido vuelve al almacén.',
    code: 'LIM-0143', state: 'Incidencia', tone: 'red',
    rows: [{ k: 'Motivo', v: 'Destinatario ausente' }, { k: 'Hora', v: '18 nov · 11:05' }, { k: 'Foto', v: '1, privada' }, { k: 'Siguiente paso', v: 'Vuelve al almacén' }],
  },
];

/** Tab selected when the page loads: the strongest pain for a courier. */
export const DEFAULT_PAIN = 1;

export const FEATURES = [
  { title: 'Rutas en curso.', body: 'Avance de cada recorrido y su siguiente parada.' },
  { title: 'Reasignación.', body: 'Cambia conductor o vehículo cuando algo falla.' },
  { title: 'Historial auditado.', body: 'Quién cambió cada estado y cuándo.' },
  { title: 'Tus datos aislados.', body: 'Cada empresa ve solo su información.' },
] as const;

export const ROUTES: readonly { code: string; status: string; tone: Tone; driver: string; progress: string; pct: number }[] = [
  { code: 'R-0408', status: 'En ruta', tone: 'green', driver: 'María Rojas', progress: '2 de 5 paradas', pct: 40 },
  { code: 'R-0409', status: 'Incidencia', tone: 'red', driver: 'Luis Huamán', progress: '3 de 8 paradas', pct: 38 },
  { code: 'R-0410', status: 'Sin señal', tone: 'gray', driver: 'Jorge Ccori', progress: '2 de 6 paradas', pct: 33 },
  { code: 'R-0411', status: 'Por salir', tone: 'amber', driver: 'Ana Quispe', progress: '0 de 7 paradas', pct: 0 },
];

/** Icon paths are 24×24 stroke icons. */
export const DRIVER = [
  { title: 'Ruta en orden', body: 'Las paradas del día una tras otra, con su dirección y sus pedidos.', icon: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM8 17h7a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h7' },
  { title: 'Un pedido a la vez', body: 'Confirma cada pedido por separado, aunque compartan parada.', icon: 'M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9' },
  { title: 'Foto en la puerta', body: 'Sin al menos una foto, la entrega no se puede confirmar.', icon: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  { title: 'Incidencias con motivo', body: 'Ausente, dirección errada o paquete dañado, con foto. El pedido vuelve al almacén.', icon: 'M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z' },
  { title: 'Inicia y cierra su ruta', body: 'El operador ve cuándo salió y cuánto le falta.', icon: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z' },
  { title: 'Todo desde su celular', body: 'Ve su ruta y registra cada entrega desde el teléfono, con su propia cuenta.', icon: 'M7 3h10v18H7zM11 18h2' },
] as const;

export const RULES = [
  { title: 'Una entrega, una confirmación', body: 'Cada pedido se confirma por separado, aunque comparta parada.' },
  { title: 'Sin foto no hay entrega', body: 'Al menos una foto válida, salvo excepción autorizada y auditada.' },
  { title: 'Incidencia, de vuelta al almacén', body: 'Sin reintentos en la calle: salir de nuevo lo decide el operador.' },
  { title: 'Un pedido, una ruta activa', body: 'Nunca el mismo pedido en dos rutas al mismo tiempo.' },
  { title: 'GPS honesto', body: 'Una posición vieja se muestra como última posición conocida.' },
  { title: 'Todo queda registrado', body: 'Cada cambio de estado guarda quién lo hizo y cuándo.' },
] as const;

export const TRACKING = [
  { title: 'Con tu marca.', body: 'Tu logo y tu nombre; tu cliente no tiene que conocernos.' },
  { title: 'Solo su pedido.', body: 'No muestra otros pedidos, paradas ni clientes.' },
  { title: 'Sin crear cuenta.', body: 'Entra con el enlace que le llega por WhatsApp.' },
  { title: 'Foto de la entrega.', body: 'Cuando llega, ve la constancia de su pedido.' },
] as const;

export const TRACK_STEPS: readonly { title: string; detail: string; time: string; state: 'done' | 'current' | 'next' }[] = [
  { title: 'Pedido recibido', detail: 'Librería Ática registró tu pedido', time: '17 nov', state: 'done' },
  { title: 'Preparado para salir', detail: 'Asignado a la ruta de Barranco', time: '07:30', state: 'done' },
  { title: 'En camino', detail: '2 paradas antes de la tuya', time: '08:45', state: 'current' },
  { title: 'Entregado', detail: 'Aquí verás la foto de la entrega', time: '', state: 'next' },
];

export const FAQS = [
  { q: '¿Es un sistema contable o de facturación?', a: 'No. ERP Logistic cubre la operación del reparto: pedidos, rutas, entregas y evidencias. No emite facturas electrónicas SUNAT ni lleva contabilidad.' },
  { q: '¿Qué necesitan mis conductores?', a: 'Un celular con cámara e internet, y su cuenta. Ahí ven su ruta del día y registran cada entrega con foto.' },
  { q: '¿Necesito rastreadores GPS en los vehículos?', a: 'No. El sistema no depende de equipos instalados en la moto o la camioneta.' },
  { q: '¿Otras empresas pueden ver mis pedidos?', a: 'No. Cada empresa trabaja en un espacio aislado y las fotos de evidencia se guardan en privado.' },
  { q: '¿Qué pasa si el destinatario no está?', a: 'El conductor reporta la incidencia con foto, el intento queda fallido y el pedido vuelve al almacén. El operador decide cuándo salir de nuevo.' },
  { q: '¿El sistema ordena las rutas solo?', a: 'Hoy el operador arma el orden de las paradas. La optimización automática no está incluida por ahora.' },
] as const;

export const VOLUMES = ['Menos de 50', 'De 50 a 200', 'De 200 a 500', 'Más de 500'] as const;
