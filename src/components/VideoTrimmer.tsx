/**
 * A preview of the selected video with a two-handle slider for the part to convert.
 * Dragging a handle shows that point in the preview, and playback stops at the end point.
 * The preview is the browser's own player, so it can't show every format FFmpeg reads
 * (e.g. HEVC in some browsers); the slider still works then, using ffprobe's duration.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import Button from './Button';
import Slider from './Slider';
import type { Trim } from '../utils/createFFmpegArgs';
import SettingNote from './SettingNote';

/** The shortest part that can be chosen, in seconds. */
const MIN_LENGTH = 0.1;

/** 75.25 -> "1:15.25"; 3725 -> "1:02:05.00". */
export const formatTime = (value: number): string => {
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor(value % 3600 / 60);
  const secs = (value % 60).toFixed(2).padStart(5, '0');
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${secs}` : `${minutes}:${secs}`;
};

interface VideoTrimmerProps {
  file: File;
  /** From ffprobe, if it has read the file. Otherwise the preview's own duration is used. */
  duration?: number;
  /** Set when ffprobe couldn't read the file, so the length is only known if the preview loads. */
  probeFailed?: boolean;
  /** The chosen part, or null for the whole video. */
  trim: Trim | null;
  onChange: (trim: Trim | null) => void;
}

const VideoTrimmer = ({ file, duration: probedDuration, probeFailed, trim, onChange }: VideoTrimmerProps) => {
  const video = useRef<HTMLVideoElement>(null);
  // The file is played straight from disk through an object URL; nothing is copied.
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  // What the preview found out: its duration, or that it can't play. It's kept with the URL
  // it's about, so a newly chosen file starts with nothing known rather than the last one's.
  const [preview, setPreview] = useState<{ url: string; duration?: number; failed?: boolean }>({ url });
  const { duration: previewDuration, failed: previewFailed = false } = preview.url === url ? preview : {};
  const updatePreview = (found: { duration?: number; failed?: boolean }) =>
    setPreview(previous => ({ ...(previous.url === url ? previous : {}), url, ...found }));

  const duration = probedDuration ?? previewDuration;
  const start = trim?.start ?? 0;
  const end = trim?.end ?? duration ?? 0;

  /** Save a new part; the whole video counts as no trim. */
  const set = (newStart: number, newEnd: number) => {
    if (!duration) return;
    newStart = Math.max(0, Math.min(newStart, duration - MIN_LENGTH));
    newEnd = Math.min(duration, Math.max(newEnd, newStart + MIN_LENGTH));
    onChange(newStart <= 0 && newEnd >= duration ? null : { start: newStart, end: newEnd });
  };

  /** Show a point in the preview. */
  const seek = (time: number) => {
    const element = video.current;
    if (!element || previewFailed) return;
    element.pause();
    element.currentTime = time;
  };

  return (
    <div className="text-left">
      {!previewFailed ? (
        <video
          ref={video}
          src={url}
          controls
          preload="metadata"
          className="w-full max-h-80 rounded-xl bg-black"
          onLoadedMetadata={event => {
            const value = event.currentTarget.duration;
            if (Number.isFinite(value) && value > 0) updatePreview({ duration: value });
          }}
          onError={() => updatePreview({ failed: true })}
          // Playing from before the start, or from the end, starts at the start.
          onPlay={event => {
            const element = event.currentTarget;
            if (element.currentTime < start || element.currentTime >= end - 0.05) element.currentTime = start;
          }}
          // Stop at the end point.
          onTimeUpdate={event => {
            const element = event.currentTarget;
            if (!element.paused && element.currentTime >= end) {
              element.pause();
              element.currentTime = end;
            }
          }}
        />
      ) : (
        <SettingNote>
          This browser can't preview this file, but you can still choose the part to convert.
        </SettingNote>
      )}

      {duration ? <>
        <div role="group" aria-label="Part to convert" className="mt-8 mb-2 px-2">
          <Slider
            getAriaLabel={index => (index === 0 ? 'Start' : 'End')}
            value={[start, end] as const}
            min={0}
            max={duration}
            step={0.01}
            // Page Up/Down move a handle a tenth of the video.
            largeStep={duration / 10}
            formatValue={formatTime}
            onChange={([newStart, newEnd], activeThumb) => {
              set(newStart, newEnd);
              seek(activeThumb === 0 ? newStart : newEnd);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-300">
          <span>
            Start <strong className="font-mono">{formatTime(start)}</strong>
            {' · '}End <strong className="font-mono">{formatTime(end)}</strong>
            {' · '}Length <strong className="font-mono">{formatTime(end - start)}</strong>
          </span>
          <span className="flex flex-wrap gap-1">
            {!previewFailed && <>
              <Button variant="text" onClick={() => set(video.current?.currentTime ?? 0, end)}>Set start here</Button>
              <Button variant="text" onClick={() => set(start, video.current?.currentTime ?? end)}>Set end here</Button>
            </>}
            <Button variant="text" disabled={!trim} onClick={() => onChange(null)}>Reset</Button>
          </span>
        </div>
      </> : (
        <SettingNote>
          {previewFailed && probeFailed
            ? 'The video\'s length couldn\'t be read, so it can\'t be trimmed. The whole video will be converted.'
            : 'Reading the video\'s length...'}
        </SettingNote>
      )}
    </div>
  );
};

export default VideoTrimmer;
