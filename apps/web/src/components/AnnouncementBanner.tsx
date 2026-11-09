import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from './ui/button.js';

function wasDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === 'dismissed';
  } catch {
    return false;
  }
}

/** Aviso destacado que se puede ocultar durante la sesión. El degradado mantiene 4.5:1 con el texto blanco. */
export function AnnouncementBanner({ storageKey, icon: Icon, action, children }: {
  readonly storageKey: string;
  readonly icon: LucideIcon;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  const [dismissed, setDismissed] = useState(() => wasDismissed(storageKey));
  if (dismissed) return null;

  function dismiss() {
    setDismissed(true);
    try {
      sessionStorage.setItem(storageKey, 'dismissed');
    } catch {
      // Sin almacenamiento, el aviso solo vuelve a aparecer al recargar.
    }
  }

  return (
    <div role="status" className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg bg-linear-to-r from-[#b4400f] via-[#c2460d] to-[#ca4d0e] px-4 py-2 text-sm text-white">
      <div className="flex min-w-0 items-center gap-3">
        <Icon className="size-5 shrink-0" aria-hidden="true" />
        <p>{children}</p>
      </div>
      <div className="flex items-center gap-1">
        {action}
        <Button type="button" variant="ghost" onClick={dismiss}>Ocultar</Button>
      </div>
    </div>
  );
}
