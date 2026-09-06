import type { ButtonHTMLAttributes } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'quiet';
  block?: boolean;
}

export function Button({ variant = 'primary', block, className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={['btn', `btn--${variant}`, block && 'btn--block', className]
        .filter(Boolean)
        .join(' ')}
    />
  );
}
