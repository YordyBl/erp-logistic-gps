import type { ReactNode } from 'react';

export function Card({ children, className = '' }: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <section className={`surface rounded-lg border bg-white shadow-sm ${className}`}>{children}</section>;
}
