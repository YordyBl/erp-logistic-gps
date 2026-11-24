/** Descarga un archivo generado o recibido de la API con el nombre indicado. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export type CsvCell = string | number | null;

/**
 * CSV para Excel en español: separador `;` (la coma es el separador decimal en la configuración
 * regional peruana de Excel), comillas cuando hacen falta y BOM para que respete las tildes.
 */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  const cell = (value: CsvCell) => {
    const text = value === null ? '' : String(value);
    return /[";\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return `${BOM}${rows.map((row) => row.map(cell).join(';')).join('\r\n')}\r\n`;
}

/** Marca de orden de bytes: Excel la necesita para leer el CSV como UTF-8. */
const BOM = String.fromCharCode(0xfeff);

export function csvBlob(rows: readonly (readonly CsvCell[])[]): Blob {
  return new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
}
