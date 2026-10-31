import React, { useState } from "react";
import Button from "@mui/material/Button";
import { styled } from "@mui/material/styles";

interface FileInputProps {
  /** Called with the chosen or dropped file. */
  onFile: (file: File | undefined) => void;
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

// Any audio or video type, plus extensions browsers often don't map to one.
const ACCEPT = [
  "audio/*", "video/*",
  ".3g2", ".3gp", ".aac", ".ac3", ".adpcm", ".aif", ".aifc", ".aiff", ".amr", ".ape", ".asf", ".au", ".avi",
  ".caf", ".dts", ".dtshd", ".eac3", ".f4v", ".flac", ".flv", ".m2ts", ".m4a", ".m4b", ".m4v", ".mka", ".mkv",
  ".mlp", ".mov", ".mp2", ".mp3", ".mp4", ".mpeg", ".mpg", ".mts", ".oga", ".ogg", ".ogv", ".opus", ".ra",
  ".rm", ".spx", ".thd", ".ts", ".tta", ".vob", ".w64", ".wav", ".webm", ".wma", ".wmv", ".wv",
].join(",");

const FileInput: React.FC<FileInputProps> = ({ onFile, filename }) => {
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      data-testid="file-drop-zone"
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
      onDragEnter={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={e => {
        // Ignore leaving into a child element; only clear when the pointer leaves the zone.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      className={`w-full max-w-md mx-auto my-4 p-6 border-2 border-dashed rounded-lg transition-colors ${
        dragging ? "border-sky-500 bg-sky-50" : "border-gray-300"}`}
    >
      <Button
        component="label"
        role={undefined}
        variant="contained"
        tabIndex={-1}
        sx={{ marginBottom: "0.25rem" }}
      >
        {filename || "Select file"}
        <VisuallyHiddenInput
          accept={ACCEPT}
          type="file"
          onChange={e => {
            onFile(e.currentTarget.files?.[0]);
            // Reset so choosing the same file again still fires a change event.
            e.currentTarget.value = "";
          }}
        />
      </Button>
      <p className="text-sm text-gray-500 mt-2">{dragging ? "Drop to select this file" : "or drag and drop a file here"}</p>
    </div>
  );
};

export default FileInput;
