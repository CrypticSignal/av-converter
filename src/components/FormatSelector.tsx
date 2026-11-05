import { FORMATS, type Codec } from "../formats";
import SelectField from "./SelectField";

interface FormatSelectorProps {
  onCodecChange: (codec: Codec) => void;
  codec: Codec;
}

const OPTIONS = Object.entries(FORMATS).map(([value, { label }]) => [value, label] as const);

const FormatSelector = ({ onCodecChange, codec }: FormatSelectorProps) => (
  <SelectField id="codecs" label="Desired format" value={codec}
    onChange={value => onCodecChange(value as Codec)} options={OPTIONS} />
);

export default FormatSelector;
