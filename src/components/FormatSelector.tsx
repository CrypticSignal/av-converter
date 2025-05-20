import React from "react";

interface FormatSelectorProps {
  onCodecChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  codec: string;
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
        <option value="AAC">AAC</option>
        <option value="AC3">AC3 (Dolby Digital)</option>
        <option value="ALAC">ALAC (.m4a)</option>
        <option value="CAF">CAF (.caf)</option>
        <option value="DTS">DTS (.dts)</option>
        <option value="FLAC">FLAC (.flac)</option>
        <option value="H264">H.264/AVC (.mp4 or .mkv)</option>
        <option value="MKA">MKA (.mka)</option>
        <option value="MP3">MP3 (.mp3)</option>
        <option value="Opus">Opus (.opus)</option>
        <option value="Vorbis">Vorbis (.ogg)</option>
        <option value="WAV">WAV (.wav)</option>
      </select>
    </div>
  );
};

export default FormatSelector;
