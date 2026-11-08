import SettingNote from './SettingNote';
import YesNoRadio from './YesNoRadio';

interface DownmixControlProps {
  /** Whether the output's audio can't hold more than two channels (e.g. MP3), so it's always downmixed. */
  stereoOnly: boolean;
  value: boolean;
  onChange: (value: boolean) => void;
}

/**
 * The "Downmix to stereo?" choice, shown when the audio is encoded. Formats that can't hold
 * more than two channels are always downmixed, so they get a note instead of the choice.
 */
const DownmixControl = ({ stereoOnly, value, onChange }: DownmixControlProps) => stereoOnly ? (
  <SettingNote>This audio format holds at most two channels, so audio with more will be downmixed to stereo.</SettingNote>
) : (
  <div>
    <YesNoRadio name="downmix" label="Downmix to stereo?" value={value} onChange={onChange} />
  </div>
);

export default DownmixControl;
