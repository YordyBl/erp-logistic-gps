/**
 * Site settings read at build time. Values still unknown stay as visible
 * bracketed markers so they cannot ship by accident.
 */

/**
 * Where «Ingresar» goes. In production nginx serves the ERP at /app on the same
 * host; in development the ERP runs on its own Vite server.
 */
export const APP_URL = import.meta.env.PUBLIC_APP_URL || (import.meta.env.DEV ? 'http://localhost:5173/app' : '/app');

/** WhatsApp number (digits only, with country code, e.g. 51900000123) that receives demo requests. */
export const WHATSAPP_NUMBER = (import.meta.env.PUBLIC_WHATSAPP_NUMBER ?? '').replace(/\D/g, '');

export const PENDING = {
  whatsapp: '[TU NÚMERO DE WHATSAPP]',
  price: '[TU PRECIO O «A CONVERSAR»]',
  company: '[RAZÓN SOCIAL Y RUC]',
} as const;

export const SITE = {
  name: 'ERP Logistic',
  title: 'ERP Logistic · Reparto de última milla en Lima y Callao',
  description:
    'Arma las rutas, sigue a tus motorizados y guarda la foto, la hora y quién recibió cada pedido. Sistema de reparto de última milla para empresas de Lima y Callao.',
} as const;

/** Hero copy, shared by the landing and the generated share image (/og.jpg). */
export const HERO = {
  tagline: 'Reparto de última milla en Lima y Callao',
  headline: { before: 'Cada entrega en Lima, con ', highlight: 'prueba', after: '.' },
} as const;
