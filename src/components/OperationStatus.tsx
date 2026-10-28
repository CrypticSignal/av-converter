import { LinearProgress } from '@mui/material';
import type { OperationProgress } from '../utils/progress';

export default function OperationStatus({ progress, busy, logs }: {
  progress: OperationProgress; busy: boolean; logs: string;
}) {
  return <section aria-label="Operation status">
    <div role="status" aria-live="polite" aria-atomic="true">
      {progress.stage}
      {progress.percent !== undefined && ` — ${progress.percent.toFixed(1)}%`}
      {progress.detail && ` — ${progress.detail}`}
      {progress.elapsed !== undefined && ` — Elapsed ${progress.elapsed.toFixed(1)}s`}
      {progress.speed !== undefined && ` — Speed ${progress.speed}`}
      {progress.eta !== undefined && ` — ETA ${Math.ceil(progress.eta)}s`}
    </div>
    {busy && <LinearProgress aria-label="Operation progress"
      variant={progress.percent === undefined ? 'indeterminate' : 'determinate'} value={progress.percent} />}
    <details><summary>Show logs</summary>
      <pre tabIndex={0} aria-label="Operation logs" style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{logs}</pre>
    </details>
  </section>;
}
