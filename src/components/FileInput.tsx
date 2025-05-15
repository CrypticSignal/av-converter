import React from "react";

interface FileInputProps {
  onFileInput: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

const FileInput: React.FC<FileInputProps> = ({ onFileInput }) => {
  return (
    <div className="custom-file">
      <input
        accept=".mp3, .aac, .m4a, .wav, .flac, .ogg, .opus, .flv, .mp4, .avi, .wmv, .wma, .mka, .mkv, .MTS,
                .mts, .ac3, .3gp, .dts, .webm, .ADPCM, .adpcm, .spx, .caf, .mov, .dtshd, .thd, .aif, .aiff, .vob"
        type="file"
        className="custom-file-input"
        id="file_input"
        onInput={onFileInput}
      />
      <label id="file_input_label" className="custom-file-label">
        Select file
      </label>
    </div>
  );
};

export default FileInput;
