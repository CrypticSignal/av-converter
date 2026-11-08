import React, { useId } from 'react';

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label: string;
  helperText?: React.ReactNode;
  /** Fixed text shown inside the field, before what's typed, e.g. "ffmpeg -i input.mp4". */
  prefix?: string;
  /** Classes for the wrapper, e.g. to set its width. */
  className?: string;
}

/** A text input with its label above it and optional help text below. */
const TextField = ({ label, helperText, prefix, className = '', id, required, ...inputProps }: TextFieldProps) => {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helperId = `${inputId}-helper`;
  const input = (
    <input id={inputId} required={required} aria-describedby={helperText ? helperId : undefined}
      className={prefix ? 'min-w-0 flex-1 bg-transparent py-2 pr-3.5 text-slate-100 outline-none placeholder:text-slate-500' : 'field'}
      {...inputProps} />
  );
  return (
    <div className={`text-left ${className}`}>
      <label htmlFor={inputId} className="mb-1.5 block text-xs font-medium text-slate-400">
        {label}{required && <span className="text-violet-300" aria-hidden="true"> *</span>}
      </label>
      {prefix ? (
        // The same look as .field, around the prefix and the input.
        <div className="flex items-center rounded-xl border border-white/12 bg-white/[0.03] transition
          hover:border-violet-400/60 focus-within:border-violet-400 focus-within:ring-4 focus-within:ring-violet-500/20
          has-disabled:opacity-50">
          <span title={prefix}
            className="max-w-1/2 shrink-0 truncate py-2 pl-3.5 pr-2 font-mono text-sm text-violet-300 select-none">
            {prefix}
          </span>
          {input}
        </div>
      ) : input}
      {helperText && <p id={helperId} className="mt-1.5 text-xs leading-relaxed text-slate-400">{helperText}</p>}
    </div>
  );
};

export default TextField;
