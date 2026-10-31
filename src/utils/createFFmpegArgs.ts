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
  if (settings.downmixToStereo && !format.copiesAudio) args.push('-ac', '2');

  const outputFilename = sanitizeFilename(outputName) + extension;
  return { ffmpegArgs: ['-i', inputFilename, ...args, outputFilename], outputFilename };
};
