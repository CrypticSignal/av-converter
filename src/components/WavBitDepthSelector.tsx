import SelectField from "./SelectField";

interface WavBitDepthSelectorProps {
  onBitDepthChange: (value: string) => void;
  bitDepth: string;
}

const BIT_DEPTHS = ["16", "24", "32"].map(value => [value, `${value}-bit`] as const);

const WavBitDepthSelector = ({ onBitDepthChange, bitDepth }: WavBitDepthSelectorProps) => (
  <div id="wav_bit_depth_div">
    <SelectField id="wav_bit_depth" label="Output bit depth (audio)" value={bitDepth}
      onChange={onBitDepthChange} options={BIT_DEPTHS} />
  </div>
);

export default WavBitDepthSelector;
