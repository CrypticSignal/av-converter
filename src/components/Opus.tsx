import BitrateSlider, { type BitrateSliderProps } from "./BitrateSlider";
import SelectField from "./SelectField";
import SettingNote from "./SettingNote";

interface OpusProps {
  onOpusEncodingTypeChange: (value: string) => void;
  encodingType: string;
  bitrate: BitrateSliderProps;
}

const ENCODING_TYPES = [["vbr", "VBR (with a target bitrate)"], ["cbr", "CBR (Constant Bitrate)"]] as const;

const Opus = ({ onOpusEncodingTypeChange, encodingType, bitrate }: OpusProps) => (
  <div id="Opus">
    <SelectField id="opus_encoding_type" label="Encoding type" value={encodingType}
      onChange={onOpusEncodingTypeChange} options={ENCODING_TYPES} />
    <BitrateSlider {...bitrate} />
    <SettingNote>
      Opus supports at most 256 kbps per channel. For mono audio, choose 256 kbps or less, or the
      conversion will fail.
    </SettingNote>
  </div>
);

export default Opus;
