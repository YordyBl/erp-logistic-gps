import { cn } from 'cn';

/** Marca de ERP Logistic: la misma línea de ruta que el favicon. */
export function BrandMark({ className }: { readonly className?: string }) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground" aria-hidden="true">
        <svg viewBox="0 0 24 24" className="size-4" fill="none">
          <path d="M6 17c6 0 2-10 12-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <circle cx="6" cy="17" r="2.4" fill="currentColor" />
          <circle cx="18" cy="7" r="2.4" fill="currentColor" />
        </svg>
      </span>
      <span className="grid flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
        <span className="truncate font-medium">ERP Logistic</span>
        <span className="truncate text-xs text-muted-foreground">Lima y Callao</span>
      </span>
    </span>
  );
}
