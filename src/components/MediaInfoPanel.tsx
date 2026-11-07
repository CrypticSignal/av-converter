import Typography from '@mui/material/Typography';
import type { MediaInfo } from '../utils/probeFile';
import { formatDuration } from '../utils/progress';

export type MediaInfoState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; info: MediaInfo };

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const STREAM_COLOURS: Record<string, string> = {
  audio: 'bg-cyan-400/15 text-cyan-300 ring-cyan-400/30',
  video: 'bg-violet-400/15 text-violet-300 ring-violet-400/30',
  subtitle: 'bg-amber-400/15 text-amber-300 ring-amber-400/30',
};

/** The selected file's duration, container and streams, as read by ffprobe. */
const MediaInfoPanel = ({ state }: { state: MediaInfoState }) => {
  if (state.status === 'loading') {
    return (
      <p className="mt-4 text-sm text-slate-400 flex items-center justify-center gap-2">
        <span className="h-3 w-3 rounded-full border-2 border-violet-400 border-t-transparent animate-spin" aria-hidden="true" />
        Reading file information…
      </p>
    );
  }
  if (state.status === 'failed') {
    return <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>Couldn't read this file's information.</Typography>;
  }
  const { duration, format, streams } = state.info;
  return (
    <section aria-label="File information" className="float-in mt-4 text-sm text-left rounded-xl bg-white/[0.03] ring-1 ring-white/10 p-4">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-slate-300">
        {duration !== undefined && <span><span className="text-slate-500">Duration</span> {formatDuration(duration)}</span>}
        {format && <span><span className="text-slate-500">Format</span> {format}</span>}
      </div>
      {streams.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {streams.map(stream => (
            <li key={stream.index} className="flex flex-wrap items-center gap-2 text-slate-400">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${STREAM_COLOURS[stream.type] ?? 'bg-white/10 text-slate-300 ring-white/20'}`}>
                {capitalise(stream.type)}
              </span>
              <span>
                Stream {stream.index}
                {stream.codec && <> · <span className="text-slate-200">{stream.codec}</span></>}
                {stream.details.length > 0 && ` — ${stream.details.join(', ')}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {streams.length > 0 && !streams.some(stream => stream.type === 'audio') && (
        <Typography variant="body2" color="warning.main" sx={{ mt: 1.5 }}>This file has no audio stream to convert.</Typography>
      )}
    </section>
  );
};

export default MediaInfoPanel;
