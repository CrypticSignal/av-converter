import React from 'react';

type Variant = 'primary' | 'outline' | 'text';

const BASE = 'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition '
  + 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400 '
  + 'disabled:cursor-not-allowed';

/** The classes for each kind of button. Also used by FileInput, whose button is a <label>. */
export const BUTTON_CLASSES: Record<Variant, string> = {
  // The gradient call to action, e.g. Convert.
  primary: `${BASE} px-6 py-2.5 text-white bg-linear-to-br from-violet-500 via-indigo-500 to-cyan-500 `
    + 'shadow-[0_8px_24px_-8px_rgba(139,92,246,0.6)] '
    + 'hover:brightness-110 hover:-translate-y-px hover:shadow-[0_12px_32px_-8px_rgba(139,92,246,0.75)] '
    + 'active:translate-y-0 '
    + 'disabled:bg-none disabled:bg-white/10 disabled:text-white/40 disabled:shadow-none disabled:translate-y-0 disabled:brightness-100',
  // A quieter choice beside or after a primary one, e.g. Cancel.
  outline: `${BASE} px-5 py-2 text-sm text-slate-300 ring-1 ring-white/20 hover:bg-white/5 hover:text-white `
    + 'disabled:opacity-50 disabled:hover:bg-transparent',
  // A small inline action, e.g. "Set start here".
  text: `${BASE} px-3 py-1 text-sm text-violet-300 hover:bg-violet-500/10 hover:text-violet-200 `
    + 'disabled:text-slate-500 disabled:hover:bg-transparent',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

/** A button in one of the app's styles. It's type="button" unless a type is given. */
const Button = ({ variant = 'primary', type = 'button', className = '', ...props }: ButtonProps) => (
  <button type={type} className={`${BUTTON_CLASSES[variant]} ${className}`} {...props} />
);

export default Button;
