import { describe, expect, it } from 'vitest';
import { downloadProgress } from './progress';

describe('structured downloader progress', () => {
  it('uses exact totals and reported speed/ETA', () => {
    expect(downloadProgress({ stage: 'download', downloaded_bytes: 25, total_bytes: 100, speed: 2048, eta: 3 }))
      .toMatchObject({ stage: 'Downloading', percent: 25, speed: '2.0 KiB/s', eta: 3 });
  });
  it.each([null, undefined, 0, -1, NaN, Infinity, '100'])('falls back to the estimated total when the exact one is unusable: %s', total => {
    const result = downloadProgress({ stage: 'download', downloaded_bytes: 25, total_bytes: total, total_bytes_estimate: 100,
      speed: -1, eta: Infinity });
    expect(result.percent).toBe(25);
    expect(result.detail).toBe('25 bytes / ~100');
    expect(result.speed).toBeUndefined();
    expect(result.eta).toBeUndefined();
  });
  it('prefers the exact total over the estimate', () => {
    expect(downloadProgress({ stage: 'download', downloaded_bytes: 25, total_bytes: 50, total_bytes_estimate: 100 }))
      .toMatchObject({ percent: 50, detail: '25 bytes / 50' });
  });
  it.each([null, 0, -1, NaN, '100'])('does not invent progress without any usable total: %s', estimate => {
    const result = downloadProgress({ stage: 'download', downloaded_bytes: 25, total_bytes: null, total_bytes_estimate: estimate });
    expect(result.percent).toBeUndefined();
    expect(result.detail).toBe('25 bytes');
  });
  it('caps an exceeded estimate at 100%', () => {
    expect(downloadProgress({ stage: 'download', downloaded_bytes: 150, total_bytes_estimate: 100 }).percent).toBe(100);
  });
  it.each(['metadata', 'postprocess'])('keeps %s indeterminate despite stale totals', stage => {
    expect(downloadProgress({ stage, total_bytes: 100, downloaded_bytes: 100, speed: 1, eta: 0 }).percent).toBeUndefined();
  });
  it('clears metrics when a stream finishes and waits for postprocessing', () => {
    expect(downloadProgress({ stage: 'download', status: 'finished', total_bytes: 100, downloaded_bytes: 100 }))
      .toEqual({ stage: 'Postprocessing' });
  });
});
