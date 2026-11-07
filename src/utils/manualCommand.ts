import { canUseThreads } from './convertFile';
import { parseArgs } from './parseArgs';

/**
 * The output is read back by the name the command ends with, so reject names that
 * FFmpeg would treat as an option, write somewhere else, or couldn't pick a format for.
 */
const checkManualOutputFilename = (name: string, hasFormatOption: boolean) => {
  if (name.startsWith('-')) {
    throw new Error(`The command must end with the output filename (e.g. output.mp4), not the option ${name}.`);
  }
  if (/[/\\]/.test(name)) throw new Error(`The output filename ${name} can't include a folder.`);
  if (/[:*?"<>|\u0000-\u001f]/.test(name)) {
    throw new Error(`The output filename ${name} contains characters that aren't allowed in filenames.`);
  }
  if (!hasFormatOption && !/\.[^.]+$/.test(name)) {
    throw new Error(`The output filename ${name} needs an extension, such as .mp4, so FFmpeg knows which format to write.`);
  }
};

/** Build the arguments for manual mode, where the user types everything after `ffmpeg -i <input>`. */
export const manualCommandArgs = (inputFilename: string, command: string) => {
  const restOfArgs = parseArgs(command);
  if (restOfArgs.length === 0) throw new Error('Please enter the rest of the command.');

  // https://github.com/ffmpegwasm/ffmpeg.wasm/issues/597
  // Directly after the input, -threads is always an option of the first output,
  // whatever the user's command ends with.
  const encodesVideo = restOfArgs.some(arg => ['-c:v', '-c:V', '-codec:v', '-vcodec'].includes(arg));
  const threads = encodesVideo && canUseThreads() && !navigator.userAgent.toLowerCase().includes('firefox')
    ? ['-threads', '4'] : [];

  const ffmpegArgs = ['-i', inputFilename, ...threads, ...restOfArgs];
  const outputFilename = ffmpegArgs[ffmpegArgs.length - 1];
  checkManualOutputFilename(outputFilename, restOfArgs.includes('-f'));
  return { ffmpegArgs, outputFilename };
};
