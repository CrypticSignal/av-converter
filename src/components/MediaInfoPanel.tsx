import Typography from '@mui/material/Typography';
import type { MediaInfo } from '../utils/probeFile';
import { formatDuration } from '../utils/progress';

export type MediaInfoState =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; info: MediaInfo };

const capitalise = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The selected file's duration, container and streams, as read by ffprobe. */
const MediaInfoPanel = ({ state }: { state: MediaInfoState }) => {
  if (state.status === 'loading') {
    return <Typography variant="body2" color="text.secondary">Reading file information…</Typography>;
  }
  if (state.status === 'failed') {
    return <Typography variant="body2" color="text.secondary">Couldn't read this file's information.</Typography>;
  }
  const { duration, format, streams } = state.info;
  return (
    <section aria-label="File information" className="max-w-md mx-auto mb-2 text-sm">
      <Typography variant="body2">
        {[duration !== undefined && `Duration: ${formatDuration(duration)}`, format && `Format: ${format}`]
          .filter(Boolean).join(' · ')}
      </Typography>
      {streams.length > 0 && (
        <ul className="mt-1 text-gray-600">
          {streams.map(stream => (
            <li key={stream.index}>
              Stream {stream.index}: {capitalise(stream.type)}
              {stream.codec && ` (${stream.codec})`}
              {stream.details.length > 0 && ` — ${stream.details.join(', ')}`}
            </li>
          ))}
        </ul>
      )}
      {streams.length > 0 && !streams.some(stream => stream.type === 'audio') && (
        <Typography variant="body2" color="warning.main">This file has no audio stream to convert.</Typography>
      )}
    </section>
  );
};

export default MediaInfoPanel;
