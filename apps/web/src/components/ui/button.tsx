import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly variant?: ButtonVariant }) {
  return <button className={`inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-colors button button-${variant} ${className}`} {...props} />;
}
