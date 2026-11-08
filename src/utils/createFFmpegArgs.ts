import { FORMATS, type Codec, type FormatSettings } from '../formats';
import { CONTAINERS, VIDEO_ENCODERS, type Container, containerHoldsAudio, videoAudioEncodingOf, videoContainerOf, videoEncoderOf } from '../videoEncoders';

/**
 * The extension of the file that keeps the input's video: the input's own container, unless
 * it can't hold the audio format (or isn't a container we write), then MKV.
 */
export const keepVideoExtension = (codec: Codec, inputFilename: string): string => {
  const extension = inputFilename.slice(inputFilename.lastIndexOf('.')).toLowerCase();
  const name = extension.slice(1);
  if (!Object.hasOwn(CONTAINERS, name)) return '.mkv';
  const audioFormats: readonly string[] = CONTAINERS[name as Container].audioFormats ?? [];
  return audioFormats.includes(codec) ? extension : '.mkv';
};

/**
 * Make a user-typed name safe as an output filename: path separators would point into
 * a missing directory, characters Windows forbids would be altered by the browser, and
 * a leading "-" would make FFmpeg read the name as an option.
 */
export const sanitizeFilename = (name: string): string =>
  // eslint-disable-next-line no-control-regex -- Control characters are what it replaces.
  name.trim().replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').replace(/^-/, '_');

/**
 * For encoders that can't write more than two channels: downmix audio with more to stereo,
 * and leave mono as it is. (Some of them, such as WMA, fail on 5.1 audio rather than downmix it.)
 */
export const STEREO_AT_MOST = ['-af', 'aformat=channel_layouts=mono|stereo'];

/** The downmix arguments: always for stereo-only encoders, else when the user asks for it. */
const downmixArgs = (stereoOnly: boolean | undefined, downmixToStereo: boolean): string[] =>
  stereoOnly ? STEREO_AT_MOST : downmixToStereo ? ['-ac', '2'] : [];

/** Which audio goes into the output: one track, by its position among the file's audio tracks (0 is the first), or all of them. */
export type AudioTrack = number | 'all';

/** Whether a video output has audio: not when it's left out, or the container (e.g. GIF) can't hold any. */
export const videoHasAudio = (settings: FormatSettings): boolean =>
  settings.videoAudio !== 'none' && containerHoldsAudio(videoContainerOf(settings));

const videoAllowsAllAudioTracks = (settings: FormatSettings): boolean =>
  videoHasAudio(settings) && !CONTAINERS[videoContainerOf(settings)].singleAudioTrack;

const audioAllowsAllAudioTracks = (codec: Codec, settings: FormatSettings, inputFilename?: string): boolean => {
  if (FORMATS[codec].allAudioTracks) return true;
  if (!FORMATS[codec].keepVideo || !settings.isKeepVideo) return false;
  // Some containers (e.g. FLV) hold only one audio track.
  const container = inputFilename && keepVideoExtension(codec, inputFilename).slice(1);
  return !(container && Object.hasOwn(CONTAINERS, container) && CONTAINERS[container as Container].singleAudioTrack);
};

/**
 * Whether the output can hold several audio tracks: MKA, any output that keeps the video
 * (unless its container holds one track only), and a re-encoded video whose container allows it.
 */
export const allowsAllAudioTracks = (codec: Codec, settings: FormatSettings, inputFilename?: string): boolean =>
  settings.outputType === 'video' ? videoAllowsAllAudioTracks(settings) : audioAllowsAllAudioTracks(codec, settings, inputFilename);

const checkAudioTrack = (audioTrack: AudioTrack, allowsAll: boolean) => {
  if (audioTrack === 'all' ? !allowsAll : !(Number.isSafeInteger(audioTrack) && audioTrack >= 0)) {
    throw new Error('Choose a valid audio track.');
  }
};

/** The part of the input to convert, in seconds. */
export interface Trim {
  start: number;
  end: number;
}

/** Seconds as FFmpeg takes them, to the millisecond (e.g. 12.345). */
const seconds = (value: number) => String(Math.round(value * 1000) / 1000);

/**
 * The filters for the frame rate and size options. With only a width or a height, the other
 * follows the aspect ratio (-2 rounds it to an even number, which most encoders need).
 */
export const frameFilters = (settings: FormatSettings): string[] => {
  const filters: string[] = [];
  if (settings.videoFps !== 'original') filters.push(`fps=${settings.videoFps}`);
  const width = settings.videoWidth === 'original' ? undefined : settings.videoWidth;
  const height = settings.videoHeight === 'original' ? undefined : settings.videoHeight;
  if (width || height) filters.push(`scale=${width ?? -2}:${height ?? -2}`);
  return filters;
};

/**
 * Add `filters` to the start of the encoder's own -vf, if it has one (e.g. GIF's palette, or
 * fitting DV's fixed frame size), as FFmpeg only uses the last -vf it's given.
 */
const withFilters = (encoderArgs: string[], filters: string[]): string[] => {
  if (!filters.length) return encoderArgs;
  const vf = encoderArgs.indexOf('-vf');
  if (vf === -1) return ['-vf', filters.join(','), ...encoderArgs];
  return encoderArgs.map((arg, i) => (i === vf + 1 ? `${filters.join(',')},${arg}` : arg));
};

/**
 * Build the FFmpeg arguments that re-encode the first video stream of `inputFilename` with the
 * chosen video encoder, saved as `outputName` plus the container's extension. `threadArgs`
 * go right after the input (see videoThreadArgs in manualCommand.ts). With `trim`, only that
 * part of the input is converted.
 */
export const createVideoArgs = (
  inputFilename: string,
  settings: FormatSettings,
  outputName: string,
  audioTrack: AudioTrack,
  threadArgs: string[] = [],
  trim?: Trim,
): { ffmpegArgs: string[]; outputFilename: string } => {
  const encoderName = videoEncoderOf(settings);
  const encoder = VIDEO_ENCODERS[encoderName];
  const containerName = videoContainerOf(settings);
  const container = CONTAINERS[containerName];
  checkAudioTrack(audioTrack, videoAllowsAllAudioTracks(settings));

  // The first video stream. 'V' leaves out cover art, which isn't really video.
  const args = ['-map', '0:V:0'];
  if (videoHasAudio(settings)) {
    // '?' allows inputs without audio.
    args.push('-map', audioTrack === 'all' ? '0:a?' : `0:a:${audioTrack}?`);
  }
  args.push('-c:v', encoderName, ...withFilters(encoder.args?.(settings) ?? [], frameFilters(settings)));
  if (videoHasAudio(settings)) {
    if (settings.videoAudio === 'copy' && !container.noAudioCopy) {
      args.push('-c:a', 'copy');
    } else {
      const audio = videoAudioEncodingOf(settings)!;
      args.push(...audio.args);
      // Some containers set the channels themselves (e.g. AMV is always mono).
      if (!audio.args.includes('-ac')) args.push(...downmixArgs(audio.stereoOnly, settings.downmixToStereo));
    }
  }

  // -ss before -i seeks the input (quickly, and still frame-accurate when re-encoding);
  // -t then sets the output's length.
  const seek = trim && trim.start > 0 ? ['-ss', seconds(trim.start)] : [];
  const length = trim ? ['-t', seconds(trim.end - trim.start)] : [];

  const outputFilename = `${sanitizeFilename(outputName)}.${containerName}`;
  return {
    ffmpegArgs: [...seek, '-i', inputFilename, ...threadArgs, ...length, ...args, outputFilename],
    outputFilename,
  };
};

/** Build the FFmpeg arguments that convert `inputFilename` to `codec`, saved as `outputName` plus an extension. */
export const createFFmpegArgs = (
  inputFilename: string,
  codec: Codec,
  settings: FormatSettings,
  outputName: string,
  audioTrack: AudioTrack,
): { ffmpegArgs: string[]; outputFilename: string } => {
  const format = FORMATS[codec];
  const keepVideo = Boolean(format.keepVideo && settings.isKeepVideo);
  checkAudioTrack(audioTrack, audioAllowsAllAudioTracks(codec, settings, inputFilename));

  // With the video, keep the input's container if it can hold the audio format; otherwise use MKV.
  const inputExtension = inputFilename.slice(inputFilename.lastIndexOf('.')).toLowerCase();
  let extension = format.extension;
  if (keepVideo) {
    extension = keepVideoExtension(codec, inputFilename);
  }

  // Say exactly which streams go into the output. Once there's a -map, FFmpeg adds nothing
  // else by itself, so an audio file never picks up video and a single-track file never
  // gets several audio tracks.
  const args = ['-map', audioTrack === 'all' ? '0:a' : `0:a:${audioTrack}`];
  if (keepVideo) {
    // The video, copied as it is. 'V' leaves out cover art; '?' allows inputs without video.
    args.unshift('-map', '0:V?');
    args.push('-c:V', 'copy');
    // MKV to MKV: copy the subtitles and attachments (such as fonts) too. Subtitles from
    // other containers (e.g. MP4's mov_text) can't be copied into MKV, so they're left out.
    if (inputExtension === '.mkv' && extension === '.mkv') args.push('-map', '0:s?', '-map', '0:t?', '-c:s', 'copy');
  }
  args.push(...format.args(settings));
  if (!format.copiesAudio) args.push(...downmixArgs(format.stereoOnly, settings.downmixToStereo));

  const outputFilename = sanitizeFilename(outputName) + extension;
  return { ffmpegArgs: ['-i', inputFilename, ...args, outputFilename], outputFilename };
};
