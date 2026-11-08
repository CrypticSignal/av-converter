import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { manualCommandArgs, videoThreadArgs } from './manualCommand';

const LIMITS = ['-threads', '4', '-filter_threads', '4', '-filter_complex_threads', '4'];

beforeEach(() => {
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Chrome/131.0' });
});
afterEach(() => vi.unstubAllGlobals());

describe('videoThreadArgs', () => {
  it('limits the encoder and filter threads with the multi-threaded core, but not the decoder', () => {
    expect(videoThreadArgs()).toEqual(LIMITS);
  });

  it('adds nothing without threads, or in Firefox', () => {
    vi.stubGlobal('crossOriginIsolated', false);
    expect(videoThreadArgs()).toEqual([]);
    vi.stubGlobal('crossOriginIsolated', true);
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 Firefox/133.0' });
    expect(videoThreadArgs()).toEqual([]);
  });
});

describe('manualCommandArgs', () => {
  it('puts the limits right after the input when the command encodes video', () => {
    expect(manualCommandArgs('in.mp4', '-c:v libx264 out.mp4').ffmpegArgs)
      .toEqual(['-i', 'in.mp4', ...LIMITS, '-c:v', 'libx264', 'out.mp4']);
    expect(manualCommandArgs('in.mp4', '-c:a libopus out.opus').ffmpegArgs)
      .toEqual(['-i', 'in.mp4', '-c:a', 'libopus', 'out.opus']);
  });

  it('puts the user\'s own thread options after the limits, so FFmpeg uses theirs', () => {
    const args = manualCommandArgs('in.mp4', '-filter_threads 2 -c:v libx264 out.mp4').ffmpegArgs;
    expect(args.lastIndexOf('-filter_threads')).toBeGreaterThan(args.indexOf('-filter_threads'));
    expect(args[args.lastIndexOf('-filter_threads') + 1]).toBe('2');
  });
});
