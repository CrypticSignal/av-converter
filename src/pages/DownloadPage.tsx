import { FormEvent, useEffect, useRef, useState } from 'react';
import Alert from '../components/Alert';
import Button from '../components/Button';
import SelectField from '../components/SelectField';
import TextField from '../components/TextField';
import OperationStatus from '../components/OperationStatus';
import { downloadProgress, OperationProgress } from '../utils/progress';
import { downloadFile } from '../utils/downloadFile';

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
  const [password, setPassword] = useState('');
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
        body: new URLSearchParams({ password, url: url.trim(), format: downloadType }),
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
      try {
        while (active()) {
          const { value, done } = await reader.read();
          if (!active()) return;
          buffer += decoder.decode(value, { stream: !done });
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          if (done) lines.push(buffer);
          for (const line of lines) {
            if (!line.trim()) continue;
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
            } else if (message.type === 'ready') {
              setResult({ url: message.url, filename: message.filename });
              setStatus({ stage: 'Ready to download' });
              downloadFile(message.url, message.filename);
              return;
            }
          }
          if (done) throw new Error('The connection ended before the video was ready. Please try again.');
        }
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
    <div className="mx-auto max-w-xl py-12">
      <header className="pb-8">
        <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">
          <span className="gradient-text">Video</span> Downloader
        </h1>
        <p className="mt-3 text-slate-400">Paste a link and pick what you want to keep.</p>
      </header>
      <form className="glass-card float-in flex flex-col gap-4 rounded-3xl p-5 text-left sm:p-8" onSubmit={download}>
        <TextField name="password" label="Password" type="password" required value={password}
          disabled={busy} onChange={event => setPassword(event.target.value)}
          autoComplete="current-password" maxLength={1024} />
        <TextField name="url" label="Video URL" type="url" required value={url}
          disabled={busy} onChange={event => setUrl(event.target.value)}
          placeholder="https://www.youtube.com/watch?v=..." maxLength={2048} />
        {url.trim() && <SelectField id="format" label="Download type" value={downloadType} fullWidth
          disabled={busy} onChange={setDownloadType}
          helperText={DOWNLOAD_TYPES.find(type => type.value === downloadType)?.description}
          options={DOWNLOAD_TYPES.map(type => [type.value, type.label] as const)} />}
        <Button type="submit" className="mt-1 py-3" disabled={busy || !url.trim() || !password}>
          {busy ? 'Preparing download…' : 'Download'}
        </Button>
        {busy && <Button variant="outline" onClick={cancel}>Cancel</Button>}
        <OperationStatus progress={status} busy={busy} logs={output} />
        {error && <Alert severity="error">{error}</Alert>}
        {result && <Alert severity="success">
          {result.filename} is ready. Your browser should start downloading it automatically.
          {' '}If it didn’t, <a href={result.url} download={result.filename} className="underline">click here to download</a>.
          {' '}This link will expire in 10 minutes.
        </Alert>}
      </form>
      <Alert severity="warning" className="mt-6">
        You can switch to another tab while a download is in progress, but keep this page/tab open.
      </Alert>
    </div>
  );
}
