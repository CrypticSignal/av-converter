import { FormEvent, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Container, MenuItem, TextField } from '@mui/material';
import OperationStatus from '../components/OperationStatus';
import { downloadProgress, OperationProgress } from '../utils/progress';

type DownloadEvent =
  | { type: 'stage'; stage: string }
  | ({ type: 'progress'; stage: string } & Record<string, unknown>)
  | { type: 'log'; message: string }
  | { type: 'error'; message: string }
  | { type: 'ready'; url: string; filename: string };

const DOWNLOAD_TYPES = [
  {
    value: 'default', label: 'Default',
    description: 'Best video quality. Also contains the audio.',
  },
  {
    value: 'best_audio', label: 'Audio Only (best)',
    description: 'Best quality audio file.',
  },
  {
    value: 'mp4', label: 'MP4',
    description: 'Best MP4 video-only stream plus the best M4A or AAC audio stream. Fails if there are no such streams.',
  },
  {
    value: 'mp3', label: 'Audio Only (MP3)',
    description: 'An audio-only MP3 file.',
  },
];

export default function DownloadPage() {
  const [url, setUrl] = useState('');
  const [downloadType, setDownloadType] = useState('default');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ url: string; filename: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<OperationProgress>({ stage: 'Ready' });

  useEffect(() => () => {
    const current = controller.current;
    controller.current = null;
    current?.abort();
  }, []);
  function cancel() {
    const current = controller.current;
    controller.current = null;
    current?.abort();
    setBusy(false);
    setStatus({ stage: 'Cancelled' });
  }

  async function download(event: FormEvent) {
    event.preventDefault();
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    const active = () => controller.current === request && !request.signal.aborted;
    setStatus({ stage: 'Loading metadata' });
    setBusy(true);
    setOutput('');
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/download', {
        method: 'POST', signal: request.signal,
        body: new URLSearchParams({ url: url.trim(), format: downloadType }),
      });
      if (!active()) { await response.body?.cancel().catch(() => undefined); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Download service returned HTTP ${response.status}.`);
      }
      if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
        throw new Error('The download service returned an unexpected response.');
      }

      // Only log messages travel through fetch; the completed file is a native download.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let finished = false;
      function handleLine(line: string) {
        if (!active() || finished) return;
        if (!line.trim()) return;
        const message: DownloadEvent = JSON.parse(line);
        if (message.type === 'stage') {
          setStatus({ stage: message.stage === 'metadata' ? 'Loading metadata'
            : message.stage === 'download' ? 'Downloading' : 'Postprocessing' });
        } else if (message.type === 'progress') {
          setStatus(downloadProgress(message));
        } else if (message.type === 'log') {
          // Keep the latest output, rather than growing memory for hours-long recordings.
          setOutput(previous => (previous + message.message + '\n').slice(-100_000));
        } else if (message.type === 'error') {
          throw new Error(message.message);
        } else if (message.type === 'ready' && !finished) {
          setResult({ url: message.url, filename: message.filename });
          finished = true;
          setStatus({ stage: 'Ready to download' });
          // Let the browser download directly, without fetching the file into page memory.
          const link = document.createElement('a');
          link.href = message.url;
          link.download = message.filename;
          document.body.appendChild(link);
          try {
            link.click();
          } finally {
            link.remove();
          }
        }
      }
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (!active()) break;
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          lines.forEach(handleLine);
          if (done) break;
        }
        handleLine(buffer);
        if (!finished) throw new Error('The connection ended before the video was ready. Please try again.');
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    } catch (err) {
      if (active()) {
        setError(err instanceof Error ? err.message : 'Download failed.');
        setStatus({ stage: 'Download failed' });
      }
    } finally {
      if (active()) {
        controller.current = null;
        setBusy(false);
      }
    }
  }

  return (
    <Container maxWidth="sm" sx={{ py: 5 }}>
      <Box component="form" onSubmit={download} sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <TextField name="url" label="Video URL" type="url" required fullWidth value={url}
          disabled={busy} onChange={event => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..." inputProps={{ maxLength: 2048 }} />
        {url.trim() && <TextField name="format" select label="Download type" value={downloadType}
          disabled={busy} onChange={event => setDownloadType(event.target.value)}
          helperText={DOWNLOAD_TYPES.find(type => type.value === downloadType)?.description}>
          {DOWNLOAD_TYPES.map(type => <MenuItem key={type.value} value={type.value}>{type.label}</MenuItem>)}
        </TextField>}
        <Button type="submit" variant="contained" disabled={busy || !url.trim()}>
          {busy ? 'Preparing download…' : 'Download'}
        </Button>
        {busy && <Button type="button" onClick={cancel}>Cancel</Button>}
        <OperationStatus progress={status} busy={busy} logs={output} />
        {error && <Alert severity="error">{error}</Alert>}
        {result && <Alert severity="success">
          {result.filename} is ready. Your browser should start downloading it automatically.
          {' '}If it didn’t, <a href={result.url} download={result.filename} className="underline">click here to download</a>.
          {' '}This link will expire in 10 minutes.
        </Alert>}
      </Box>
      <Alert severity="warning" sx={{ mt: 3, textAlign: 'left' }}>
        You can switch to another tab while a download is in progress, but keep this page/tab open.
      </Alert>
    </Container>
  );
}
