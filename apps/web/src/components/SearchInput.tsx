import { Search, X } from 'lucide-react';

import { Button } from './ui/button.js';
import { Input } from './ui/input.js';
import { Spinner } from './ui/spinner.js';

/** Buscador con icono: `label` lo nombra para lectores de pantalla; `busy` indica una consulta en curso. */
export function SearchInput({ value, onChange, placeholder, label = placeholder, busy = false, className = 'w-full sm:w-80' }: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly label?: string;
  readonly busy?: boolean;
  readonly className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <Input className="px-8" placeholder={placeholder} aria-label={label} autoComplete="off" value={value}
        onChange={(event) => onChange(event.target.value)} />
      {busy && <Spinner className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />}
      {!busy && value !== '' && (
        <Button type="button" variant="ghost" size="icon-xs" className="absolute top-1/2 right-1.5 -translate-y-1/2" aria-label="Limpiar búsqueda" onClick={() => onChange('')}>
          <X aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}
