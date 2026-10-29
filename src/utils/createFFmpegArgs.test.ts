import { describe, expect, it } from 'vitest';
import { createFFmpegArgs, EncodingOptions } from './createFFmpegArgs';

const formats: { options: EncodingOptions; extension: string; args: string[] }[] = [
  { options: { codec: 'AAC', bitrateSliderValue: '192', isKeepVideo: false, downmixToStereo: false }, extension: 'aac', args: ['-c:a', 'aac', '-b:a', '192k'] },
  { options: { codec: 'AC3', ac3Bitrate: '640', isKeepVideo: false, downmixToStereo: false }, extension: 'ac3', args: ['-c:a', 'ac3', '-b:a', '640k'] },
  { options: { codec: 'ALAC', isKeepVideo: false, downmixToStereo: false }, extension: 'm4a', args: ['-c:a', 'alac'] },
  { options: { codec: 'CAF', downmixToStereo: false }, extension: 'caf', args: ['-c:a', 'alac'] },
  { options: { codec: 'DTS', bitrateSliderValue: '1536', isKeepVideo: false, downmixToStereo: false }, extension: 'dts', args: ['-c:a', 'dca', '-b:a', '1536k', '-strict', '-2'] },
  { options: { codec: 'FLAC', flacCompression: '5', isKeepVideo: false, downmixToStereo: false }, extension: 'flac', args: ['-map', '0:a', '-c:a', 'flac', '-compression_level', '5'] },
  { options: { codec: 'MKA', downmixToStereo: false }, extension: 'mka', args: ['-map', '0:a', '-c:a', 'copy'] },
  { options: { codec: 'MP3', bitrateSliderValue: '192', isKeepVideo: false, mp3EncodingType: 'cbr', mp3VbrSetting: '2', downmixToStereo: false }, extension: 'mp3', args: ['-c:a', 'libmp3lame', '-b:a', '192k'] },
  { options: { codec: 'Opus', bitrateSliderValue: '128', opusEncodingType: 'vbr', downmixToStereo: false }, extension: 'opus', args: ['-c:a', 'libopus', '-b:a', '128k'] },
  { options: { codec: 'Vorbis', bitrateSliderValue: '192', qValue: '6', vorbisEncodingType: 'abr', downmixToStereo: false }, extension: 'ogg', args: ['-map', '0:a', '-c:a', 'libvorbis', '-b:a', '192k'] },
  { options: { codec: 'WAV', wavBitDepth: '24', downmixToStereo: false }, extension: 'wav', args: ['-c:a', 'pcm_s24le'] },
];

describe('audio formats and downmix', () => {
  for (const { options, extension, args } of formats) {
    it.each([false, true])(`${options.codec}: downmix=%s`, (downmixToStereo) => {
      const outputFilename = `my output.${extension}`;
      expect(createFFmpegArgs('my input.webm', { ...options, downmixToStereo }, 'my output')).toEqual({
        outputFilename,
        ffmpegArgs: ['-i', 'my input.webm', ...args,
          ...(downmixToStereo && options.codec !== 'MKA' ? ['-ac', '2'] : []), outputFilename],
      });
    });
  }
});

describe('encoding modes', () => {
  it.each([
    ['cbr', ['-b:a', '192k']],
    ['abr', ['-abr', '1', '-b:a', '192k']],
    ['vbr', ['-q:a', '2']],
  ] as const)('MP3 %s uses FFmpeg options and supports stereo downmix', (mp3EncodingType, args) => {
    expect(createFFmpegArgs('input.wav', {
      codec: 'MP3', bitrateSliderValue: '192', isKeepVideo: false,
      mp3EncodingType, mp3VbrSetting: '2', downmixToStereo: true,
    }, 'output')?.ffmpegArgs).toEqual(['-i', 'input.wav', '-c:a', 'libmp3lame', ...args, '-ac', '2', 'output.mp3']);
  });

  it('supports Opus CBR and Vorbis quality mode', () => {
    expect(createFFmpegArgs('input.wav', { codec: 'Opus', bitrateSliderValue: '128', opusEncodingType: 'cbr', downmixToStereo: false }, 'output')?.ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-c:a', 'libopus', '-vbr', 'off', '-b:a', '128k', 'output.opus']);
    expect(createFFmpegArgs('input.wav', { codec: 'Vorbis', bitrateSliderValue: '192', qValue: '6', vorbisEncodingType: 'quality', downmixToStereo: false }, 'output')?.ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a', '-c:a', 'libvorbis', '-q:a', '6', 'output.ogg']);
  });
});

describe('keep-video containers', () => {
  for (const { options } of formats) {
    if (!('isKeepVideo' in options)) continue;
    it.each(['webm', 'ogg', 'avi', 'mov', 'mp4', 'mkv', 'MP4', '']) (
      `${options.codec}: chooses a compatible container for original extension "%s"`, (extension) => {
        const input = `input${extension ? `.${extension}` : ''}`;
        const keepsContainer = ['AAC', 'AC3', 'ALAC', 'MP3'].includes(options.codec)
          && ['mp4', 'mov'].includes(extension.toLowerCase());
        const outputFilename = `output.${keepsContainer ? extension.toLowerCase() : 'mkv'}`;
        const result = createFFmpegArgs(input, { ...options, isKeepVideo: true, downmixToStereo: true }, 'output');
        expect(result?.outputFilename).toBe(outputFilename);
        expect(result?.ffmpegArgs.slice(0, 2)).toEqual(['-i', input]);
        expect(result?.ffmpegArgs).toContain('-c:V');
        expect(result?.ffmpegArgs[result.ffmpegArgs.indexOf('-c:V') + 1]).toBe('copy');
        expect(result?.ffmpegArgs.slice(-3)).toEqual(['-ac', '2', outputFilename]);
      },
    );
  }
});
