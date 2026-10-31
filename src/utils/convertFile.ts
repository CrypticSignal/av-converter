import type { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
// The single-threaded core, bundled by Vite as hashed assets.
import singleThreadCoreURL from '@ffmpeg/core?url';
import singleThreadWasmURL from '@ffmpeg/core/wasm?url';
import type { AlertColor } from '@mui/material';
import { nonnegative, OperationProgress } from './progress';

const loads = new WeakMap<FFmpeg, Promise<void>>();
const INPUT_DIR = '/input';
// FFFSType.WORKERFS; the package's runtime exports are stubbed outside browsers.
const WORKERFS = 'WORKERFS' as FFFSType;
const ERROR_PATTERN = /error|invalid|unsupported|unknown|not found|no such|could not|unable|cannot|failed/i;

/**
 * The multi-threaded core needs SharedArrayBuffer, which browsers only provide on
 * cross-origin isolated pages (served with COOP and COEP headers). Elsewhere, such as
 * some embedded browsers or behind a proxy that strips the headers, use the slower
 * single-threaded core instead of failing.
 */
export const canUseThreads = (): boolean =>
  globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';

const coreFiles = (): [url: string, type: string][] => canUseThreads()
  ? [
      ['/ffmpeg_wasm/ffmpeg-core.js', 'text/javascript'],
      ['/ffmpeg_wasm/ffmpeg-core.wasm', 'application/wasm'],
      ['/ffmpeg_wasm/ffmpeg-core.worker.js', 'text/javascript'],
    ]
  : [
      [singleThreadCoreURL, 'text/javascript'],
      [singleThreadWasmURL, 'application/wasm'],
    ];

export const loadFFmpeg = (ffmpeg: FFmpeg, isActive = () => true): Promise<void> => {
  const existing = loads.get(ffmpeg);
  if (existing) return existing;
  const load = (async () => {
    const urls: string[] = [];
    try {
      // Create sequentially so even a partial failure releases every created URL.
      for (const [url, type] of coreFiles()) {
        if (!isActive()) throw new Error('Page unmounted');
        urls.push(await toBlobURL(url, type));
      }
      if (!isActive()) throw new Error('Page unmounted');
      const [coreURL, wasmURL, workerURL] = urls;
      // The single-threaded core has no worker file.
      await ffmpeg.load({ coreURL, wasmURL, ...(workerURL && { workerURL }) });
    } finally {
      urls.forEach(url => URL.revokeObjectURL(url));
    }
  })();
  loads.set(ffmpeg, load);
  // A failed load can be retried; successful loads stay cached per instance.
  void load.catch(() => { if (loads.get(ffmpeg) === load) loads.delete(ffmpeg); });
  return load;
};

export interface ConversionJob {
  file: File;
  /** Arguments that read the input as `-i <file.name>`. */
  ffmpegArgs: string[];
  outputFilename: string;
  /** False when the arguments may change the output's duration, so a percentage would mislead. */
  knownTimeline: boolean;
  /** Turns false once the job is cancelled or the page unmounts; nothing is reported after that. */
  isActive: () => boolean;
  onAlert: (severity: AlertColor, message: string) => void;
  onStatus: (value: OperationProgress) => void;
  onLog: (message: string) => void;
}

export const convertFile = async (ffmpeg: FFmpeg, job: ConversionJob) => {
  const { file, ffmpegArgs, outputFilename, knownTimeline, isActive, onAlert, onStatus, onLog } = job;
  const inputFilename = file.name;
  let duration: number | undefined;
  let started: number | undefined;
  // FFmpeg's first error line is usually the root cause; later ones are consequences.
  let firstError: string | undefined;
  const report = (value: OperationProgress) => { if (isActive()) onStatus(value); };
  const checkActive = () => { if (!isActive()) throw new Error('Page unmounted'); };
  const handleLog = ({ message }: { message: string }) => {
    if (!isActive()) return;
    onLog(message);
    if (firstError === undefined && message !== 'Conversion failed!' && ERROR_PATTERN.test(message)) {
      firstError = message.trim().slice(0, 300);
    }
    const match = message.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (knownTimeline && match) {
      const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      if (seconds > 0) duration = seconds;
    }
  };
  const handleProgress = ({ time }: { progress: number; time?: number }) => {
    if (!isActive() || started === undefined) return;
    const elapsed = (performance.now() - started) / 1000;
    const seconds = nonnegative(time) ? time / 1_000_000 : undefined;
    const rate = seconds !== undefined && seconds > 0 && elapsed > 0 ? seconds / elapsed : undefined;
    const percent = duration && seconds !== undefined ? Math.min(100, seconds / duration * 100) : undefined;
    report({ stage: 'Converting', elapsed, percent,
      detail: seconds !== undefined ? `Processed ${seconds.toFixed(1)}s` : undefined,
      speed: rate !== undefined ? `${rate.toFixed(2)}x` : undefined,
      eta: duration && seconds !== undefined && rate ? Math.max(0, duration - seconds) / rate : undefined });
  };
  let filesTouched = false;
  let inputMounted = false;
  let inputWritten = false;
  const inputPath = `${INPUT_DIR}/${inputFilename}`;
  try {
    checkActive();
    onAlert('info', canUseThreads() ? 'Loading FFmpeg...'
      : 'Loading FFmpeg. This browser does not allow multi-threading here, so conversion will be slower.');
    report({ stage: 'Loading FFmpeg' });
    await loadFFmpeg(ffmpeg, isActive);
    checkActive();
    ffmpeg.on('log', handleLog);
    ffmpeg.on('progress', handleProgress);
    filesTouched = true;
    // Never allow a failed execution to download a previous conversion's output.
    await ffmpeg.deleteFile(outputFilename).catch(() => {});
    checkActive();
    // Mount the input read-only so it is read on demand rather than copied into
    // memory; fall back to copying if this core lacks WORKERFS. Either way the
    // input lives in its own directory, so an output may share its name.
    await ffmpeg.createDir(INPUT_DIR).catch(() => {}); // Exists after an earlier conversion.
    checkActive();
    inputMounted = await ffmpeg.mount(WORKERFS, { blobs: [{ name: inputFilename, data: file }] }, INPUT_DIR);
    checkActive();
    if (!inputMounted) {
      const input = await fetchFile(file);
      checkActive();
      inputWritten = true;
      await ffmpeg.writeFile(inputPath, input);
      checkActive();
    }
    const args = ffmpegArgs.map((arg, i) => ffmpegArgs[i - 1] === '-i' && arg === inputFilename ? inputPath : arg);
    started = performance.now();
    report({ stage: 'Converting' });
    onAlert('info', 'Converting');
    const exitCode = await ffmpeg.exec(args);
    checkActive();
    if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);
    report({ stage: 'Preparing output' });
    const fileData = await ffmpeg.readFile(outputFilename);
    checkActive();
    const objectURL = URL.createObjectURL(new Blob([fileData as Uint8Array]));
    try {
      const anchor = document.createElement('a');
      anchor.href = objectURL;
      anchor.download = outputFilename;
      anchor.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectURL), 100);
    }
    onAlert('success', 'Done! The converted file should have started downloading.');
    report({ stage: 'Conversion complete' });
  } catch (error) {
    if (isActive()) {
      console.error(error);
      const detail = firstError ?? (error instanceof Error ? error.message : undefined);
      onAlert('error', detail ? `An error occurred during conversion: ${detail}` : 'An error occurred during conversion.');
      report({ stage: 'Conversion failed' });
    }
  } finally {
    ffmpeg.off('log', handleLog);
    ffmpeg.off('progress', handleProgress);
    if (filesTouched && isActive()) {
      // Missing files and a terminated worker are expected cleanup cases.
      const cleanup = [() => ffmpeg.deleteFile(outputFilename)];
      if (inputMounted) cleanup.push(() => ffmpeg.unmount(INPUT_DIR));
      if (inputWritten) cleanup.push(() => ffmpeg.deleteFile(inputPath));
      for (const step of cleanup) {
        if (!isActive()) break;
        try { await step(); } catch { /* best effort */ }
      }
    }
  }
};
