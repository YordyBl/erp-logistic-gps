import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Camera, CircleAlert, RadioTower, Route, ShieldCheck, type LucideIcon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { BrandMark } from '../components/BrandMark.js';
import { IconChip } from '../components/IconChip.js';
import { Alert, AlertDescription } from '../components/ui/alert.js';
import { Button } from '../components/ui/button.js';
import { Card } from '../components/ui/card.js';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../components/ui/field.js';
import { Input } from '../components/ui/input.js';
import { Spinner } from '../components/ui/spinner.js';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Ingresa tu correo.').pipe(z.email('Ingresa un correo válido.')),
  password: z.string().min(1, 'Ingresa tu contraseña.'),
});

type LoginValues = z.infer<typeof loginSchema>;

const HIGHLIGHTS: readonly { readonly icon: LucideIcon; readonly title: string; readonly detail: string }[] = [
  { icon: Route, title: 'Despacho', detail: 'Rutas con varias paradas y pedidos.' },
  { icon: RadioTower, title: 'Torre de control', detail: 'Rutas activas y su última posición.' },
  { icon: Camera, title: 'Evidencia', detail: 'Cada entrega confirmada con foto.' },
];

export function LoginScreen({ onSubmit, error }: {
  readonly onSubmit: (email: string, password: string) => Promise<void>;
  readonly error: string | null;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  return (
    <div className="grid min-h-svh grid-rows-[auto_1fr] gap-4 bg-muted p-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:grid-rows-1">
      <Card className="relative h-44 overflow-hidden p-0 lg:h-auto" role="complementary" aria-label="Información de la plataforma">
        <img src="/login-map.svg" alt="" className="absolute inset-0 size-full object-cover max-lg:object-[50%_18%]" />
        <div className="relative hidden flex-col gap-2 bg-linear-to-b from-card via-card/90 to-transparent p-10 pb-24 lg:flex">
          <p className="max-w-lg text-3xl font-semibold tracking-tight text-balance">
            Del almacén al último destinatario, cada parada queda registrada.
          </p>
        </div>
        <ul className="absolute inset-x-6 bottom-6 hidden gap-3 lg:grid xl:grid-cols-3">
          {HIGHLIGHTS.map(({ icon, title, detail }) => (
            <li key={title} className="flex items-start gap-3 rounded-lg border bg-card p-3 shadow-sm">
              <IconChip icon={icon} tone="primary" />
              <span className="flex min-w-0 flex-col">
                <span className="text-sm font-medium">{title}</span>
                <span className="text-xs text-muted-foreground">{detail}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="justify-center">
        <main className="flex flex-col px-6 py-4 md:px-10">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-8">
            <div className="self-center"><BrandMark /></div>
            <form className="flex flex-col gap-6" noValidate
              onSubmit={(event) => void handleSubmit(({ email, password }) => onSubmit(email, password))(event)}>
              <FieldGroup>
                <div className="flex flex-col items-center gap-1 text-center">
                  <h1 className="text-2xl font-bold">La ruta sigue contigo.</h1>
                  <p className="text-sm text-balance text-muted-foreground">Ingresa para ejecutar entregas o revisar la evidencia de tus pedidos.</p>
                </div>
                <Field data-invalid={errors.email !== undefined || undefined}>
                  <FieldLabel htmlFor="email">Correo operativo</FieldLabel>
                  <Input id="email" type="email" autoComplete="username" placeholder="nombre@empresa.pe" aria-invalid={errors.email !== undefined} {...register('email')} />
                  <FieldError>{errors.email?.message}</FieldError>
                </Field>
                <Field data-invalid={errors.password !== undefined || undefined}>
                  <FieldLabel htmlFor="password">Contraseña</FieldLabel>
                  <Input id="password" type="password" autoComplete="current-password" placeholder="Tu contraseña" aria-invalid={errors.password !== undefined} {...register('password')} />
                  <FieldError>{errors.password?.message}</FieldError>
                </Field>
                {error !== null && (
                  <Alert variant="destructive">
                    <CircleAlert aria-hidden="true" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Field>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting
                      ? <><Spinner data-icon="inline-start" aria-label="Ingresando" /> Ingresando…</>
                      : <>Ingresar <ArrowRight data-icon="inline-end" aria-hidden="true" /></>}
                  </Button>
                  <FieldDescription className="flex items-center justify-center gap-2">
                    <ShieldCheck className="size-4 shrink-0" aria-hidden="true" /> Acceso privado · sesión protegida
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </div>
        </main>
      </Card>
    </div>
  );
}
