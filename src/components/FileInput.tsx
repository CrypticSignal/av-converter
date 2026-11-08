import React, { useState } from "react";
import { BUTTON_CLASSES } from "./Button";

interface FileInputProps {
  /** Called with the chosen or dropped file. */
  onFile: (file: File | undefined) => void;
  filename: string;
  disabled?: boolean;
}

// Any audio or video type, plus extensions browsers often don't map to one.
const ACCEPT = [
  "audio/*", "video/*",
  ".3g2", ".3gp", ".aac", ".ac3", ".adpcm", ".aif", ".aifc", ".aiff", ".amr", ".ape", ".asf", ".au", ".avi",
  ".caf", ".dts", ".dtshd", ".eac3", ".f4v", ".flac", ".flv", ".m2ts", ".m4a", ".m4b", ".m4v", ".mka", ".mkv",
  ".mlp", ".mov", ".mp2", ".mp3", ".mp4", ".mpeg", ".mpg", ".mts", ".oga", ".ogg", ".ogv", ".opus", ".ra",
  ".rm", ".spx", ".thd", ".ts", ".tta", ".vob", ".w64", ".wav", ".webm", ".wma", ".wmv", ".wv",
].join(",");

const FileInput: React.FC<FileInputProps> = ({ onFile, filename, disabled = false }) => {
  const [dragging, setDragging] = useState(false);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    // A disabled fieldset blocks native controls, but drag events still fire.
    // Ignore dropped files too so the visible input cannot change mid-conversion.
    if (disabled) return;
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  };

  return (
    <div
      data-testid="file-drop-zone"
      onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = disabled ? "none" : "copy"; }}
      onDragEnter={e => { e.preventDefault(); setDragging(!disabled); }}
      onDragLeave={e => {
        // Ignore leaving into a child element; only clear when the pointer leaves the zone.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={onDrop}
      className={`group relative w-full px-6 py-10 border-2 border-dashed rounded-2xl transition-all duration-200 ${
        dragging
          ? "border-violet-400 bg-violet-500/10 scale-[1.01] shadow-[0_0_40px_-10px_rgba(139,92,246,0.7)]"
          : "border-white/15 bg-white/[0.02] hover:border-violet-400/60 hover:bg-white/[0.04]"}`}
    >
      <div className={`mx-auto mb-4 grid place-items-center h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500/25 to-cyan-400/20 ring-1 ring-white/10 transition-transform duration-200 group-hover:-translate-y-0.5 ${dragging ? "pulse-ring" : ""}`}>
        {filename ? (
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-cyan-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-7 w-7 text-violet-300" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 16V4M6 10l6-6 6 6" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
          </svg>
        )}
      </div>
      {/* A label styled as a button, around the real (visually hidden) file input, which
          stays focusable: the outline shows on the label while the input has keyboard focus. */}
      <label
        className={`${BUTTON_CLASSES.primary} max-w-full cursor-pointer
          has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-violet-400
          has-disabled:cursor-not-allowed has-disabled:bg-none has-disabled:bg-white/10 has-disabled:text-white/40
          has-disabled:shadow-none has-disabled:hover:translate-y-0 has-disabled:hover:brightness-100`}
      >
        <span className="truncate">{filename || "Choose a file"}</span>
        <input
          className="sr-only"
          disabled={disabled}
          accept={ACCEPT}
          type="file"
          onChange={e => {
            onFile(e.currentTarget.files?.[0]);
            // Reset so choosing the same file again still fires a change event.
            e.currentTarget.value = "";
          }}
        />
      </label>
      <p className="text-sm text-slate-400 mt-3">
        {dragging ? "Drop to select this file" : filename ? "Click to choose another file, or drop one here" : "or drag and drop any audio or video file here"}
      </p>
    </div>
  );
};

export default FileInput;
