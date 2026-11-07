import { expect, it } from 'vitest';
import { downloadProgress, formatBytes, formatDuration } from './progress';

it('reports download percentage, speed and ETA', () => {
  expect(downloadProgress({ stage: 'download', downloaded_bytes: 25, total_bytes: 100, speed: 2048, eta: 3 }))
    .toMatchObject({ stage: 'Downloading', percent: 25, speed: '2.0 KiB/s', eta: 3 });
});

it('falls back to the estimated total, and to no percentage without one', () => {
  expect(downloadProgress({ stage: 'download', downloaded_bytes: 25, total_bytes: null, total_bytes_estimate: 100 }))
    .toMatchObject({ percent: 25, detail: '25 B / ~100 B' });
  expect(downloadProgress({ stage: 'download', downloaded_bytes: 25 }))
    .toMatchObject({ percent: undefined, detail: '25 B' });
});

it('shows postprocessing once a stream finishes', () => {
  expect(downloadProgress({ stage: 'download', status: 'finished', total_bytes: 100, downloaded_bytes: 100 }))
    .toEqual({ stage: 'Postprocessing' });
});

it('formats bytes and durations', () => {
  expect(formatBytes(1023)).toBe('1023 B');
  expect(formatBytes(1536)).toBe('1.5 KiB');
  expect(formatDuration(45)).toBe('45s');
  expect(formatDuration(3725)).toBe('1h 02m 05s');
});
