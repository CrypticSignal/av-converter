import BitrateSlider, { type BitrateSliderProps } from "./BitrateSlider";
import SettingNote from "./SettingNote";

interface DtsProps {
  bitrate: BitrateSliderProps;
}

const Dts = ({ bitrate }: DtsProps) => (
  <div id="DTS">
    <SettingNote>
      The maximum number of output channels is 6. Therefore, audio with more than 6 channels (such
      as 7.1 surround) will get downmixed to 5.1.
    </SettingNote>
    <BitrateSlider {...bitrate} />
    <SettingNote>
      A higher bitrate allows for potentially higher audio quality, at the expense of a larger file size.
    </SettingNote>
  </div>
);

export default Dts;
