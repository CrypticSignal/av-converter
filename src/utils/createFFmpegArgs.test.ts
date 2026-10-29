import { describe, expect, it } from 'vitest';
import { createFFmpegArgs } from './createFFmpegArgs';
import { DEFAULT_SETTINGS, FORMATS, type Codec, type FormatSettings } from '../formats';

const run = (input: string, codec: Codec, settings: Partial<FormatSettings>, outputName = 'output') =>
  createFFmpegArgs(input, codec, { ...DEFAULT_SETTINGS, ...settings }, outputName);

const formats: { codec: Codec; settings: Partial<FormatSettings>; extension: string; args: string[] }[] = [
  { codec: 'AAC', settings: { bitrates: { AAC: '192' } }, extension: 'aac', args: ['-c:a', 'aac', '-b:a', '192k'] },
  { codec: 'AC3', settings: { ac3Bitrate: '640' }, extension: 'ac3', args: ['-c:a', 'ac3', '-b:a', '640k'] },
  { codec: 'ALAC', settings: {}, extension: 'm4a', args: ['-c:a', 'alac'] },
  { codec: 'CAF', settings: {}, extension: 'caf', args: ['-c:a', 'alac'] },
  { codec: 'DTS', settings: { bitrates: { DTS: '1536' } }, extension: 'dts', args: ['-c:a', 'dca', '-b:a', '1536k', '-strict', '-2'] },
  { codec: 'FLAC', settings: { flacCompression: '5' }, extension: 'flac', args: ['-map', '0:a', '-c:a', 'flac', '-compression_level', '5'] },
  { codec: 'MKA', settings: {}, extension: 'mka', args: ['-map', '0:a', '-c:a', 'copy'] },
  { codec: 'MP3', settings: { mp3EncodingType: 'cbr' }, extension: 'mp3', args: ['-c:a', 'libmp3lame', '-b:a', '192k'] },
  { codec: 'Opus', settings: { bitrates: { Opus: '128' }, opusEncodingType: 'vbr' }, extension: 'opus', args: ['-c:a', 'libopus', '-b:a', '128k'] },
  { codec: 'Vorbis', settings: { vorbisEncodingType: 'abr' }, extension: 'ogg', args: ['-map', '0:a', '-c:a', 'libvorbis', '-b:a', '192k'] },
  { codec: 'WAV', settings: { wavBitDepth: '24' }, extension: 'wav', args: ['-c:a', 'pcm_s24le'] },
];

describe('audio formats and downmix', () => {
  for (const { codec, settings, extension, args } of formats) {
    it.each([false, true])(`${codec}: downmix=%s`, (downmixToStereo) => {
      const outputFilename = `my output.${extension}`;
      expect(run('my input.webm', codec, { ...settings, downmixToStereo }, 'my output')).toEqual({
        outputFilename,
        ffmpegArgs: ['-i', 'my input.webm', ...args,
          ...(downmixToStereo && codec !== 'MKA' ? ['-ac', '2'] : []), outputFilename],
      });
    });
  }

  it('uses each format\'s default bitrate until the user picks one', () => {
    expect(run('input.wav', 'DTS', {}).ffmpegArgs).toContain('768k');
    expect(run('input.wav', 'DTS', { bitrates: { AAC: '64' } }).ffmpegArgs).toContain('768k');
  });

  it('ignores the keep-video setting for audio-only formats', () => {
    expect(run('input.mp4', 'WAV', { isKeepVideo: true }).ffmpegArgs)
      .toEqual(['-i', 'input.mp4', '-c:a', 'pcm_s16le', 'output.wav']);
  });
});

it('FLAC keeps every stream once alongside the video', () => {
  const args = run('input.mkv', 'FLAC', { isKeepVideo: true }).ffmpegArgs;
  expect(args.filter(arg => arg === '-map')).toHaveLength(1);
  expect(args).toEqual(['-i', 'input.mkv', '-c:V', 'copy', '-map', '0', '-c:s', 'copy',
    '-c:a', 'flac', '-compression_level', '5', 'output.mkv']);
});

describe('encoding modes', () => {
  it.each([
    ['cbr', ['-b:a', '192k']],
    ['abr', ['-abr', '1', '-b:a', '192k']],
    ['vbr', ['-q:a', '2']],
  ] as const)('MP3 %s uses FFmpeg options and supports stereo downmix', (mp3EncodingType, args) => {
    expect(run('input.wav', 'MP3', { mp3EncodingType, mp3VbrSetting: '2', downmixToStereo: true }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-c:a', 'libmp3lame', ...args, '-ac', '2', 'output.mp3']);
  });

  it('supports Opus CBR and Vorbis quality mode', () => {
    expect(run('input.wav', 'Opus', { bitrates: { Opus: '128' }, opusEncodingType: 'cbr' }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-c:a', 'libopus', '-vbr', 'off', '-b:a', '128k', 'output.opus']);
    expect(run('input.wav', 'Vorbis', { qValue: '6', vorbisEncodingType: 'vbr' }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a', '-c:a', 'libvorbis', '-q:a', '6', 'output.ogg']);
  });
});

describe('keep-video containers', () => {
  for (const { codec, settings } of formats) {
    if (!FORMATS[codec].keepVideo) continue;
    it.each(['webm', 'ogg', 'avi', 'mov', 'mp4', 'mkv', 'MP4', '']) (
      `${codec}: chooses a compatible container for original extension "%s"`, (extension) => {
        const input = `input${extension ? `.${extension}` : ''}`;
        const keepsContainer = ['AAC', 'AC3', 'ALAC', 'MP3'].includes(codec)
          && ['mp4', 'mov'].includes(extension.toLowerCase());
        const outputFilename = `output.${keepsContainer ? extension.toLowerCase() : 'mkv'}`;
        const result = run(input, codec, { ...settings, isKeepVideo: true, downmixToStereo: true });
        expect(result.outputFilename).toBe(outputFilename);
        expect(result.ffmpegArgs.slice(0, 2)).toEqual(['-i', input]);
        expect(result.ffmpegArgs).toContain('-c:V');
        expect(result.ffmpegArgs[result.ffmpegArgs.indexOf('-c:V') + 1]).toBe('copy');
        expect(result.ffmpegArgs.slice(-3)).toEqual(['-ac', '2', outputFilename]);
      },
    );
  }
});
