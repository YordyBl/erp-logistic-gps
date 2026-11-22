/** Base map style shared by every MapLibre map (ERP and public tracking). */
export const OPENFREEMAP_STYLE = import.meta.env.VITE_MAP_STYLE_URL?.trim() ||
  'https://tiles.openfreemap.org/styles/bright';
