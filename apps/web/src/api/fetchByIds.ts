import type { Page, PageParams } from './client.js';

/** Página máxima del servidor: cada petición por `ids` pide como mucho estas filas. */
export const IDS_CHUNK_SIZE = 100;

/**
 * Trae por id, en lotes de {@link IDS_CHUNK_SIZE}, las filas que otra pantalla necesita (por ejemplo, los
 * pedidos de las rutas visibles). Ignora ids repetidos; los de otra organización simplemente no llegan.
 */
export async function fetchByIds<T>(
  fetchPage: (params: PageParams, signal?: AbortSignal) => Promise<Page<T>>,
  ids: readonly string[],
  signal?: AbortSignal,
): Promise<readonly T[]> {
  const unique = [...new Set(ids)];
  const chunks: string[][] = [];
  for (let start = 0; start < unique.length; start += IDS_CHUNK_SIZE) {
    chunks.push(unique.slice(start, start + IDS_CHUNK_SIZE));
  }
  const pages = await Promise.all(chunks.map((chunk) => fetchPage({ ids: chunk, pageSize: IDS_CHUNK_SIZE }, signal)));
  return pages.flatMap((page) => page.data);
}
