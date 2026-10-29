import React from "react";
import BitrateSlider from "./BitrateSlider";

interface DtsProps {
  bitrate: string;
  onBitrateChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const Dts: React.FC<DtsProps> = ({ bitrate, onBitrateChange }) => {
  return (
    <div id="DTS">
      <p>
        The maximum number of output channels is 6. Therefore, audio with more than 6 channels (such
        as 7.1 surround) will get downmixed to 5.1
      </p>
      <p>Set your desired bitrate via the slider:</p>
      <BitrateSlider value={bitrate} onChange={onBitrateChange} min="384" max="1536" step="128" />
      <i>
        A higher bitrate allows for potentially higher audio quality, at the expense of a larger
        file size.
      </i>
    </div>
  );
};

export default Dts;
