import { describe, expect, it } from 'vitest';
import { createFFmpegArgs, sanitizeFilename } from './createFFmpegArgs';
import { DEFAULT_SETTINGS, type Codec, type FormatSettings } from '../formats';

const run = (input: string, codec: Codec, settings: Partial<FormatSettings>, outputName = 'output') =>
  createFFmpegArgs(input, codec, { ...DEFAULT_SETTINGS, ...settings }, outputName);

const formats: { codec: Codec; settings: Partial<FormatSettings>; extension: string; args: string[] }[] = [
  { codec: 'AAC', settings: { aacBitrate: '192' }, extension: 'aac', args: ['-c:a', 'aac', '-b:a', '192k'] },
  { codec: 'AC3', settings: { ac3Bitrate: '640' }, extension: 'ac3', args: ['-c:a', 'ac3', '-b:a', '640k'] },
  { codec: 'ALAC', settings: {}, extension: 'm4a', args: ['-c:a', 'alac'] },
  { codec: 'CAF', settings: {}, extension: 'caf', args: ['-c:a', 'alac'] },
  { codec: 'DTS', settings: { dtsBitrate: '1536' }, extension: 'dts', args: ['-c:a', 'dca', '-b:a', '1536k', '-strict', '-2'] },
  { codec: 'FLAC', settings: { flacCompression: '5' }, extension: 'flac', args: ['-map', '0:a', '-c:a', 'flac', '-compression_level', '5'] },
  { codec: 'MKA', settings: {}, extension: 'mka', args: ['-map', '0:a', '-c:a', 'copy'] },
  { codec: 'MP3', settings: { mp3EncodingType: 'cbr' }, extension: 'mp3', args: ['-c:a', 'libmp3lame', '-b:a', '192k'] },
  { codec: 'Opus', settings: { opusBitrate: '128', opusEncodingType: 'vbr' }, extension: 'opus', args: ['-c:a', 'libopus', '-b:a', '128k'] },
  { codec: 'Vorbis', settings: { vorbisEncodingType: 'abr' }, extension: 'ogg', args: ['-map', '0:a', '-c:a', 'libvorbis', '-b:a', '192k'] },
  { codec: 'WAV', settings: { wavBitDepth: '24' }, extension: 'wav', args: ['-c:a', 'pcm_s24le'] },
];

describe('audio formats', () => {
  for (const { codec, settings, extension, args } of formats) {
    it(`${codec}: builds the encoding arguments and output filename`, () => {
      const outputFilename = `my output.${extension}`;
      expect(run('my input.webm', codec, settings, 'my output')).toEqual({
        outputFilename,
        ffmpegArgs: ['-i', 'my input.webm', ...args, outputFilename],
      });
    });
  }


  it('ignores the keep-video setting for audio-only formats', () => {
    expect(run('input.mp4', 'WAV', { isKeepVideo: true }).ffmpegArgs)
      .toEqual(['-i', 'input.mp4', '-c:a', 'pcm_s16le', 'output.wav']);
  });
});

describe('stereo downmix', () => {
  it('adds stereo downmix when encoding audio', () => {
    expect(run('input.wav', 'MP3', { downmixToStereo: true }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-c:a', 'libmp3lame', '-b:a', '192k', '-ac', '2', 'output.mp3']);
  });

  it('ignores downmix when copying audio', () => {
    expect(run('input.wav', 'MKA', { downmixToStereo: true }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a', '-c:a', 'copy', 'output.mka']);
  });
});

it('FLAC keeps every stream once alongside the video', () => {
  const args = run('input.mkv', 'FLAC', { isKeepVideo: true }).ffmpegArgs;
  expect(args).toEqual(['-i', 'input.mkv', '-c:V', 'copy', '-map', '0', '-c:s', 'copy',
    '-c:a', 'flac', '-compression_level', '5', 'output.mkv']);
});

describe('encoding modes', () => {
  it.each([
    ['abr', ['-abr', '1', '-b:a', '192k']],
    ['vbr', ['-q:a', '2']],
  ] as const)('MP3 %s uses the corresponding FFmpeg options', (mp3EncodingType, args) => {
    expect(run('input.wav', 'MP3', { mp3EncodingType, mp3VbrSetting: '2' }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-c:a', 'libmp3lame', ...args, 'output.mp3']);
  });

  it('supports Opus CBR and Vorbis quality mode', () => {
    expect(run('input.wav', 'Opus', { opusBitrate: '128', opusEncodingType: 'cbr' }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-c:a', 'libopus', '-vbr', 'off', '-b:a', '128k', 'output.opus']);
    expect(run('input.wav', 'Vorbis', { vorbisQuality: '6', vorbisEncodingType: 'vbr' }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a', '-c:a', 'libvorbis', '-q:a', '6', 'output.ogg']);
  });
});

describe('keep-video containers', () => {
  it.each<[Codec, string, string]>([
    ['AAC', 'input.mp4', 'output.mp4'],
    ['AC3', 'input.mov', 'output.mov'],
    ['ALAC', 'input.MP4', 'output.mp4'],
    ['MP3', 'input.webm', 'output.mkv'],
    ['AAC', 'input', 'output.mkv'],
    ['DTS', 'input.mp4', 'output.mkv'],
    ['FLAC', 'input.mov', 'output.mkv'],
  ])('%s with %s writes %s and copies video', (codec, input, outputFilename) => {
    const result = run(input, codec, { isKeepVideo: true });
    expect(result.outputFilename).toBe(outputFilename);
    expect(result.ffmpegArgs.slice(2, 4)).toEqual(['-c:V', 'copy']);
    expect(result.ffmpegArgs.at(-1)).toBe(outputFilename);
  });
});

describe('output filename', () => {
  it.each([
    ['  plain name  ', 'plain name'],
    ['a/b\\c', 'a_b_c'],
    ['what: "now"?', 'what_ _now__'],
    ['-y', '_y'],
  ])('sanitizes %j to %j', (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });
  it('uses the sanitized name for the output argument', () => {
    expect(run('in.wav', 'WAV', {}, '-dir/name')).toMatchObject({
      outputFilename: '_dir_name.wav',
      ffmpegArgs: ['-i', 'in.wav', '-c:a', 'pcm_s16le', '_dir_name.wav'],
    });
  });
});

describe('audio track selection', () => {
  // MP3 adds an explicit map; MKA replaces its existing all-audio map.
  it.each(['MP3', 'MKA'] as const)('selects an absolute stream index for %s', codec => {
    const { ffmpegArgs } = createFFmpegArgs('in.mkv', codec, DEFAULT_SETTINGS, 'out', 3);
    const maps = ffmpegArgs.flatMap((arg, index) => arg === '-map' ? [ffmpegArgs[index + 1]] : []);
    expect(maps).toEqual(['0:3']);
  });

  it('keeps video when an audio map disables automatic stream selection', () => {
    const { ffmpegArgs } = createFFmpegArgs('in.mp4', 'AAC', { ...DEFAULT_SETTINGS, isKeepVideo: true }, 'out', 2);
    expect(ffmpegArgs).toEqual(['-i', 'in.mp4', '-map', '0:V?', '-map', '0:2',
      '-c:V', 'copy', '-c:a', 'aac', '-b:a', '192k', 'out.mp4']);
  });

  it('preserves non-audio streams for FLAC with video without keeping unwanted audio', () => {
    const { ffmpegArgs } = createFFmpegArgs('in.mkv', 'FLAC', { ...DEFAULT_SETTINGS, isKeepVideo: true }, 'out', 2);
    expect(ffmpegArgs).toEqual(['-i', 'in.mkv', '-c:V', 'copy', '-map', '0', '-map', '-0:a', '-map', '0:2',
      '-c:s', 'copy', '-c:a', 'flac', '-compression_level', '5', 'out.mkv']);
  });

  it('accepts index zero and rejects invalid stream indexes', () => {
    expect(createFFmpegArgs('in.wav', 'MP3', DEFAULT_SETTINGS, 'out', 0).ffmpegArgs).toContain('0:0');
    for (const index of [-1, 1.5, NaN, Infinity]) {
      expect(() => createFFmpegArgs('in.wav', 'MP3', DEFAULT_SETTINGS, 'out', index)).toThrow('valid audio track');
    }
  });
});
