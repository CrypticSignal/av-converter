import SelectField from "./SelectField";
import SettingNote from "./SettingNote";

interface AC3Props {
  onAc3BitrateChange: (value: string) => void;
  ac3Bitrate: string;
}

const BITRATES = ["192", "384", "448", "640"].map(value => [value, `${value} kbps`] as const);

const AC3 = ({ onAc3BitrateChange, ac3Bitrate }: AC3Props) => (
  <div id="AC3">
    <SettingNote>
      The maximum number of output channels is 6. Therefore, audio with more than 6 channels (such
      as 7.1 surround) will get downmixed to 5.1.
    </SettingNote>
    <SelectField id="ac3_bitrate" label="Bitrate" value={ac3Bitrate} onChange={onAc3BitrateChange}
      options={BITRATES}
      helperText="A higher bitrate allows for potentially higher audio quality, at the expense of a larger file size." />
  </div>
);

export default AC3;
