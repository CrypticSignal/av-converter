import React from "react";

interface NumberInputProps {
  onVideoBitrateChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  videoBitrate: string;
  units: string;
}

const NumberInput: React.FC<NumberInputProps> = ({ onVideoBitrateChange, videoBitrate, units }) => {
  return (
    <div>
      <input type="number" onChange={onVideoBitrateChange} value={videoBitrate}></input>
      <span> {units}</span>
    </div>
  );
};

export default NumberInput;
