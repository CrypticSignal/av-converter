export interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** [value, label] pairs, or [value, label, group] to show the option under a group heading. */
  options: readonly (readonly [string, string] | readonly [string, string, string])[];
  helperText?: React.ReactNode;
  /** Fill the container's width, rather than a narrower centred column. */
  fullWidth?: boolean;
  disabled?: boolean;
}

type Option = SelectFieldProps['options'][number];

/** Group consecutive options that share a group, keeping their order. Ungrouped options stay at the top level. */
const groupOptions = (options: readonly Option[]) => {
  const groups: { group?: string; options: Option[] }[] = [];
  for (const option of options) {
    const group = option[2];
    const last = groups[groups.length - 1];
    if (last && last.group === group) last.options.push(option);
    else groups.push({ group, options: [option] });
  }
  return groups;
};

const renderOption = ([optionValue, optionLabel]: Option) =>
  <option key={optionValue} value={optionValue}>{optionLabel}</option>;

/**
 * A labelled native <select>, which keeps the platform's own picker on phones and works
 * with the keyboard and screen readers out of the box.
 */
const SelectField = ({ id, label, value, onChange, options, helperText, fullWidth, disabled }: SelectFieldProps) => (
  <div className={`text-left ${fullWidth ? '' : 'mx-auto my-3 max-w-80'}`}>
    <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-slate-400">{label}</label>
    <select id={id} value={value} disabled={disabled} onChange={event => onChange(event.target.value)}
      aria-describedby={helperText ? `${id}-helper` : undefined} className="field field-select">
      {groupOptions(options).map(({ group, options: grouped }, i) => group === undefined
        ? grouped.map(renderOption)
        : <optgroup key={`${group}-${i}`} label={group}>{grouped.map(renderOption)}</optgroup>)}
    </select>
    {helperText && <p id={`${id}-helper`} className="mt-1.5 text-xs leading-relaxed text-slate-400">{helperText}</p>}
  </div>
);

export default SelectField;
