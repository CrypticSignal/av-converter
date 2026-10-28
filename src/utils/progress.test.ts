import { describe, expect, it } from 'vitest';
import { downloadProgress } from './progress';

describe('structured downloader progress', () => {
  it('uses exact totals and reported speed/ETA', () => {
    expect(downloadProgress({ stage: 'download', downloaded_bytes: 25, total_bytes: 100, speed: 2048, eta: 3 }))
      .toMatchObject({ stage: 'Downloading', percent: 25, speed: '2.0 KiB/s', eta: 3 });
  });
  it.each([null, undefined, 0, -1, NaN, Infinity, '100'])('does not invent progress from invalid or estimated totals: %s', total => {
    const result = downloadProgress({ stage: 'download', downloaded_bytes: 25, total_bytes: total, total_bytes_estimate: 100,
      speed: -1, eta: Infinity });
    expect(result.percent).toBeUndefined();
    expect(result.speed).toBeUndefined();
    expect(result.eta).toBeUndefined();
  });
  it.each(['metadata', 'postprocess'])('keeps %s indeterminate despite stale totals', stage => {
    expect(downloadProgress({ stage, total_bytes: 100, downloaded_bytes: 100, speed: 1, eta: 0 }).percent).toBeUndefined();
  });
  it('clears metrics when a stream finishes and waits for postprocessing', () => {
    expect(downloadProgress({ stage: 'download', status: 'finished', total_bytes: 100, downloaded_bytes: 100 }))
      .toEqual({ stage: 'Postprocessing' });
  });
});
