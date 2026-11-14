import { useState, type FormEvent } from 'react';

import type { ApiClient, DeliveryOrder, DeliveryOrderImportResult } from '../../api/client.js';
import { FormSheet } from '../../components/FormSheet.js';
import { ErrorNotice } from '../../components/Notices.js';
import { Alert, AlertDescription } from '../../components/ui/alert.js';
import { Button } from '../../components/ui/button.js';
import { Field, FieldDescription, FieldLabel } from '../../components/ui/field.js';
import { Input } from '../../components/ui/input.js';

type ImportClient = Pick<ApiClient, 'importDeliveryOrders' | 'downloadDeliveryOrderImportTemplate'>;

export function OrderImportSheet({ client, open, onOpenChange, onImported }: {
  readonly client: ImportClient;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onImported: (orders: readonly DeliveryOrder[]) => void;
}) {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<DeliveryOrderImportResult | null>(null);

  async function importOrders(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (importFile === null) {
      setImportError('Selecciona un archivo CSV o XLSX.');
      return;
    }
    setImportError(null);
    setImportResult(null);
    setImporting(true);
    try {
      const result = await client.importDeliveryOrders(importFile);
      setImportResult(result);
      onImported(result.importedOrders);
    } catch (cause) {
      setImportError(cause instanceof Error
        ? `No se pudo importar el archivo. ${cause.message}`
        : 'No se pudo importar el archivo. Inténtalo de nuevo.');
    } finally {
      setImporting(false);
    }
  }

  async function downloadTemplate() {
    setImportError(null);
    setDownloadingTemplate(true);
    try {
      const blob = await client.downloadDeliveryOrderImportTemplate();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'delivery-orders-template.xlsx';
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      setImportError('No se pudo descargar la plantilla. Inténtalo de nuevo.');
    } finally {
      setDownloadingTemplate(false);
    }
  }

  return (
    <FormSheet open={open} onOpenChange={onOpenChange} title="Importar pedidos"
      description="CSV o Excel XLSX · una fila por bulto · máximo 5 MB."
      onSubmit={(event) => void importOrders(event)}
      footer={(
        <>
          <Button type="button" variant="outline" onClick={() => void downloadTemplate()} disabled={downloadingTemplate}>
            {downloadingTemplate ? 'Descargando…' : 'Descargar plantilla Excel'}
          </Button>
          <Button type="submit" disabled={importing || importFile === null}>
            {importing ? 'Importando…' : 'Importar pedidos'}
          </Button>
        </>
      )}>
      <Field>
        <FieldLabel htmlFor="order-import-file">Archivo de pedidos (CSV/XLSX)</FieldLabel>
        <Input id="order-import-file" type="file" disabled={importing}
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => {
            setImportFile(event.target.files?.[0] ?? null);
            setImportError(null);
            setImportResult(null);
          }} />
        <FieldDescription>
          {importFile === null ? 'Si es tu primera importación, descarga la plantilla y complétala.' : `Archivo elegido: ${importFile.name}`}
        </FieldDescription>
      </Field>
      {importError !== null && <ErrorNotice>{importError}</ErrorNotice>}
      {importResult !== null && (
        <Alert role="status">
          <AlertDescription>
            <p>
              Importación finalizada: {importResult.importedOrders.length}{' '}
              {importResult.importedOrders.length === 1 ? 'pedido importado' : 'pedidos importados'} y{' '}
              {importResult.rejectedOrders.length} {importResult.rejectedOrders.length === 1 ? 'pedido rechazado' : 'pedidos rechazados'}.
            </p>
            {importResult.rejectedOrders.length > 0 && (
              <ul aria-label="Pedidos rechazados" className="flex flex-col gap-1">
                {importResult.rejectedOrders.map((rejected, index) => (
                  <li key={`${rejected.publicCode ?? 'unknown'}-${index}`}>
                    <strong>{rejected.publicCode ?? 'Pedido sin código'}</strong>
                    {' · filas '}{rejected.rowNumbers.join(', ')}
                    {rejected.issues.map((issue, issueIndex) => (
                      <span key={`${issue.field}-${issue.rowNumber}-${issueIndex}`}>
                        {' · '}{issue.field} (fila {issue.rowNumber}): {issue.message}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </AlertDescription>
        </Alert>
      )}
    </FormSheet>
  );
}
