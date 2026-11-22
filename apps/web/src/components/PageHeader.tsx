import type { ReactNode } from 'react';

export function PageHeader({ title, titleId, description, children }: {
  readonly title: string;
  readonly titleId?: string;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 id={titleId} className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description !== undefined && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children !== undefined && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}
