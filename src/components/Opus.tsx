import React from "react";
import BitrateSlider from "./BitrateSlider";

interface OpusProps {
  onOpusEncodingTypeChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  encodingType: string;
  bitrate: string;
  onBitrateChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const Opus: React.FC<OpusProps> = ({
  onOpusEncodingTypeChange,
  encodingType,
  bitrate,
  onBitrateChange,
}) => {
  return (
    <div id="Opus">
      <label htmlFor="opus_encoding_type">Encoding Type</label>
      <select onChange={onOpusEncodingTypeChange} value={encodingType}>
        <option disabled>Select Encoding Type</option>
        <option value="vbr">VBR (with a target bitrate)</option>
        <option value="cbr">CBR (Constant Bitrate)</option>
      </select>
      <BitrateSlider value={bitrate} onChange={onBitrateChange} min="16" max="512" step="16" />
      <i>
        Opus supports at most 256 kbps per channel. For mono audio, choose 256 kbps or less, or the
        conversion will fail.
      </i>
    </div>
  );
};

export default Opus;
