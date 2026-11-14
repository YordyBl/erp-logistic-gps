import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowRight, Camera, CircleAlert, Eye, EyeOff, Lock, Mail, RadioTower, Route, ShieldCheck, Truck, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { BrandMark } from '../components/BrandMark.js';
import { Alert, AlertDescription } from '../components/ui/alert.js';
import { Badge } from '../components/ui/badge.js';
import { Button } from '../components/ui/button.js';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card.js';
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '../components/ui/field.js';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '../components/ui/input-group.js';
import { Spinner } from '../components/ui/spinner.js';

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Ingresa tu correo.').pipe(z.email('Ingresa un correo válido.')),
  password: z.string().min(1, 'Ingresa tu contraseña.'),
});

type LoginValues = z.infer<typeof loginSchema>;

const HIGHLIGHTS: readonly { readonly icon: LucideIcon; readonly title: string; readonly detail: string }[] = [
  { icon: RadioTower, title: 'Torre de control', detail: 'Sigue las rutas activas y su última posición conocida, con el estado de cada parada en un solo lugar.' },
  { icon: Camera, title: 'Evidencia de entrega', detail: 'Cada entrega queda confirmada con foto, para revisar lo ocurrido sin llamadas ni mensajes de por medio.' },
  { icon: Route, title: 'Optimización de rutas', detail: 'Organiza paradas y conductores para completar más entregas con menos recorrido.' },
];

export function LoginScreen({ onSubmit, error }: {
  readonly onSubmit: (email: string, password: string) => Promise<void>;
  readonly error: string | null;
}) {
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="grid min-h-svh grid-rows-[auto_1fr] gap-0 lg:grid-cols-2 lg:grid-rows-1">
      <div className="relative min-h-80 overflow-hidden lg:min-h-0" role="complementary" aria-label="Información de la plataforma">
        <img src="/lima-costa.webp" alt="" className="absolute inset-0 size-full object-cover" />
        <div className="absolute inset-0 bg-black/20 backdrop-blur-xs" />

        <div className="absolute inset-0 flex flex-col items-center justify-center px-6 py-8 text-white">
          <div className="flex w-full max-w-md flex-col gap-6">
            <Badge variant="outline" className="h-auto w-fit gap-2 rounded-full border-green-300/50 bg-green-500/30 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
              <Truck className="size-4 text-green-300" aria-hidden="true" />
              Plataforma de Logística
            </Badge>

            <div className="flex flex-col gap-2 text-left">
              <h2 className="text-3xl font-bold">Logística Inteligente</h2>
              <p className="text-sm text-green-50/90">Gestiona entregas en tiempo real con nuestra plataforma completa</p>
            </div>

            <div className="flex flex-col gap-3">
              {HIGHLIGHTS.map(({ icon: Icon, title, detail }) => (
                <Card key={title} size="sm" className="border-green-400/30 bg-white/10 backdrop-blur-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-green-300/70 hover:bg-white/20 hover:shadow-lg">
                  <CardContent className="flex flex-row items-center gap-3">
                    <Card size="sm" className="size-10 shrink-0 items-center justify-center border-green-400/30 bg-green-400/15 py-0 ring-0 shadow-none">
                      <Icon className="size-5 text-green-300" aria-hidden="true" />
                    </Card>
                    <div className="flex flex-col gap-1">
                      <CardTitle className="text-sm font-semibold text-white">{title}</CardTitle>
                      <CardDescription className="text-xs text-green-50/80">{detail}</CardDescription>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="flex w-full items-center justify-center bg-card">
        <main className="flex w-full flex-col px-6 py-4 md:px-10">
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
                  <InputGroup className="h-11">
                    <InputGroupAddon><Mail aria-hidden="true" /></InputGroupAddon>
                    <InputGroupInput id="email" type="email" autoComplete="username" placeholder="nombre@empresa.pe" aria-invalid={errors.email !== undefined} {...register('email')} />
                  </InputGroup>
                  <FieldError>{errors.email?.message}</FieldError>
                </Field>
                <Field data-invalid={errors.password !== undefined || undefined}>
                  <FieldLabel htmlFor="password">Contraseña</FieldLabel>
                  <InputGroup className="h-11">
                    <InputGroupAddon><Lock aria-hidden="true" /></InputGroupAddon>
                    <InputGroupInput id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Tu contraseña" aria-invalid={errors.password !== undefined} {...register('password')} />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton size="icon-sm" aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} onClick={() => setShowPassword((v) => !v)}>
                        {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <FieldError>{errors.password?.message}</FieldError>
                </Field>
                {error !== null && (
                  <Alert variant="destructive">
                    <CircleAlert aria-hidden="true" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}
                <Field>
                  <Button type="submit" className="h-11" disabled={isSubmitting}>
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
      </div>
    </div>
  );
}
