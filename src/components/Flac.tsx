import LabeledSlider from "./LabeledSlider";
import SettingNote from "./SettingNote";

interface FlacProps {
  onFlacCompressionChange: (value: string) => void;
  flacCompression: string;
}

const Flac = ({ onFlacCompressionChange, flacCompression }: FlacProps) => (
  <div id="flac">
    <LabeledSlider id="flac_compression" label="Compression level" value={flacCompression}
      onChange={onFlacCompressionChange} min={0} max={12} step={1} />
    <SettingNote>A higher value means a slightly smaller file size, but a longer conversion time.</SettingNote>
  </div>
);

export default Flac;
