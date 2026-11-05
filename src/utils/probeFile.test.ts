// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { parseProbeOutput, probeFile } from './probeFile';

vi.mock('./convertFile', () => ({ loadFFmpeg: vi.fn().mockResolvedValue(undefined) }));

const PROBE_JSON = JSON.stringify({
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, bit_rate: '4000000' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 6, channel_layout: '5.1', bit_rate: '384000' },
    { index: 2, codec_type: 'audio', codec_name: 'opus', sample_rate: '48000', channels: 2 },
    { codec_type: 'subtitle' },
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', format_long_name: 'QuickTime / MOV', duration: '125.5' },
});

const worker = () => ({
  createDir: vi.fn().mockResolvedValue(true),
  mount: vi.fn().mockResolvedValue(true),
  unmount: vi.fn().mockResolvedValue(true),
  // As the real cores do, even on success.
  ffprobe: vi.fn().mockResolvedValue(-1),
  readFile: vi.fn().mockResolvedValue(PROBE_JSON),
  deleteFile: vi.fn().mockResolvedValue(true),
});

describe('parseProbeOutput', () => {
  it('summarises the format, duration and each stream', () => {
    expect(parseProbeOutput(PROBE_JSON)).toEqual({
      duration: 125.5,
      format: 'QuickTime / MOV',
      streams: [
        { index: 0, type: 'video', codec: 'h264', details: ['1920x1080', '4000 kbps'] },
        { index: 1, type: 'audio', codec: 'aac', details: ['48000 Hz', '5.1', '384 kbps'] },
        { index: 2, type: 'audio', codec: 'opus', details: ['48000 Hz', '2 channels'] },
        { index: 3, type: 'subtitle', codec: undefined, details: [] },
      ],
    });
  });
  it('tolerates missing sections and unknown durations', () => {
    expect(parseProbeOutput(JSON.stringify({ format: { duration: 'N/A', format_name: 'wav' } })))
      .toEqual({ duration: undefined, format: 'wav', streams: [] });
  });
});

describe('probeFile', () => {
  it('mounts the file, runs ffprobe to a JSON file and cleans up', async () => {
    const w = worker();
    const info = await probeFile(w as unknown as FFmpeg, new File(['x'], 'clip.mp4'), () => true);
    expect(info.duration).toBe(125.5);
    expect(w.mount).toHaveBeenCalledWith('WORKERFS', { blobs: [{ name: 'clip.mp4', data: expect.any(File) }] }, '/probe');
    const args = w.ffprobe.mock.calls[0][0] as string[];
    expect(args).toContain('/probe/clip.mp4');
    expect(args.slice(-2)).toEqual(['-o', '/probe.json']);
    expect(w.readFile).toHaveBeenCalledWith('/probe.json', 'utf8');
    expect(w.unmount).toHaveBeenCalledWith('/probe');
    expect(w.deleteFile).toHaveBeenCalledTimes(2);
    expect(w.deleteFile.mock.invocationCallOrder[0]).toBeLessThan(w.ffprobe.mock.invocationCallOrder[0]);
  });
  it.each([
    ['no output file', (w: ReturnType<typeof worker>) => w.readFile.mockRejectedValue(new Error('ENOENT'))],
    ['unparseable output', (w: ReturnType<typeof worker>) => w.readFile.mockResolvedValue('')],
  ])('fails with %s and still cleans up', async (_, breakIt) => {
    const w = worker();
    breakIt(w);
    await expect(probeFile(w as unknown as FFmpeg, new File(['x'], 'bad.bin'), () => true)).rejects.toThrow();
    expect(w.unmount).toHaveBeenCalledWith('/probe');
  });
  it('stops once superseded', async () => {
    const w = worker();
    let active = true;
    w.ffprobe.mockImplementation(async () => { active = false; return 0; });
    await expect(probeFile(w as unknown as FFmpeg, new File(['x'], 'a.wav'), () => active)).rejects.toThrow('superseded');
    expect(w.readFile).not.toHaveBeenCalled();
  });
});
