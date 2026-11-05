import { FORMATS, bitrateFor, type Codec, type FormatSettings } from '../formats';

const MP4_FAMILY = ['.mp4', '.mov'];

/**
 * Make a user-typed name safe as an output filename: path separators would point into
 * a missing directory, characters Windows forbids would be altered by the browser, and
 * a leading "-" would make FFmpeg read the name as an option.
 */
export const sanitizeFilename = (name: string): string =>
  name.trim().replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').replace(/^-/, '_');

/** Build the FFmpeg arguments that convert `inputFilename` to `codec`, saved as `outputName` plus an extension. */
export const createFFmpegArgs = (
  inputFilename: string,
  codec: Codec,
  settings: FormatSettings,
  outputName: string,
  audioStream?: number,
): { ffmpegArgs: string[]; outputFilename: string } => {
  const format = FORMATS[codec];
  const args = format.args(settings, bitrateFor(codec, settings));
  let extension = format.extension;

  if (format.keepVideo && settings.isKeepVideo) {
    args.unshift('-c:V', 'copy');
    const inputExtension = inputFilename.slice(inputFilename.lastIndexOf('.')).toLowerCase();
    const keepsContainer = format.keepVideo === 'mp4' && MP4_FAMILY.includes(inputExtension);
    extension = keepsContainer ? inputExtension : '.mkv';
  }
  if (audioStream !== undefined) {
    if (!Number.isSafeInteger(audioStream) || audioStream < 0) {
      throw new Error('Choose a valid audio track.');
    }
    // ffprobe reports absolute stream indexes, not audio-only positions. Replace
    // the format's broad audio mapping so selecting a track never duplicates it.
    const mapping = args.indexOf('-map');
    if (mapping >= 0 && args[mapping + 1] === '0') {
      // FLAC with video keeps subtitles/attachments too: remove only its audio
      // streams, then add the selected one, preserving all other stream types.
      args.splice(mapping + 2, 0, '-map', '-0:a', '-map', `0:${audioStream}`);
    } else if (mapping >= 0) {
      args[mapping + 1] = `0:${audioStream}`;
    } else {
      // An explicit audio map disables FFmpeg's automatic video selection. Add
      // video back only when requested; '?' also allows audio-only inputs.
      args.unshift(...(format.keepVideo && settings.isKeepVideo ? ['-map', '0:V?'] : []),
        '-map', `0:${audioStream}`);
    }
  }
  if (settings.downmixToStereo && !format.copiesAudio) args.push('-ac', '2');

  const outputFilename = sanitizeFilename(outputName) + extension;
  return { ffmpegArgs: ['-i', inputFilename, ...args, outputFilename], outputFilename };
};
