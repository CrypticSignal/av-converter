import React, { useId } from 'react';

export interface ChoiceGroupProps<T extends string> {
  /** The radio buttons' name. */
  name: string;
  /** Shown above the choices, and used as the group's accessible name. */
  label?: string;
  /** The accessible name when no visible label is shown. */
  ariaLabel?: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly (readonly [T, React.ReactNode])[];
  className?: string;
}

/**
 * A set of radio buttons drawn as pills, for picking one of a few options.
 * They're real radio inputs, so arrow keys, forms and screen readers work as usual.
 */
const ChoiceGroup = <T extends string>({ name, label, ariaLabel, value, onChange, options, className = '' }: ChoiceGroupProps<T>) => {
  const labelId = useId();
  return (
    <div role="radiogroup" aria-labelledby={label ? labelId : undefined} aria-label={label ? undefined : ariaLabel}
      className={`my-3 ${className}`}>
      {label && <div id={labelId} className="mb-2 text-sm text-slate-400">{label}</div>}
      <div className="flex flex-wrap justify-center gap-2">
        {options.map(([optionValue, optionLabel]) => (
          <label key={optionValue}
            className="relative inline-flex cursor-pointer items-center gap-2 rounded-full bg-white/[0.03] px-4 py-1.5 text-sm
              text-slate-300 ring-1 ring-white/10 transition select-none
              hover:bg-white/[0.07] hover:text-white
              has-checked:bg-violet-500/20 has-checked:text-white has-checked:ring-violet-400/70
              has-checked:shadow-[0_0_20px_-6px_rgba(139,92,246,0.8)]
              has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-violet-400
              has-disabled:cursor-not-allowed has-disabled:opacity-50">
            <input type="radio" name={name} value={optionValue} checked={value === optionValue}
              onChange={() => onChange(optionValue)}
              // Invisible, but covering the whole pill, so clicks land on the input itself.
              className="peer absolute inset-0 m-0 cursor-pointer appearance-none rounded-full opacity-0 disabled:cursor-not-allowed" />
            {/* A small dot that lights up on the chosen option. */}
            <span aria-hidden="true"
              className="h-2 w-2 rounded-full bg-slate-600 transition peer-checked:bg-linear-to-br peer-checked:from-violet-400 peer-checked:to-cyan-300" />
            {optionLabel}
          </label>
        ))}
      </div>
    </div>
  );
};

export default ChoiceGroup;
