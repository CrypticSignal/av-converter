/**
 * Reading part of a file in FFmpeg's file system, through our own FFmpeg worker
 * (ffmpegWorker.ts).
 *
 * ffmpeg.wasm's FFmpeg class has no way to read part of a file, and only sends the requests it
 * knows. Its readFile passes the `encoding` argument to the worker untouched, though, so a
 * range is sent as a special encoding, which our worker reads as "these bytes of the file".
 */
import type { FFmpeg } from '@ffmpeg/ffmpeg';

const PREFIX = 'range:';

/** The range an `encoding` asks for, or undefined for a normal encoding ('binary' or 'utf8'). */
export const parseRange = (encoding: string | undefined): { offset: number; length: number } | undefined => {
  const match = encoding?.startsWith(PREFIX) && /^range:(\d+):(\d+)$/.exec(encoding);
  return match ? { offset: Number(match[1]), length: Number(match[2]) } : undefined;
};

/**
 * Up to `length` bytes of the file at `path`, from `offset`. Fewer bytes (or none) mean the file
 * ends there. The bytes are moved from the worker, not copied.
 */
export const readFileRange = async (ffmpeg: FFmpeg, path: string, offset: number, length: number) =>
  await ffmpeg.readFile(path, `${PREFIX}${offset}:${length}`) as Uint8Array<ArrayBuffer>;
