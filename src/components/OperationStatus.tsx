import { LinearProgress } from '@mui/material';
import { formatDuration, type OperationProgress } from '../utils/progress';

/** A small label/value pair in the status bar. */
const Stat = ({ label, value }: { label: string; value: string }) => (
  <span className="text-xs"><span className="text-slate-500">{label}</span> <span className="text-slate-200 tabular-nums">{value}</span></span>
);

export default function OperationStatus({ progress, busy, logs }: {
  progress: OperationProgress; busy: boolean; logs: string;
}) {
  return <section aria-label="Operation status" className="mt-6 text-left rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-4">
    <div className="flex items-baseline justify-between gap-3">
      <div role="status" aria-live="polite" aria-atomic="true" className="text-sm font-medium text-slate-200 flex items-center gap-2 min-w-0">
        <span className={`h-2 w-2 shrink-0 rounded-full ${busy ? 'bg-cyan-400 animate-pulse' : 'bg-slate-500'}`} aria-hidden="true" />
        <span className="min-w-0 break-words">
          {progress.stage}
          {progress.detail && <span className="text-slate-400"> — {progress.detail}</span>}
        </span>
      </div>
      {progress.percent !== undefined && (
        <span className="text-lg font-semibold gradient-text tabular-nums">{progress.percent.toFixed(1)}%</span>
      )}
    </div>
    {busy && <LinearProgress aria-label="Operation progress" sx={{ mt: 1.5 }}
      variant={progress.percent === undefined ? 'indeterminate' : 'determinate'} value={progress.percent} />}
    {(progress.elapsed !== undefined || progress.speed !== undefined || progress.eta !== undefined) && (
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {progress.elapsed !== undefined && <Stat label="Elapsed" value={formatDuration(Math.floor(progress.elapsed))} />}
        {progress.speed !== undefined && <Stat label="Speed" value={String(progress.speed)} />}
        {progress.eta !== undefined && <Stat label="ETA" value={formatDuration(Math.ceil(progress.eta))} />}
      </div>
    )}
    <details className="mt-3 group">
      <summary className="cursor-pointer select-none text-xs text-slate-400 hover:text-slate-200">Show logs</summary>
      <pre tabIndex={0} aria-label="Operation logs"
        className="mt-2 p-3 rounded-lg bg-black/50 ring-1 ring-white/10 text-[11px] leading-relaxed text-emerald-300/90 font-mono"
        style={{ maxHeight: 320, overflow: 'auto', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{logs || 'No output yet.'}</pre>
    </details>
  </section>;
}
