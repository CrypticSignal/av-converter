import React from "react";
import BitrateSlider, { type BitrateSliderProps } from "./BitrateSlider";

interface OpusProps {
  onOpusEncodingTypeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  encodingType: string;
  bitrate: BitrateSliderProps;
}

const Opus: React.FC<OpusProps> = ({
  onOpusEncodingTypeChange,
  encodingType,
  bitrate,
}) => {
  return (
    <div id="Opus">
      <label htmlFor="opus_encoding_type">Encoding Type</label>
      <select onChange={onOpusEncodingTypeChange} value={encodingType}>
        <option disabled>Select Encoding Type</option>
        <option value="vbr">VBR (with a target bitrate)</option>
        <option value="cbr">CBR (Constant Bitrate)</option>
      </select>
      <BitrateSlider {...bitrate} />
      <i>
        Opus supports at most 256 kbps per channel. For mono audio, choose 256 kbps or less, or the
        conversion will fail.
      </i>
    </div>
  );
};

export default Opus;
