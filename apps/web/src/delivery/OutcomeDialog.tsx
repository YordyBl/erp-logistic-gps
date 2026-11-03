import { useEffect, useRef, useState } from 'react';

import { ApiError, type ApiClient, type DeliveryEvidence, type DeliveryOrder } from '../api/client.js';
import { MAX_EVIDENCE_FILES, validateEvidenceFiles } from './evidence.js';

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

const INCIDENT_CATEGORIES = [
  ['recipient_absent', 'Destinatario ausente'],
  ['incorrect_address', 'Dirección incorrecta'],
  ['delivery_refused', 'Entrega rechazada'],
  ['damaged_package', 'Paquete dañado'],
  ['access_restricted', 'Acceso restringido'],
  ['vehicle_issue', 'Problema con el vehículo'],
  ['other', 'Otro'],
] as const;

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

  async function savePhotos(): Promise<void> {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      for (const photo of pending) {
        const saved = await client.uploadEvidence(order.id, photo.file, photo.idempotencyKey);
        setUploaded((current) => [...current, saved]);
        setPending((current) => current.filter((item) => item.idempotencyKey !== photo.idempotencyKey));
        if (photo.previewUrl !== '') URL.revokeObjectURL(photo.previewUrl);
      }
      setMessage('Fotos guardadas.');
    } catch (cause) {
      const message = cause instanceof ApiError
        ? cause.message
        : 'No se pudo guardar la foto. La entrega sigue pendiente; reintenta la carga.';
      setError(`No se pudo guardar la foto. ${message}`);
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

  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeCallback = useRef(onClose);
  useEffect(() => { closeCallback.current = onClose; }, [onClose]);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    const handleCancel = (event: Event) => {
      event.preventDefault();
      closeCallback.current();
    };
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.addEventListener('cancel', handleCancel);
    return () => {
      dialog.removeEventListener('cancel', handleCancel);
      if (dialog.open && typeof dialog.close === 'function') dialog.close();
    };
  }, []);

  return (
    <dialog ref={dialogRef} className="outcome-dialog" aria-labelledby="outcome-title" aria-modal="true">
      <div className="dialog-heading">
        <div>
          <p className="section-label">Pedido {order.publicCode}</p>
          <h2 id="outcome-title">{isDelivery ? 'Confirmar entrega' : 'Reportar incidencia'}</h2>
        </div>
        <button className="icon-button" type="button" onClick={onClose} aria-label="Cerrar">
          <span aria-hidden="true">×</span>
        </button>
      </div>

      <div className="dialog-content">
        {isDelivery ? (
          <>
            <label className="field-label" htmlFor="receiver-name">Recibido por <span>(opcional)</span></label>
            <input id="receiver-name" className="text-input" maxLength={120} value={receiverName}
              onChange={(event) => setReceiverName(event.target.value)} placeholder="Nombre de quien recibe" />
            <label className="field-label" htmlFor="delivery-notes">Observación <span>(opcional)</span></label>
            <textarea id="delivery-notes" className="text-input text-area" maxLength={500} value={notes}
              onChange={(event) => setNotes(event.target.value)} placeholder="Añade un detalle útil para la operación" />
          </>
        ) : (
          <>
            <label className="field-label" htmlFor="incident-category">Categoría</label>
            <select id="incident-category" className="text-input" value={category}
              onChange={(event) => setCategory(event.target.value as typeof category)}>
              {INCIDENT_CATEGORIES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
            <label className="field-label" htmlFor="incident-description">Descripción</label>
            <textarea id="incident-description" className="text-input text-area" minLength={3} maxLength={1000}
              value={description} onChange={(event) => setDescription(event.target.value)}
              placeholder="Describe qué ocurrió y qué necesita saber el operador" />
          </>
        )}

        <section className="photo-section" aria-labelledby="photo-title">
          <div className="photo-heading">
            <div>
              <h3 id="photo-title">Evidencia fotográfica</h3>
              <p>1–2 fotos · JPEG, PNG o WebP · hasta 5 MB cada una</p>
            </div>
            <span className="photo-count">{uploaded.length + pending.length}/2</span>
          </div>
          <label className="upload-zone" htmlFor="evidence-files">
            <span className="upload-mark" aria-hidden="true">＋</span>
            <span><strong>Elegir fotos</strong><small>Usa la cámara o selecciona desde el dispositivo</small></span>
          </label>
          <input id="evidence-files" className="visually-hidden" type="file" accept="image/jpeg,image/png,image/webp"
            capture="environment" multiple aria-label={isDelivery ? 'Fotos de la entrega' : 'Fotos de la incidencia'}
            onChange={(event) => {
              addPhotos(event.currentTarget.files);
              event.currentTarget.value = '';
            }} />

          {(pending.length > 0 || uploaded.length > 0) && (
            <ul className="photo-list">
              {uploaded.map((photo) => (
                <li className="photo-row photo-row-saved" key={photo.id}>
                  <span className="photo-file-icon" aria-hidden="true">✓</span>
                  <span className="photo-file-name">Foto guardada</span>
                  <span className="status-pill status-success">Disponible</span>
                </li>
              ))}
              {pending.map((photo) => (
                <li className="photo-row" key={photo.idempotencyKey}>
                  {photo.previewUrl === '' ? <span className="photo-file-icon" aria-hidden="true">▧</span>
                    : <img className="photo-thumb" src={photo.previewUrl} alt={`Vista previa de ${photo.file.name}`} />}
                  <span className="photo-file-name">{photo.file.name}</span>
                  <button className="text-button" type="button" disabled={busy}
                    onClick={() => {
                      if (photo.previewUrl !== '') URL.revokeObjectURL(photo.previewUrl);
                      setPending((current) => current.filter((item) => item.idempotencyKey !== photo.idempotencyKey));
                    }}>Quitar</button>
                </li>
              ))}
            </ul>
          )}

          {pending.length > 0 && (
            <button className="button button-secondary button-full" type="button" onClick={() => void savePhotos()} disabled={busy}>
              {busy ? 'Guardando fotos…' : error !== null ? 'Reintentar carga' : 'Guardar fotos'}
            </button>
          )}
          {message !== null && <p className="inline-success" role="status">{message}</p>}
          {error !== null && <p className="inline-error" role="alert">{error}</p>}
        </section>
      </div>

      <div className="dialog-actions">
        <button className="button button-quiet" type="button" onClick={onClose} disabled={busy}>Cancelar</button>
        <button className={`button ${isDelivery ? 'button-primary' : 'button-danger'}`} type="button"
          onClick={() => void submitOutcome()} disabled={!canSubmit}>
          {busy ? 'Guardando…' : isDelivery ? 'Confirmar entrega' : 'Registrar incidencia'}
        </button>
      </div>
      <p className="dialog-footnote">La evidencia guardada no se elimina al cerrar esta ventana.</p>
    </dialog>
  );
}
