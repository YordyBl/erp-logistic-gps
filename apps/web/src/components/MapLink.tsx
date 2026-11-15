import { MapPin } from 'lucide-react';

import { Button } from './ui/button.js';

/** Opens a Google Maps URL in a new tab so the operator can check a location. */
export function MapLink({ href, label, iconOnly = false, variant = 'ghost' }: {
  readonly href: string;
  readonly label: string;
  readonly iconOnly?: boolean;
  readonly variant?: 'ghost' | 'outline';
}) {
  return (
    <Button asChild variant={variant} size={iconOnly ? 'icon-sm' : 'sm'}>
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label} title={label}>
        <MapPin aria-hidden="true" {...(iconOnly ? {} : { 'data-icon': 'inline-start' })} />
        {!iconOnly && label}
      </a>
    </Button>
  );
}
