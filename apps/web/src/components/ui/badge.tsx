import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger';

export function Badge({ children, tone = 'neutral' }: {
  readonly children: ReactNode;
  readonly tone?: BadgeTone;
}) {
  return <span className={`status-pill status-${tone}`}>{children}</span>;
}
