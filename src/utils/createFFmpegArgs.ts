import { FORMATS, bitrateFor, type Codec, type FormatSettings } from '../formats';

const MP4_FAMILY = ['.mp4', '.mov'];

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

  const outputFilename = outputName + extension;
  return { ffmpegArgs: ['-i', inputFilename, ...args, outputFilename], outputFilename };
};
