import React from "react";

interface AC3Props {
  onAc3BitrateChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  ac3Bitrate: string;
}

const AC3: React.FC<AC3Props> = ({ onAc3BitrateChange, ac3Bitrate }) => {
  return (
    <div id="AC3">
      <p>
        The maximum number of output channels is 6. Therefore, audio with more than 6 channels (such
        as 7.1 surround) will get downmixed to 5.1
      </p>
      <label htmlFor="ac3_bitrate">Bitrate:</label>
      <select id="ac3_bitrate" onChange={onAc3BitrateChange} value={ac3Bitrate}>
        <option disabled>Select a Bitrate</option>
        <option value="192">192kbps</option>
        <option value="384">384kbps</option>
        <option value="448">448kbps</option>
        <option value="640">640kbps</option>
      </select>
      <br />
      <i>
        A higher bitrate allows for potentially higher audio quality, at the expense of a larger
        file size.
      </i>
    </div>
  );
};

export default AC3;
