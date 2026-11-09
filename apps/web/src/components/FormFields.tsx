import type { ComponentProps } from 'react';

import { DatePicker } from './DatePicker.js';
import { Field, FieldError, FieldLabel } from './ui/field.js';
import { Input } from './ui/input.js';
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select.js';

export function TextField({ id, label, placeholder, ...input }: Omit<ComponentProps<typeof Input>, 'id' | 'placeholder'> & {
  readonly id: string;
  readonly label: string;
  /** Obligatorio por tipo: todo campo lleva un ejemplo útil además de su etiqueta. */
  readonly placeholder: string;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input id={id} placeholder={placeholder} {...input} />
    </Field>
  );
}

export interface SelectOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
}

/** El Select de Radix no aplica `required`: quien lo usa valida y pasa el mensaje en `error`. */
export function SelectField<Value extends string>({ id, label, placeholder, value, options, onChange, disabled, error }: {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: Value | '';
  readonly options: readonly SelectOption<Value>[];
  readonly onChange: (value: Value) => void;
  readonly disabled?: boolean;
  readonly error?: string | null;
}) {
  const invalid = error !== undefined && error !== null;
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select value={value} disabled={disabled}
        onValueChange={(next) => {
          const option = options.find((item) => item.value === next);
          if (option !== undefined) onChange(option.value);
        }}>
        <SelectTrigger id={id} className="w-full" aria-invalid={invalid || undefined}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
      {invalid && <FieldError>{error}</FieldError>}
    </Field>
  );
}

export function DateField({ id, label, placeholder, value, onChange, disabled, error }: {
  readonly id: string;
  readonly label: string;
  readonly placeholder: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly disabled?: boolean;
  readonly error?: string | null;
}) {
  const invalid = error !== undefined && error !== null;
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <DatePicker id={id} value={value} onChange={onChange} placeholder={placeholder} disabled={disabled} invalid={invalid} />
      {invalid && <FieldError>{error}</FieldError>}
    </Field>
  );
}
