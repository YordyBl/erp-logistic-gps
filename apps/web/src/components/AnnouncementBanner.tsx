import type { LucideIcon } from 'lucide-react';
import { useState, type ReactNode } from 'react';

import { Button } from './ui/button.js';
import { Card, CardContent } from './ui/card.js';

function wasDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === 'dismissed';
  } catch {
    return false;
  }
}

/** Aviso en forma de card que se puede ocultar durante la sesión. */
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
    <Card size="sm" role="status" className="py-2.5">
      <CardContent className="flex-row flex-nowrap items-center justify-between gap-4 px-3 text-sm">
        <div className="flex min-w-0 items-center gap-3">
          <Icon className="size-5 shrink-0 text-amber-600" aria-hidden="true" />
          <p>{children}</p>
        </div>
        <div className="flex shrink-0 items-center gap-4">
          {action}
          <Button type="button" variant="link" className="h-auto p-0 text-muted-foreground underline" onClick={dismiss}>Ocultar</Button>
        </div>
      </CardContent>
    </Card>
  );
}
