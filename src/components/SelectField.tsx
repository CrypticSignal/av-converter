import TextField from '@mui/material/TextField';

export interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** [value, label] pairs. */
  options: readonly (readonly [string, string])[];
  helperText?: React.ReactNode;
}

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
    {options.map(([optionValue, optionLabel]) => (
      <option key={optionValue} value={optionValue}>{optionLabel}</option>
    ))}
  </TextField>
);

export default SelectField;
