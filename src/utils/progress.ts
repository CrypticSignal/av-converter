export type OperationProgress = {
  stage: string;
  percent?: number;
  elapsed?: number;
  speed?: string;
  eta?: number;
  detail?: string;
};

export const nonnegative = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

const BYTE_UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

/** Format a byte count with binary units, e.g. 1536 -> "1.5 KiB". */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  return unit === 0 ? `${Math.round(value)} B` : `${value.toFixed(1)} ${BYTE_UNITS[unit]}`;
}

/** Format whole seconds as "45s", "2m 05s" or "1h 02m 05s". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor(total % 3600 / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

export function downloadProgress(event: Record<string, unknown>): OperationProgress {
  if (event.stage !== 'download' || event.status === 'finished') {
    return { stage: event.stage === 'metadata' ? 'Loading metadata' : 'Postprocessing' };
  }
  const positive = (value: unknown): value is number => nonnegative(value) && value > 0;
  // Many streams (DASH, HLS) only have an estimated size; mark it as approximate.
  const exact = positive(event.total_bytes);
  const total = exact ? event.total_bytes as number
    : positive(event.total_bytes_estimate) ? event.total_bytes_estimate : undefined;
  const bytes = nonnegative(event.downloaded_bytes) ? event.downloaded_bytes : undefined;
  return {
    stage: 'Downloading',
    percent: total !== undefined && bytes !== undefined ? Math.min(100, bytes / total * 100) : undefined,
    speed: nonnegative(event.speed) ? `${formatBytes(event.speed)}/s` : undefined,
    eta: nonnegative(event.eta) ? event.eta : undefined,
    detail: bytes !== undefined
      ? `${formatBytes(bytes)}${total ? ` / ${exact ? '' : '~'}${formatBytes(total)}` : ''}` : undefined,
  };
}
