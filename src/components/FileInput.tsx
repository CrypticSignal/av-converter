import React from "react";
import Button from "@mui/material/Button";
import { styled } from "@mui/material/styles";

interface FileInputProps {
  onFileInput: (event: React.ChangeEvent<HTMLInputElement>) => void;
  filename: string;
}

const VisuallyHiddenInput = styled("input")({
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  height: 1,
  overflow: "hidden",
  position: "absolute",
  bottom: 0,
  left: 0,
  whiteSpace: "nowrap",
  width: 1,
});

const FileInput: React.FC<FileInputProps> = ({ onFileInput, filename }) => {
  return (
    <Button
      component="label"
      role={undefined}
      variant="contained"
      tabIndex={-1}
      sx={{ marginBottom: "0.25rem" }}
    >
      {filename || "Select file"}
      <VisuallyHiddenInput
        accept=".mp3, .aac, .m4a, .wav, .flac, .ogg, .opus, .flv, .mp4, .avi, .wmv, .wma, .mka, .mkv, .MTS,
                .mts, .ac3, .3gp, .dts, .webm, .ADPCM, .adpcm, .spx, .caf, .mov, .dtshd, .thd, .aif, .aiff, .vob"
        type="file"
        onChange={onFileInput}
      />
    </Button>
  );
};

export default FileInput;
