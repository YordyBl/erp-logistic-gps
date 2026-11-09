import { Check, ImageIcon, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { ApiError, type ApiClient, type DeliveryEvidence, type DeliveryOrder } from '../api/client.js';
import { SelectField } from '../components/FormFields.js';
import { Alert, AlertDescription } from '../components/ui/alert.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import {
  Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '../components/ui/dialog.js';
import { Field, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { Textarea } from '../components/ui/textarea.js';
import { useFocusReturn } from '../hooks/use-focus-return.js';
import { MAX_EVIDENCE_FILES, validateEvidenceFiles } from './evidence.js';
import { INCIDENT_CATEGORIES } from './incidentCategories.js';

type Outcome = 'delivery' | 'incident';

interface PendingPhoto {
  readonly file: File;
  readonly idempotencyKey: string;
  readonly previewUrl: string;
}

interface OutcomeDialogProps {
  readonly order: DeliveryOrder;
  readonly client: ApiClient;
  readonly outcome: Outcome;
  readonly onComplete: () => void | Promise<void>;
  readonly onClose: () => void;
}

const CATEGORY_OPTIONS = INCIDENT_CATEGORIES.map(([value, label]) => ({ value, label }));

export function OutcomeDialog({ order, client, outcome, onComplete, onClose }: OutcomeDialogProps) {
  const [pending, setPending] = useState<readonly PendingPhoto[]>([]);
  const [uploaded, setUploaded] = useState<readonly DeliveryEvidence[]>([]);
  const [receiverName, setReceiverName] = useState('');
  const [notes, setNotes] = useState('');
  const [category, setCategory] = useState<(typeof INCIDENT_CATEGORIES)[number][0]>('recipient_absent');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef(pending);
  const { onCloseAutoFocus } = useFocusReturn(document.activeElement);

  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => () => {
    for (const photo of pendingRef.current) {
      if (photo.previewUrl !== '') URL.revokeObjectURL(photo.previewUrl);
    }
  }, []);

  function addPhotos(files: FileList | null): void {
    if (files === null || files.length === 0) return;
    const selected = Array.from(files);
    const remainingCount = uploaded.length + pending.length + selected.length;
    if (remainingCount > MAX_EVIDENCE_FILES) {
      setError('Puedes adjuntar hasta 2 fotos.');
      return;
    }
    const validation = validateEvidenceFiles([...pending.map((photo) => photo.file), ...selected]);
    if (validation !== null) {
      setError(validation);
      return;
    }
    setError(null);
    setMessage(null);
    setPending((current) => [...current, ...selected.map((file) => ({
      file,
      idempotencyKey: crypto.randomUUID(),
      previewUrl: typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : '',
    }))]);
  }

  function removePhoto(photo: PendingPhoto): void {
    if (photo.previewUrl !== '') URL.revokeObjectURL(photo.previewUrl);
    setPending((current) => current.filter((item) => item.idempotencyKey !== photo.idempotencyKey));
  }

  async function savePhotos(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      for (const photo of pending) {
        const saved = await client.uploadEvidence(order.id, photo.file, photo.idempotencyKey);
        setUploaded((current) => [...current, saved]);
        removePhoto(photo);
      }
      setMessage('Fotos guardadas.');
    } catch (cause) {
      const detail = cause instanceof ApiError
        ? cause.message
        : 'No se pudo guardar la foto. La entrega sigue pendiente; reintenta la carga.';
      setError(`No se pudo guardar la foto. ${detail}`);
    } finally {
      setBusy(false);
    }
  }

  async function submitOutcome(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const evidenceIds = uploaded.map((photo) => photo.id);
      if (outcome === 'delivery') {
        await client.confirmDelivery({
          orderId: order.id,
          evidenceIds,
          receiverName: receiverName.trim() === '' ? null : receiverName.trim(),
          notes: notes.trim() === '' ? null : notes.trim(),
        });
      } else {
        await client.reportIncident({
          orderId: order.id,
          category,
          description: description.trim(),
          evidenceIds,
        });
      }
      await onComplete();
    } catch (cause) {
      setError(cause instanceof Error
        ? cause.message
        : 'No se pudo registrar el resultado. Inténtalo de nuevo.');
    } finally {
      setBusy(false);
    }
  }

  const isDelivery = outcome === 'delivery';
  const incidentDescriptionValid = description.trim().length >= 3 && description.trim().length <= 1000;
  const canSubmit = uploaded.length >= 1 && uploaded.length <= MAX_EVIDENCE_FILES &&
    (isDelivery || incidentDescriptionValid) && !busy;
  const title = isDelivery ? 'Confirmar entrega' : 'Reportar incidencia';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" showCloseButton={false} onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Pedido {order.publicCode}</DialogDescription>
        </DialogHeader>
        <DialogClose asChild>
          <Button variant="ghost" size="icon-sm" className="absolute top-2 right-2" aria-label="Cerrar"><X aria-hidden="true" /></Button>
        </DialogClose>

        <FieldGroup>
          {isDelivery ? (
            <>
              <Field>
                <FieldLabel htmlFor="receiver-name">Recibido por (opcional)</FieldLabel>
                <Input id="receiver-name" maxLength={120} value={receiverName} placeholder="Nombre de quien recibe"
                  onChange={(event) => setReceiverName(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="delivery-notes">Observación (opcional)</FieldLabel>
                <Textarea id="delivery-notes" maxLength={500} value={notes} placeholder="Añade un detalle útil para la operación"
                  onChange={(event) => setNotes(event.target.value)} />
              </Field>
            </>
          ) : (
            <>
              <SelectField id="incident-category" label="Categoría" placeholder="Selecciona una categoría"
                value={category} options={CATEGORY_OPTIONS} onChange={setCategory} />
              <Field>
                <FieldLabel htmlFor="incident-description">Descripción</FieldLabel>
                <Textarea id="incident-description" minLength={3} maxLength={1000} value={description}
                  placeholder="Describe qué ocurrió y qué necesita saber el operador"
                  onChange={(event) => setDescription(event.target.value)} />
              </Field>
            </>
          )}

          <FieldSet>
            <FieldLegend>Evidencia fotográfica · {uploaded.length + pending.length}/2</FieldLegend>
            <FieldDescription>1–2 fotos · JPEG, PNG o WebP · hasta 5 MB cada una</FieldDescription>
            <Field>
              <FieldLabel htmlFor="evidence-files">Elegir fotos</FieldLabel>
              {/* El navegador solo abre la cámara o el explorador desde un input de archivo. */}
              <Input id="evidence-files" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple
                aria-label={isDelivery ? 'Fotos de la entrega' : 'Fotos de la incidencia'}
                onChange={(event) => {
                  addPhotos(event.currentTarget.files);
                  event.currentTarget.value = '';
                }} />
              <FieldDescription>Usa la cámara o selecciona desde el dispositivo</FieldDescription>
            </Field>

            {(pending.length > 0 || uploaded.length > 0) && (
              <ul className="flex flex-col gap-2">
                {uploaded.map((photo) => (
                  <li key={photo.id} className="flex items-center gap-2 text-sm">
                    <Check className="size-4 shrink-0" aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">Foto guardada</span>
                    <Badge variant="success">Disponible</Badge>
                  </li>
                ))}
                {pending.map((photo) => (
                  <li key={photo.idempotencyKey} className="flex items-center gap-2 text-sm">
                    {photo.previewUrl === ''
                      ? <ImageIcon className="size-4 shrink-0" aria-hidden="true" />
                      : <img className="size-8 shrink-0 rounded-md object-cover" src={photo.previewUrl} alt={`Vista previa de ${photo.file.name}`} />}
                    <span className="min-w-0 flex-1 truncate">{photo.file.name}</span>
                    <Button type="button" variant="ghost" disabled={busy} onClick={() => removePhoto(photo)}>Quitar</Button>
                  </li>
                ))}
              </ul>
            )}

            {pending.length > 0 && (
              <Button type="button" variant="outline" onClick={() => void savePhotos()} disabled={busy}>
                {busy ? 'Guardando fotos…' : error !== null ? 'Reintentar carga' : 'Guardar fotos'}
              </Button>
            )}
            {message !== null && <Alert role="status"><AlertDescription>{message}</AlertDescription></Alert>}
            {error !== null && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          </FieldSet>
        </FieldGroup>

        <p className="text-sm text-muted-foreground">La evidencia guardada no se elimina al cerrar esta ventana.</p>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>Cancelar</Button>
          <Button type="button" variant={isDelivery ? 'default' : 'destructive'} onClick={() => void submitOutcome()} disabled={!canSubmit}>
            {busy ? 'Guardando…' : isDelivery ? 'Confirmar entrega' : 'Registrar incidencia'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
