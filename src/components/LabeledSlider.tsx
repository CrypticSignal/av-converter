import Box from '@mui/material/Box';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';

export interface LabeledSliderProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step: number;
  /** Shown after the value, e.g. "kbps". */
  unit?: string;
}

/** An MUI slider with a visible label and its current value. Values are strings, as in the settings. */
const LabeledSlider = ({ id, label, value, onChange, min, max, step, unit }: LabeledSliderProps) => {
  const display = unit ? `${value} ${unit}` : value;
  return (
    <Box sx={{ width: '100%', maxWidth: 320, mx: 'auto', my: 1.5 }}>
      <Typography id={`${id}_label`} variant="body2" component="label" htmlFor={id}
        sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{label}</span>
        <strong>{display}</strong>
      </Typography>
      <Slider
        value={Number(value)}
        min={min}
        max={max}
        step={step}
        marks
        valueLabelDisplay="auto"
        valueLabelFormat={() => display}
        getAriaValueText={() => display}
        onChange={(_, newValue) => onChange(String(newValue))}
        slotProps={{ input: { id, 'aria-labelledby': `${id}_label` } }}
      />
    </Box>
  );
};

export default LabeledSlider;
