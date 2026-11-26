import { useEffect, useState } from 'react';

import type { ApiClient } from '../api/client.js';
import { Skeleton } from '../components/ui/skeleton.js';

/** Miniatura de una foto privada: se descarga con la sesión y se libera al desmontar. */
export function EvidenceThumb({ client, evidenceId, alt }: {
  readonly client: Pick<ApiClient, 'downloadEvidence'>;
  readonly evidenceId: string;
  readonly alt: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    let objectUrl: string | null = null;
    client.downloadEvidence(evidenceId).then((blob) => {
      if (!current) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    }).catch(() => { if (current) setFailed(true); });
    return () => {
      current = false;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
    };
  }, [client, evidenceId]);

  if (failed) {
    return <div className="flex aspect-[4/3] items-center justify-center rounded-md bg-muted text-xs text-muted-foreground">Foto no disponible</div>;
  }
  if (url === null) return <Skeleton className="aspect-[4/3] w-full" />;
  return <img src={url} alt={alt} className="aspect-[4/3] w-full rounded-md object-cover" />;
}
