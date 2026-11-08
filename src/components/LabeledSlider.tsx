import Slider from './Slider';

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

/** A slider with a visible label and its current value. Values are strings, as in the settings. */
const LabeledSlider = ({ id, label, value, onChange, min, max, step, unit }: LabeledSliderProps) => {
  const format = (number: number) => unit ? `${number} ${unit}` : String(number);
  return (
    <div id={id} className="mx-auto my-4 w-full max-w-80 text-left">
      <Slider
        label={label}
        valueText={format(Number(value))}
        value={Number(value)}
        min={min}
        max={max}
        step={step}
        formatValue={format}
        onChange={newValue => onChange(String(newValue))}
      />
    </div>
  );
};

export default LabeledSlider;
