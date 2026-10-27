import { FormEvent, useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Container, LinearProgress, MenuItem, TextField, Typography } from '@mui/material';

type DownloadEvent =
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
  const consoleElement = useRef<HTMLPreElement>(null);

  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (consoleElement.current) consoleElement.current.scrollTop = consoleElement.current.scrollHeight;
  }, [output]);

  async function download(event: FormEvent) {
    event.preventDefault();
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setOutput('');
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/download', {
        method: 'POST', signal: request.signal,
        body: new URLSearchParams({ url: url.trim(), format: downloadType }),
      });
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
        if (!line.trim()) return;
        const message: DownloadEvent = JSON.parse(line);
        if (message.type === 'log') {
          // Keep the latest output, rather than growing memory for hours-long recordings.
          setOutput(previous => (previous + message.message + '\n').slice(-100_000));
        } else if (message.type === 'error') {
          throw new Error(message.message);
        } else if (message.type === 'ready' && !finished) {
          setResult({ url: message.url, filename: message.filename });
          finished = true;
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
      if (!request.signal.aborted) setError(err instanceof Error ? err.message : 'Download failed.');
    } finally {
      controller.current = null;
      setBusy(false);
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
        {error && <Alert severity="error">{error}</Alert>}
        {result && <Alert severity="success">
          {result.filename} is ready. Your browser should start downloading it automatically.
          {' '}If it didn’t, <a href={result.url} download={result.filename} className="underline">click here to download</a>.
          {' '}This link will expire in 10 minutes.
        </Alert>}
      </Box>
      {output && <Box sx={{ mt: 3, textAlign: 'left' }}>
        <Typography component="h2" variant="h6">yt-dlp output</Typography>
        <Box component="pre" ref={consoleElement} tabIndex={0} aria-label="yt-dlp output"
          sx={{ bgcolor: '#111', color: '#eee', p: 2, maxHeight: 320, overflow: 'auto',
            whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 12, borderRadius: 1 }}>
          {output}
        </Box>
      </Box>}
      <Alert severity="warning" sx={{ mt: 3, textAlign: 'left' }}>
        You can switch to another tab while a download is in progress, but keep this page/tab open.
      </Alert>
    </Container>
  );
}
