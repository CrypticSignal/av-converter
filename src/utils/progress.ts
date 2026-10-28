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

export function downloadProgress(event: Record<string, unknown>): OperationProgress {
  if (event.stage !== 'download' || event.status === 'finished') {
    return { stage: event.stage === 'metadata' ? 'Loading metadata' : 'Postprocessing' };
  }
  const total = nonnegative(event.total_bytes) && event.total_bytes > 0 ? event.total_bytes : undefined;
  const bytes = nonnegative(event.downloaded_bytes) ? event.downloaded_bytes : undefined;
  return {
    stage: 'Downloading',
    percent: total !== undefined && bytes !== undefined ? Math.min(100, bytes / total * 100) : undefined,
    speed: nonnegative(event.speed) ? `${(event.speed / 1024).toFixed(1)} KiB/s` : undefined,
    eta: nonnegative(event.eta) ? event.eta : undefined,
    detail: bytes !== undefined ? `${bytes} bytes${total ? ` / ${total}` : ''}` : undefined,
  };
}
