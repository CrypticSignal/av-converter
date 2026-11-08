import TextField from '@mui/material/TextField';

export interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** [value, label] pairs, or [value, label, group] to show the option under a group heading. */
  options: readonly (readonly [string, string] | readonly [string, string, string])[];
  helperText?: React.ReactNode;
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
 * A labelled MUI select. It renders a native <select>, which keeps the platform's own
 * picker on phones and works with the keyboard and screen readers out of the box.
 */
const SelectField = ({ id, label, value, onChange, options, helperText }: SelectFieldProps) => (
  <TextField
    select
    id={id}
    label={label}
    value={value}
    onChange={event => onChange(event.target.value)}
    helperText={helperText}
    size="small"
    fullWidth
    sx={{ maxWidth: 320, my: 1.5 }}
    slotProps={{ select: { native: true }, inputLabel: { shrink: true } }}
  >
    {groupOptions(options).map(({ group, options: grouped }, i) => group === undefined
      ? grouped.map(renderOption)
      : <optgroup key={`${group}-${i}`} label={group}>{grouped.map(renderOption)}</optgroup>)}
  </TextField>
);

export default SelectField;
