import { describe, expect, it } from 'vitest';
import { createFFmpegArgs, createVideoArgs, sanitizeFilename, STEREO_AT_MOST, type AudioTrack } from './createFFmpegArgs';
import { CONTAINERS, VIDEO_ENCODERS } from '../videoEncoders';
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
  { codec: 'MP3', settings: { mp3EncodingType: 'cbr' }, extension: 'mp3', args: ['-c:a', 'libmp3lame', '-b:a', '192k', ...STEREO_AT_MOST] },
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
    expect(run('input.wav', 'AAC', { downmixToStereo: true }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a:0', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', 'output.aac']);
    expect(run('input.wav', 'MKA', { downmixToStereo: true }, 'all').ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a', '-c:a', 'copy', 'output.mka']);
  });
});

describe('stereo-only formats', () => {
  it('always downmix audio with more than two channels, whatever the downmix setting', () => {
    for (const downmixToStereo of [false, true]) {
      expect(run('input.wav', 'MP3', { downmixToStereo }).ffmpegArgs)
        .toEqual(['-i', 'input.wav', '-map', '0:a:0', '-c:a', 'libmp3lame', '-b:a', '192k', ...STEREO_AT_MOST, 'output.mp3']);
    }
    expect(createVideoArgs('in.mkv', { ...DEFAULT_SETTINGS, outputType: 'video', videoEncoder: 'wmv2', videoContainer: 'wmv' },
      'output', 0).ffmpegArgs.slice(-7)).toEqual(['-c:a', 'wmav2', '-b:a', '192k', ...STEREO_AT_MOST, 'output.wmv']);
  });
});

describe('encoding modes', () => {
  it.each([
    ['abr', ['-abr', '1', '-b:a', '192k']],
    ['vbr', ['-q:a', '2']],
  ] as const)('MP3 %s uses the corresponding FFmpeg options', (mp3EncodingType, args) => {
    expect(run('input.wav', 'MP3', { mp3EncodingType, mp3VbrSetting: '2' }).ffmpegArgs)
      .toEqual(['-i', 'input.wav', '-map', '0:a:0', '-c:a', 'libmp3lame', ...args, ...STEREO_AT_MOST, 'output.mp3']);
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
      .toEqual(['-fflags', '+genpts', '-i', 'in.mkv', '-map', '0:V?', '-map', '0:a:1', '-c:V', 'copy',
        '-map', '0:s?', '-map', '0:t?', '-c:s', 'copy', '-c:a', 'flac', '-compression_level', '5', 'output.mkv']);
  });

  it('generates missing timestamps only when the output is MKV', () => {
    expect(run('in.mpg', 'FLAC', { isKeepVideo: true }).ffmpegArgs.slice(0, 3)).toEqual(['-fflags', '+genpts', '-i']);
    expect(run('in.mpg', 'MP3', { isKeepVideo: true }).ffmpegArgs[0]).toBe('-i');
  });

  it.each<[Codec, string, string]>([
    ['AAC', 'input.mp4', 'output.mp4'],
    ['AC3', 'input.mov', 'output.mov'],
    ['ALAC', 'input.MP4', 'output.mp4'],
    ['MP3', 'input.webm', 'output.mkv'],
    ['MP3', 'input.avi', 'output.avi'],
    ['AAC', 'input.ts', 'output.ts'],
    ['MP3', 'input.mkv', 'output.mkv'],
    ['AAC', 'input.m4v', 'output.mkv'],
    ['AAC', 'input', 'output.mkv'],
    ['DTS', 'input.mp4', 'output.mp4'],
    ['FLAC', 'input.mov', 'output.mkv'],
    ['FLAC', 'input.avi', 'output.mkv'],
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

describe('video encoders', () => {
  const video = (settings: Partial<FormatSettings>, track: AudioTrack = 0, threads: string[] = []) =>
    createVideoArgs('in.mkv', { ...DEFAULT_SETTINGS, outputType: 'video', ...settings }, 'output', track, threads);

  it('re-encodes the first video stream and the chosen audio track', () => {
    expect(video({ videoEncoder: 'libx264', videoContainer: 'mp4' }, 1)).toEqual({
      outputFilename: 'output.mp4',
      ffmpegArgs: ['-i', 'in.mkv', '-map', '0:V:0', '-map', '0:a:1?', '-c:v', 'libx264',
        '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', 'output.mp4'],
    });
  });

  it('puts the thread arguments right after the input', () => {
    expect(video({ videoEncoder: 'mpeg4', videoContainer: 'avi' }, 0, ['-threads', '4']).ffmpegArgs)
      .toEqual(['-i', 'in.mkv', '-threads', '4', '-map', '0:V:0', '-map', '0:a:0?', '-c:v', 'mpeg4', '-q:v', '3',
        '-c:a', 'aac', '-b:a', '192k', 'output.avi']);
  });

  it('copies, downmixes or leaves out the audio', () => {
    expect(video({ videoEncoder: 'libvpx-vp9', videoContainer: 'webm', videoAudio: 'copy', downmixToStereo: true }, 'all').ffmpegArgs)
      .toEqual(expect.arrayContaining(['-map', '0:a?', '-c:a', 'copy']));
    expect(video({ videoEncoder: 'libvpx-vp9', videoContainer: 'webm', videoAudio: 'copy' }).ffmpegArgs).not.toContain('-ac');
    expect(video({ videoEncoder: 'libvpx-vp9', videoContainer: 'webm', downmixToStereo: true }).ffmpegArgs.slice(-7))
      .toEqual(['-c:a', 'libopus', '-b:a', '192k', '-ac', '2', 'output.webm']);
    const noAudio = video({ videoEncoder: 'ffv1', videoContainer: 'mkv', videoAudio: 'none' }).ffmpegArgs;
    expect(noAudio).toEqual(['-i', 'in.mkv', '-map', '0:V:0', '-c:v', 'ffv1', 'output.mkv']);
  });

  it('makes a GIF palette per frame, so frames aren\'t held in memory until the end', () => {
    const args = video({ videoEncoder: 'gif', videoContainer: 'gif' }).ffmpegArgs;
    expect(args[args.indexOf('-vf') + 1]).toBe('split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1');
  });

  it('trims with -ss before the input and -t for the length', () => {
    const settings = { ...DEFAULT_SETTINGS, outputType: 'video' as const, videoEncoder: 'ffv1', videoContainer: 'mkv', videoAudio: 'none' as const };
    expect(createVideoArgs('in.mkv', settings, 'output', 0, ['-threads', '4'], { start: 12.3456, end: 20 }).ffmpegArgs)
      .toEqual(['-ss', '12.346', '-i', 'in.mkv', '-threads', '4', '-t', '7.654', '-map', '0:V:0', '-c:v', 'ffv1', 'output.mkv']);
    // Starting at the beginning needs no seek.
    expect(createVideoArgs('in.mkv', settings, 'output', 0, [], { start: 0, end: 5 }).ffmpegArgs)
      .toEqual(['-i', 'in.mkv', '-t', '5', '-map', '0:V:0', '-c:v', 'ffv1', 'output.mkv']);
  });

  it('changes the frame rate and size, keeping the aspect ratio when only one side is set', () => {
    const vf = (settings: Partial<FormatSettings>) => {
      const args = video({ videoEncoder: 'ffv1', videoContainer: 'mkv', ...settings }).ffmpegArgs;
      return args.includes('-vf') ? args[args.indexOf('-vf') + 1] : undefined;
    };
    expect(vf({})).toBeUndefined();
    expect(vf({ videoFps: '15' })).toBe('fps=15');
    expect(vf({ videoWidth: '640' })).toBe('scale=640:-2');
    expect(vf({ videoHeight: '720' })).toBe('scale=-2:720');
    expect(vf({ videoFps: '24', videoWidth: '1280', videoHeight: '720' })).toBe('fps=24,scale=1280:720');
  });

  it('puts the frame rate and size before an encoder\'s own filters', () => {
    const args = video({ videoEncoder: 'gif', videoContainer: 'gif', videoFps: '15', videoWidth: '480' }).ffmpegArgs;
    expect(args.filter(arg => arg === '-vf')).toHaveLength(1);
    expect(args[args.indexOf('-vf') + 1])
      .toBe('fps=15,scale=480:-2,split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1');
  });

  it('fits RealVideo into 352x288 in RealMedia, whose packets are limited to 64 kB, but not in AVI', () => {
    const fit = 'scale=352:288:force_original_aspect_ratio=decrease,pad=352:288:(ow-iw)/2:(oh-ih)/2,setsar=1';
    const vf = (videoEncoder: string, videoContainer: string, settings: Partial<FormatSettings> = {}) => {
      const args = video({ videoEncoder, videoContainer, videoAudio: 'none', ...settings }).ffmpegArgs;
      return args[args.indexOf('-vf') + 1];
    };
    expect(vf('rv20', 'rm')).toBe(fit);
    expect(vf('rv10', 'rm')).toBe(fit);
    expect(video({ videoEncoder: 'rv20', videoContainer: 'avi', videoAudio: 'none' }).ffmpegArgs).not.toContain('-vf');
    // RealVideo 1.0 still needs a multiple of 16 in AVI.
    expect(vf('rv10', 'avi')).toBe('crop=trunc(iw/16)*16:trunc(ih/16)*16');
    // A chosen size goes first, so the fit still wins.
    expect(vf('rv20', 'rm', { videoWidth: '1280' })).toBe(`scale=1280:-2,${fit}`);
  });

  it('encodes AV1 with libaom in realtime mode, or SVT-AV1 with one logical processor', () => {
    const encode = (videoEncoder: string, settings: Partial<FormatSettings> = {}) => {
      const args = video({ videoEncoder, videoContainer: 'webm', videoAudio: 'none', ...settings }).ffmpegArgs;
      return args.slice(args.indexOf('-c:v'), -1);
    };
    expect(encode('libaom-av1', { aomCrf: '28', aomSpeed: '6' })).toEqual(['-c:v', 'libaom-av1',
      '-usage', 'realtime', '-cpu-used', '6', '-crf', '28', '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p']);
    // With more than one, SVT-AV1 runs out of web workers and hangs.
    expect(encode('libsvtav1')).toEqual(['-c:v', 'libsvtav1',
      '-crf', '35', '-preset', '10', '-svtav1-params', 'lp=1', '-pix_fmt', 'yuv420p']);
  });

  it('never adds audio to containers that can\'t hold it', () => {
    expect(video({ videoEncoder: 'gif', videoContainer: 'gif' }).ffmpegArgs.some(arg => arg.includes(':a'))).toBe(false);
    expect(() => video({ videoEncoder: 'gif', videoContainer: 'gif' }, 'all')).toThrow('valid audio track');
  });

  it('re-encodes audio the container needs in its own format, even when copying is chosen', () => {
    expect(video({ videoEncoder: 'dvvideo', videoContainer: 'dv', videoAudio: 'copy' }).ffmpegArgs)
      .toEqual(expect.arrayContaining(['-c:a', 'pcm_s16le']));
  });

  it('re-encodes the audio to the chosen format, with its settings', () => {
    expect(video({ videoEncoder: 'libx264', videoContainer: 'mkv', videoAudio: 'encode', videoAudioFormat: 'FLAC', flacCompression: '8' })
      .ffmpegArgs.slice(-5)).toEqual(['-c:a', 'flac', '-compression_level', '8', 'output.mkv']);
    expect(video({ videoEncoder: 'libx264', videoContainer: 'mp4', videoAudioFormat: 'AC3', ac3Bitrate: '448' })
      .ffmpegArgs.slice(-5)).toEqual(['-c:a', 'ac3', '-b:a', '448k', 'output.mp4']);
    expect(video({ videoEncoder: 'mpeg2video', videoContainer: 'mpg', videoAudioFormat: 'MP2', mp2Bitrate: '256' })
      .ffmpegArgs.slice(-7)).toEqual(['-c:a', 'mp2', '-b:a', '256k', ...STEREO_AT_MOST, 'output.mpg']);
  });

  it('uses the container\'s default audio format when it can\'t hold the chosen one', () => {
    // WebM can't hold AAC, so it gets Opus; MPEG-PS can't either, so it gets MP2.
    expect(video({ videoEncoder: 'libvpx-vp9', videoContainer: 'webm', videoAudioFormat: 'AAC' }).ffmpegArgs)
      .toEqual(expect.arrayContaining(['-c:a', 'libopus']));
    expect(video({ videoEncoder: 'mpeg2video', videoContainer: 'mpg', videoAudioFormat: 'AAC' }).ffmpegArgs)
      .toEqual(expect.arrayContaining(['-c:a', 'mp2']));
  });

  it('uses a container\'s fixed audio whatever format is chosen', () => {
    expect(video({ videoEncoder: 'dvvideo', videoContainer: 'dv', videoAudioFormat: 'FLAC' }).ffmpegArgs.slice(-7))
      .toEqual(['-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2', 'output.dv']);
  });

  it('falls back to the encoder\'s default container, and the default encoder', () => {
    expect(video({ videoEncoder: 'libvpx-vp9', videoContainer: 'avi' }).outputFilename).toBe('output.webm');
    expect(video({ videoEncoder: 'no-such-encoder', videoContainer: 'mkv' }).ffmpegArgs).toContain('libx264');
  });

  it('offers every container it lists, and each encoder\'s containers exist', () => {
    for (const { containers } of Object.values(VIDEO_ENCODERS)) {
      expect(containers.length).toBeGreaterThan(0);
      for (const container of containers) expect(CONTAINERS).toHaveProperty(container);
    }
  });

  it('makes AAC the default audio format wherever the container can hold it', () => {
    for (const { audioFormats } of Object.values(CONTAINERS)) {
      if (audioFormats?.includes('AAC')) expect(audioFormats[0]).toBe('AAC');
    }
  });
});
