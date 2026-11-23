# Sitio público (apps/site)

Landing para empresas de reparto, construida con Astro como HTML estático. En producción nginx la sirve en `/`, junto al ERP en `/app` (ver `apps/web/Dockerfile`).

```bash
npm run dev -w apps/site      # http://localhost:4321 («Ingresar» apunta a Vite en :5173/app)
npm run build -w apps/site    # genera apps/site/dist
```

Variables (al compilar):

| Variable | Uso |
|---|---|
| `SITE_URL` | Dominio público. Activa la URL canónica, `og:url` y el host del sitemap. |
| `PUBLIC_WHATSAPP_NUMBER` | Número que recibe las solicitudes de demo, solo dígitos con código de país (`51900000123`). |
| `PUBLIC_APP_URL` | Opcional. Dónde lleva «Ingresar»; por defecto `/app`. |

Datos pendientes: mientras no existan se ven entre corchetes en la página (`[TU NÚMERO DE WHATSAPP]`, `[TU PRECIO O «A CONVERSAR»]`, `[RAZÓN SOCIAL Y RUC]`). Están en `src/config.ts`. La política de privacidad es un borrador con `noindex` hasta completarlos.

Los textos y datos de ejemplo están en `src/data/content.ts`. El mapa es un dibujo propio (`src/components/MapBackdrop.astro`), no una captura de un servicio de mapas.
