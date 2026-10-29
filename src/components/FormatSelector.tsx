import React from "react";
import { FORMATS, type Codec } from "../formats";

interface FormatSelectorProps {
  onCodecChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  codec: Codec;
}

const FormatSelector: React.FC<FormatSelectorProps> = ({ onCodecChange, codec }) => {
  return (
    <div className="my-4">
      <h5 className="text-lg font-semibold mb-2">Desired Format</h5> 
      <select 
        id="codecs" 
        onChange={onCodecChange} 
        value={codec}
        className="block w-full max-w-xs mx-auto px-3 py-2 bg-white border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
      >
        {Object.entries(FORMATS).map(([value, { label }]) => (
          <option key={value} value={value}>{label}</option>
        ))}
      </select>
    </div>
  );
};

export default FormatSelector;
