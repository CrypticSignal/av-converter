import ChoiceGroup from './ChoiceGroup';

interface YesNoRadioProps {
  name: string;
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
  yesLabel?: string;
  noLabel?: string;
}

/** A labelled pair of radio buttons, with the values "yes" and "no". */
const YesNoRadio = ({ name, label, value, onChange, yesLabel = 'Yes', noLabel = 'No' }: YesNoRadioProps) => (
  <ChoiceGroup name={name} label={label} value={value ? 'yes' : 'no'} onChange={newValue => onChange(newValue === 'yes')}
    options={[['yes', yesLabel], ['no', noLabel]]} />
);

export default YesNoRadio;
