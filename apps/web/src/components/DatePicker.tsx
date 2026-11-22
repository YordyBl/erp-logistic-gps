import { format } from 'date-fns';
import { es } from 'date-fns/locale/es';
import { CalendarIcon } from 'lucide-react';
import { useState } from 'react';

import { parseIsoDay, toIsoDay } from '../lib/dates.js';
import { Button } from './ui/button.js';
import { Calendar } from './ui/calendar.js';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover.js';

/** Selector de día: recibe y entrega `YYYY-MM-DD`, o cadena vacía si no hay fecha. */
export function DatePicker({ id, value, onChange, placeholder, disabled, invalid }: {
  readonly id: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder: string;
  readonly disabled?: boolean;
  readonly invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const selected = parseIsoDay(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button id={id} type="button" variant="outline" disabled={disabled} aria-invalid={invalid}
          data-empty={selected === undefined || undefined}
          className="w-full justify-start font-normal data-[empty=true]:text-muted-foreground">
          <CalendarIcon data-icon="inline-start" aria-hidden="true" />
          {selected === undefined ? placeholder : format(selected, 'PPP', { locale: es })}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar mode="single" locale={es} selected={selected} defaultMonth={selected} autoFocus
          onSelect={(date) => {
            onChange(date === undefined ? '' : toIsoDay(date));
            setOpen(false);
          }} />
      </PopoverContent>
    </Popover>
  );
}
