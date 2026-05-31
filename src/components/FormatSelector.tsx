import React from "react";

interface FormatSelectorProps {
  onCodecChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  codec: string;
}

const FormatSelector: React.FC<FormatSelectorProps> = ({ onCodecChange, codec }) => {
  return (
    <div className="my-4">
      <h5 className="text-lg font-semibold mb-2 text-slate-900">Desired Format</h5> 
      <select 
        id="codecs" 
        onChange={onCodecChange} 
        value={codec}
        className="block w-full max-w-xs mx-auto px-3 py-2 bg-white/90 border border-slate-200 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-sky-400 sm:text-sm"
      >
        <option value="AAC">AAC</option>
        <option value="AC3">AC3 (Dolby Digital)</option>
        <option value="ALAC">ALAC (.m4a)</option>
        <option value="CAF">CAF (.caf)</option>
        <option value="DTS">DTS (.dts)</option>
        <option value="FLAC">FLAC (.flac)</option>
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
