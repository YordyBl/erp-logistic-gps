/** Fondos vectoriales propios para tarjetas destacadas. Son decoración: no llevan datos ni reciben clics. */

/** Posición en % y tamaño en px. Forman una banda arriba y una columna a la derecha, lejos del texto. */
const STARS: readonly (readonly [left: number, top: number, size: number, color: string])[] = [
  [6, 5, 8, 'var(--status-planned)'], [22, 8, 6, 'var(--status-in-transit)'], [38, 4, 8, 'var(--status-delivered)'],
  [54, 9, 5, 'var(--status-created)'], [68, 4, 9, 'var(--status-returned)'], [84, 8, 6, 'var(--status-assigned)'],
  [93, 26, 8, 'var(--status-in-transit)'], [84, 42, 5, 'var(--status-planned)'], [92, 58, 7, 'var(--status-returned)'],
  [80, 72, 6, 'var(--status-assigned)'], [91, 86, 8, 'var(--status-cancelled)'],
];

/** Destellos de colores que enmarcan la tarjeta. */
export function ConfettiArt() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {STARS.map(([left, top, size, color]) => (
        <svg key={`${left}-${top}`} viewBox="0 0 20 20" className="absolute" style={{ left: `${left}%`, top: `${top}%`, width: size * 2, height: size * 2 }}>
          <path d="M10 0Q11.5 8.5 20 10Q11.5 11.5 10 20Q8.5 11.5 0 10Q8.5 8.5 10 0Z" fill={color} />
        </svg>
      ))}
    </div>
  );
}

/**
 * Esferas suaves superpuestas en verde en la mitad derecha de la tarjeta, con el lado izquierdo
 * difuminado para que no se vea un corte. La tarjeta debe llevar `relative isolate overflow-hidden`
 * para que queden detrás del contenido. Con estas opacidades, el texto secundario mantiene 4.5:1
 * incluso donde coinciden las cuatro.
 */
export function SpheresArt() {
  return (
    <svg className="pointer-events-none absolute inset-y-0 right-0 -z-10 h-full w-1/2 [mask-image:linear-gradient(to_right,transparent,black_35%)]" viewBox="0 0 260 360" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
      <ellipse cx="190" cy="70" rx="130" ry="190" fill="var(--primary)" fillOpacity="0.04" />
      <ellipse cx="95" cy="110" rx="90" ry="170" fill="var(--status-assigned)" fillOpacity="0.06" />
      <circle cx="150" cy="290" r="145" fill="var(--primary)" fillOpacity="0.08" />
      <circle cx="45" cy="330" r="85" fill="var(--status-planned)" fillOpacity="0.06" />
    </svg>
  );
}
