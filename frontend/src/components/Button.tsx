import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'secondary' | 'quiet';

const base: React.CSSProperties = {
  font: 'inherit',
  fontSize: 15,
  fontWeight: 500,
  borderRadius: 'var(--radius)',
  // Every target clears 44px, including the quiet ones — a "not now" that is
  // hard to hit is a dark pattern, and this product leans on people declining.
  minHeight: 'var(--tap)',
  padding: '0 22px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  cursor: 'pointer',
  border: '1px solid transparent',
};

const variants: Record<Variant, React.CSSProperties> = {
  primary: { background: 'var(--clay)', color: 'var(--clay-on)' },
  secondary: { background: 'transparent', color: 'var(--ink)', borderColor: 'var(--border-strong)' },
  quiet: { background: 'transparent', color: 'var(--muted)', padding: '0 6px' },
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

export function Button({ variant = 'primary', style, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        ...base,
        ...variants[variant],
        ...(disabled ? { background: 'var(--sunken)', color: 'var(--stone)', cursor: 'not-allowed', borderColor: 'transparent' } : null),
        ...style,
      }}
    />
  );
}
