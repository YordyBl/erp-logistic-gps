import { CircleAlert, CircleCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { Alert, AlertDescription } from './ui/alert.js';
import { Skeleton } from './ui/skeleton.js';

export function ErrorNotice({ children, action }: { readonly children: ReactNode; readonly action?: ReactNode }) {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertDescription>
        <p>{children}</p>
        {action}
      </AlertDescription>
    </Alert>
  );
}

export function SuccessNotice({ children }: { readonly children: ReactNode }) {
  return (
    <Alert role="status">
      <CircleCheck aria-hidden="true" />
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}

/** Filas de carga con su texto para lectores de pantalla. */
export function LoadingRows({ label, rows = 3 }: { readonly label: string; readonly rows?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => <Skeleton key={index} className="h-12 w-full" />)}
    </div>
  );
}
