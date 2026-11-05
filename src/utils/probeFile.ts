import type { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg';
import { loadFFmpeg } from './convertFile';

// Separate from the conversion's /input, so a probe never touches a conversion's files.
const PROBE_DIR = '/probe';
const PROBE_OUTPUT = '/probe.json';
const WORKERFS = 'WORKERFS' as FFFSType;
const PROBE_TIMEOUT_MS = 30_000;

export interface StreamInfo {
  index: number;
  type: string;
  codec?: string;
  /** Codec-specific details, e.g. "48000 Hz, stereo" or "1920x1080". */
  details: string[];
}

export interface MediaInfo {
  duration?: number;
  format?: string;
  streams: StreamInfo[];
}

const positive = (value: unknown): number | undefined => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
};

/** Turn ffprobe's JSON output into the details shown on the page. */
export const parseProbeOutput = (json: string): MediaInfo => {
  const data = JSON.parse(json) as {
    format?: Record<string, unknown>;
    streams?: Record<string, unknown>[];
  };
  const streams = (Array.isArray(data.streams) ? data.streams : []).map((stream, position) => {
    const details: string[] = [];
    // Language and title distinguish otherwise identical tracks in the picker.
    const tags = stream.tags as Record<string, unknown> | undefined;
    if (typeof tags?.language === 'string' && tags.language) details.push(tags.language);
    if (typeof tags?.title === 'string' && tags.title) details.push(tags.title);
    const sampleRate = positive(stream.sample_rate);
    if (sampleRate) details.push(`${sampleRate} Hz`);
    if (typeof stream.channel_layout === 'string' && stream.channel_layout) details.push(stream.channel_layout);
    else if (positive(stream.channels)) details.push(`${stream.channels} channels`);
    const width = positive(stream.width);
    const height = positive(stream.height);
    if (width && height) details.push(`${width}x${height}`);
    const bitrate = positive(stream.bit_rate);
    if (bitrate) details.push(`${Math.round(bitrate / 1000)} kbps`);
    return {
      index: typeof stream.index === 'number' ? stream.index : position,
      type: typeof stream.codec_type === 'string' ? stream.codec_type : 'unknown',
      codec: typeof stream.codec_name === 'string' ? stream.codec_name : undefined,
      details,
    };
  });
  return {
    duration: positive(data.format?.duration),
    format: typeof data.format?.format_long_name === 'string' ? data.format.format_long_name
      : typeof data.format?.format_name === 'string' ? data.format.format_name : undefined,
    streams,
  };
};

/**
 * Read a file's duration, container and streams with ffprobe. The file is mounted
 * read-only rather than copied, so even large inputs are cheap to probe.
 */
export const probeFile = async (ffmpeg: FFmpeg, file: File, isActive: () => boolean): Promise<MediaInfo> => {
  const checkActive = () => { if (!isActive()) throw new Error('Probe superseded'); };
  await loadFFmpeg(ffmpeg, isActive);
  checkActive();
  await ffmpeg.createDir(PROBE_DIR).catch(() => {}); // Exists after an earlier probe.
  // Never read an earlier probe's result as this file's.
  await ffmpeg.deleteFile(PROBE_OUTPUT).catch(() => {});
  const mounted = await ffmpeg.mount(WORKERFS, { blobs: [{ name: file.name, data: file }] }, PROBE_DIR);
  if (!mounted) throw new Error('Could not read the file.');
  try {
    checkActive();
    // The 0.12 cores report -1 from ffprobe even when it succeeds, so the exit code
    // can't be trusted: success is a JSON file that parses.
    await ffmpeg.ffprobe([
      // Quiet, so nothing reaches the log listeners of a conversion started meanwhile.
      '-v', 'info', '-print_format', 'json',
      '-show_entries',
      'format=duration,format_name,format_long_name:stream=index,codec_type,codec_name,sample_rate,channels,channel_layout,width,height,bit_rate:stream_tags=language,title',
      `${PROBE_DIR}/${file.name}`, '-o', PROBE_OUTPUT,
    ], PROBE_TIMEOUT_MS);
    checkActive();
    const output = await ffmpeg.readFile(PROBE_OUTPUT, 'utf8');
    checkActive();
    return parseProbeOutput(output as string);
  } finally {
    // Best effort: a terminated worker (cancel, unmount) has nothing left to clean.
    await ffmpeg.unmount(PROBE_DIR).catch(() => {});
    await ffmpeg.deleteFile(PROBE_OUTPUT).catch(() => {});
  }
};
