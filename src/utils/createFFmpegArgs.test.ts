import { describe, expect, it } from 'vitest';
import { createFFmpegArgs, sanitizeFilename, type AudioTrack } from './createFFmpegArgs';
import { DEFAULT_SETTINGS, type Codec, type FormatSettings } from '../formats';

const run = (input: string, codec: Codec, settings: Partial<FormatSettings>, track: AudioTrack = 0, outputName = 'output') =>
  createFFmpegArgs(input, codec, { ...DEFAULT_SETTINGS, ...settings }, outputName, track);

const formats: { codec: Codec; settings: Partial<FormatSettings>; extension: string; args: string[] }[] = [
  { codec: 'AAC', settings: { aacBitrate: '192' }, extension: 'aac', args: ['-c:a', 'aac', '-b:a', '192k'] },
  { codec: 'AC3', settings: { ac3Bitrate: '640' }, extension: 'ac3', args: ['-c:a', 'ac3', '-b:a', '640k'] },
  { codec: 'ALAC', settings: {}, extension: 'm4a', args: ['-c:a', 'alac'] },
  { codec: 'CAF', settings: {}, extension: 'caf', args: ['-c:a', 'alac'] },
  { codec: 'DTS', settings: { dtsBitrate: '1536' }, extension: 'dts', args: ['-c:a', 'dca', '-b:a', '1536k', '-strict', '-2'] },
  { codec: 'FLAC', settings: { flacCompression: '5' }, extension: 'flac', args: ['-c:a', 'flac', '-compression_level', '5'] },
  { codec: 'MKA', settings: {}, extension: 'mka', args: ['-c:a', 'copy'] },
  { codec: 'MP3', settings: { mp3EncodingType: 'cbr' }, extension: 'mp3', args: ['-c:a', 'libmp3lame', '-b:a', '192k'] },
  { codec: 'Opus', settings: { opusBitrate: '128', opusEncodingType: 'vbr' }, extension: 'opus', args: ['-c:a', 'libopus', '-b:a', '128k'] },
  { codec: 'Vorbis', settings: { vorbisEncodingType: 'abr' }, extension: 'ogg', args: ['-c:a', 'libvorbis', '-b:a', '192k'] },
  { codec: 'WAV', settings: { wavBitDepth: '24' }, extension: 'wav', args: ['-c:a', 'pcm_s24le'] },
];

describe('audio formats', () => {
  for (const { codec, settings, extension, args } of formats) {
    it(`${codec}: maps the chosen audio track, then encodes it`, () => {
      const outputFilename = `my output.${extension}`;
      expect(run('my input.webm', codec, settings, 1, 'my output')).toEqual({
        outputFilename,
        ffmpegArgs: ['-i', 'my input.webm', '-map', '0:a:1', ...args, outputFilename],
      });
    });
  }

  it('ignores the keep-video setting for audio-only formats', () => {
    expect(run('input.mp4', 'WAV', { isKeepVideo: true }).ffmpegArgs)
      .toEqual(['-i', 'input.mp4', '-map', '0:a:0', '-c:a', 'pcm_s16le', 'output.wav']);
  });

  it('adds stereo downmix, except when copying the audio', () => {
    expect(run('input.wav', 'MP3', { downmixToStereo: true }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '192k', '-ac', '2', 'output.mp3']);
    expect(run('input.wav', 'MKA', { downmixToStereo: true }, 'all').ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a', '-c:a', 'copy', 'output.mka']);
  });
});

describe('encoding modes', () => {
  it.each([
    ['abr', ['-abr', '1', '-b:a', '192k']],
    ['vbr', ['-q:a', '2']],
  ] as const)('MP3 %s uses the corresponding FFmpeg options', (mp3EncodingType, args) => {
    expect(run('input.wav', 'MP3', { mp3EncodingType, mp3VbrSetting: '2' }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a:0', '-c:a', 'libmp3lame', ...args, 'output.mp3']);
  });

  it('supports Opus CBR and Vorbis quality mode', () => {
    expect(run('input.wav', 'Opus', { opusBitrate: '128', opusEncodingType: 'cbr' }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a:0', '-c:a', 'libopus', '-vbr', 'off', '-b:a', '128k', 'output.opus']);
    expect(run('input.wav', 'Vorbis', { vorbisQuality: '6', vorbisEncodingType: 'vbr' }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a:0', '-c:a', 'libvorbis', '-q:a', '6', 'output.ogg']);
  });
});

describe('keeping the video', () => {
  it('copies the video into MP4/MOV, keeping the input container where the format allows it', () => {
    expect(run('in.mp4', 'AAC', { isKeepVideo: true }, 'all').ffmpegArgs)
      .toEqual(['-i', 'in.mp4', '-map', '0:V?', '-map', '0:a', '-c:V', 'copy', '-c:a', 'aac', '-b:a', '192k', 'output.mp4']);
  });

  it('also copies subtitles and attachments into MKV', () => {
    expect(run('in.mkv', 'FLAC', { isKeepVideo: true }, 1).ffmpegArgs)
      .toEqual(['-i', 'in.mkv', '-map', '0:V?', '-map', '0:a:1', '-c:V', 'copy',
        '-map', '0:s?', '-map', '0:t?', '-c:s', 'copy', '-c:a', 'flac', '-compression_level', '5', 'output.mkv']);
  });

  it.each<[Codec, string, string]>([
    ['AAC', 'input.mp4', 'output.mp4'],
    ['AC3', 'input.mov', 'output.mov'],
    ['ALAC', 'input.MP4', 'output.mp4'],
    ['MP3', 'input.webm', 'output.mkv'],
    ['AAC', 'input', 'output.mkv'],
    ['DTS', 'input.mp4', 'output.mkv'],
    ['FLAC', 'input.mov', 'output.mkv'],
  ])('%s with %s writes %s', (codec, input, outputFilename) => {
    expect(run(input, codec, { isKeepVideo: true }).outputFilename).toBe(outputFilename);
  });
});

describe('audio track choice', () => {
  it('allows "all audio tracks" only where the output can hold several', () => {
    expect(() => run('in.mkv', 'MKA', {}, 'all')).not.toThrow();
    expect(() => run('in.mkv', 'MP3', { isKeepVideo: true }, 'all')).not.toThrow();
    expect(() => run('in.mkv', 'MP3', {}, 'all')).toThrow('valid audio track');
    expect(() => run('in.mkv', 'Opus', { isKeepVideo: true }, 'all')).toThrow('valid audio track');
  });

  it('rejects invalid track positions', () => {
    for (const track of [-1, 1.5, NaN, Infinity]) {
      expect(() => run('in.wav', 'MP3', {}, track)).toThrow('valid audio track');
    }
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
    expect(run('in.wav', 'WAV', {}, 0, '-dir/name')).toMatchObject({
      outputFilename: '_dir_name.wav',
      ffmpegArgs: ['-i', 'in.wav', '-map', '0:a:0', '-c:a', 'pcm_s16le', '_dir_name.wav'],
    });
  });
});
