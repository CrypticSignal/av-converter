import React from "react";

interface FlacProps {
  onFlacCompressionChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  flacCompression: string;
}

const Flac: React.FC<FlacProps> = ({ onFlacCompressionChange, flacCompression }) => {
  return (
    <div id="flac">
      <p>Set your desired compression level via the slider:</p>
      <input
        className="slider"
        type="range"
        onChange={onFlacCompressionChange}
        min={0}
        max={12}
        step={1}
        defaultValue={5}
        value={flacCompression}
      />
      <span id="flac_value" />
      {` ${flacCompression}`}
      <br />
      <i>A higher value means a slighter smaller file size, but a longer conversion time.</i>
    </div>
  );
};

export default Flac;
