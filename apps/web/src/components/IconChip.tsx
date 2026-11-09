import type { LucideIcon } from 'lucide-react';

export type IconChipTone = 'primary' | 'success' | 'warning' | 'destructive' | 'neutral';

const TONE_CLASSES: Record<IconChipTone, string> = {
  primary: 'bg-primary/10 text-primary',
  success: 'bg-success text-success-foreground',
  warning: 'bg-warning text-warning-foreground',
  destructive: 'bg-destructive/10 text-destructive',
  neutral: 'bg-muted text-muted-foreground',
};

/** Icono sobre un fondo suave cuyo color indica el estado de lo que acompaña. */
export function IconChip({ icon: Icon, tone = 'neutral' }: {
  readonly icon: LucideIcon;
  readonly tone?: IconChipTone;
}) {
  return (
    <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${TONE_CLASSES[tone]}`}>
      <Icon className="size-4" aria-hidden="true" />
    </span>
  );
}
