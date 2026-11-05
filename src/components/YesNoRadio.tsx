import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';

interface YesNoRadioProps {
  name: string;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
}

/** A labelled pair of MUI radio buttons, with the values "yes" and "no". */
const YesNoRadio = ({ name, label, value, onChange, yesLabel = 'Yes', noLabel = 'No' }: YesNoRadioProps) => (
  <FormControl sx={{ my: 1.5 }}>
    <FormLabel id={`${name}_label`}>{label}</FormLabel>
    <RadioGroup row aria-labelledby={`${name}_label`} name={name} value={value ? 'yes' : 'no'}
      onChange={(_, newValue) => onChange(newValue === 'yes')} sx={{ justifyContent: 'center' }}>
      <FormControlLabel value="yes" control={<Radio />} label={yesLabel} />
      <FormControlLabel value="no" control={<Radio />} label={noLabel} />
    </RadioGroup>
  </FormControl>
);

export default YesNoRadio;
