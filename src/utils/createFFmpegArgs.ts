import { FORMATS, type Codec, type FormatSettings } from '../formats';

const MP4_FAMILY = ['.mp4', '.mov'];

/**
 * Make a user-typed name safe as an output filename: path separators would point into
 * a missing directory, characters Windows forbids would be altered by the browser, and
 * a leading "-" would make FFmpeg read the name as an option.
 */
export const sanitizeFilename = (name: string): string =>
  name.trim().replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').replace(/^-/, '_');

/** Which audio goes into the output: one track, by its position among the file's audio tracks (0 is the first), or all of them. */
export type AudioTrack = number | 'all';

/** Whether the output can hold several audio tracks: MKA, and any output that keeps the video (MP4, MOV or MKV). */
export const allowsAllAudioTracks = (codec: Codec, settings: FormatSettings): boolean =>
  Boolean(FORMATS[codec].allAudioTracks || (FORMATS[codec].keepVideo && settings.isKeepVideo));

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
  if (audioTrack === 'all' ? !allowsAllAudioTracks(codec, settings) : !(Number.isSafeInteger(audioTrack) && audioTrack >= 0)) {
    throw new Error('Choose a valid audio track.');
  }

  // With the video, keep the input's container if it's MP4/MOV and the format allows it; otherwise use MKV.
  const inputExtension = inputFilename.slice(inputFilename.lastIndexOf('.')).toLowerCase();
  let extension = format.extension;
  if (keepVideo) {
    const keepsContainer = format.keepVideo === 'mp4' && MP4_FAMILY.includes(inputExtension);
    extension = keepsContainer ? inputExtension : '.mkv';
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
  if (settings.downmixToStereo && !format.copiesAudio) args.push('-ac', '2');

  const outputFilename = sanitizeFilename(outputName) + extension;
  return { ffmpegArgs: ['-i', inputFilename, ...args, outputFilename], outputFilename };
};
