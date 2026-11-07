import type { FFFSType, FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
// Both cores are bundled by Vite as content-hashed assets, so browsers can cache them for good.
// They're built from ffmpeg.wasm's source (see vendor/ffmpeg-core/README.md), because the
// latest npm release lacks the fix for the Opus encoder running out of stack.
import singleThreadCoreURL from '../../vendor/ffmpeg-core/st/ffmpeg-core.js?url';
import singleThreadWasmURL from '../../vendor/ffmpeg-core/st/ffmpeg-core.wasm?url';
import multiThreadCoreURL from '../../vendor/ffmpeg-core/mt/ffmpeg-core.js?url';
import multiThreadWasmURL from '../../vendor/ffmpeg-core/mt/ffmpeg-core.wasm?url';
import multiThreadWorkerURL from '../../vendor/ffmpeg-core/mt/ffmpeg-core.worker.js?url';
import type { AlertColor } from '@mui/material';
import { nonnegative, OperationProgress } from './progress';
import { downloadFile } from './downloadFile';

const loads = new WeakMap<FFmpeg, Promise<void>>();
/** Instances whose load has succeeded (their promise in `loads` has resolved). */
const finishedLoads = new WeakSet<FFmpeg>();
const INPUT_DIR = '/input';
// FFFSType.WORKERFS; the package's runtime exports are stubbed outside browsers.
const WORKERFS = 'WORKERFS' as FFFSType;
const ERROR_PATTERN = /error|invalid|unsupported|unknown|not found|no such|could not|unable|cannot|failed/i;
// How browsers and FFmpeg's WebAssembly runtime report running out of memory.
const OUT_OF_MEMORY = /out of memory|allocation failed|Cannot enlarge memory|Aborted\(OOM\)|Invalid typed array length|Array buffer allocation/i;
/** What to try after running out of memory. The converted file is held in memory until it's saved. */
export const OUT_OF_MEMORY_ADVICE = 'The converted file has to fit in the browser\'s memory until it\'s saved. '
  + 'Try converting a shorter part of the file (e.g. in manual mode, -t 600 converts the first 10 minutes), or closing other tabs.';

/**
 * Wait for an answer from FFmpeg's worker, but give up after a while. When the worker runs
 * out of memory it dies without a word, and ffmpeg.wasm would then wait forever. Stopping the
 * worker makes any other waiting request fail straight away, so clean-up can't hang either.
 * Copying even several GB normally takes seconds, so two minutes is generous.
 */
const WORKER_TIMEOUT_MS = 120_000;
const withTimeout = async <T>(ffmpeg: FFmpeg, request: Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('FFmpeg stopped responding, most likely because it ran out of memory.'));
      ffmpeg.terminate();
    }, WORKER_TIMEOUT_MS);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

/** Set once the multi-threaded core fails to load. From then on, this page uses the single-threaded one. */
let threadsFailed = false;
/** Instances moved to the single-threaded core after running out of memory with threads. */
const singleThreaded = new WeakSet<FFmpeg>();
/** Whether each loaded instance runs the multi-threaded core. */
const loadedWithThreads = new WeakMap<FFmpeg, boolean>();

/**
 * The multi-threaded core needs SharedArrayBuffer, which browsers only provide on
 * cross-origin isolated pages (served with COOP and COEP headers). Elsewhere, such as
 * some embedded browsers or behind a proxy that strips the headers, use the slower
 * single-threaded core instead of failing. It's also used once the multi-threaded core
 * has failed to load, e.g. when the browser can't spare the 1 GB of memory it reserves.
 */
export const canUseThreads = (): boolean =>
  !threadsFailed && globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined';

/** Whether this instance runs the multi-threaded core. False until it has loaded. */
export const usesThreads = (ffmpeg: FFmpeg): boolean => loadedWithThreads.get(ffmpeg) === true;

const coreFiles = (threads: boolean): [url: string, type: string][] => threads
  ? [
      [multiThreadCoreURL, 'text/javascript'],
      [multiThreadWasmURL, 'application/wasm'],
      [multiThreadWorkerURL, 'text/javascript'],
    ]
  : [
      [singleThreadCoreURL, 'text/javascript'],
      [singleThreadWasmURL, 'application/wasm'],
    ];

/** The core's files were fetched, but the core failed to start. */
class CoreStartError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
  }
}

/** Fetch a core's files as blob URLs and start it. Failing to start throws a CoreStartError. */
const loadCore = async (ffmpeg: FFmpeg, threads: boolean, isActive: () => boolean) => {
  const urls: string[] = [];
  try {
    // Create sequentially so even a partial failure releases every created URL.
    for (const [url, type] of coreFiles(threads)) {
      if (!isActive()) throw new Error('Page unmounted');
      urls.push(await toBlobURL(url, type));
    }
    if (!isActive()) throw new Error('Page unmounted');
    const [coreURL, wasmURL, workerURL] = urls;
    // The single-threaded core has no worker file.
    try {
      await ffmpeg.load({ coreURL, wasmURL, ...(workerURL && { workerURL }) });
    } catch (error) {
      throw new CoreStartError(error);
    }
    loadedWithThreads.set(ffmpeg, threads);
  } finally {
    urls.forEach(url => URL.revokeObjectURL(url));
  }
};

export const loadFFmpeg = (ffmpeg: FFmpeg, isActive = () => true): Promise<void> => {
  const existing = loads.get(ffmpeg);
  // A finished load is stale once the worker has been terminated (e.g. after it stopped
  // responding), and the instance then needs loading again.
  if (existing && (ffmpeg.loaded || !finishedLoads.has(ffmpeg))) return existing;
  finishedLoads.delete(ffmpeg);
  const load = (async () => {
    const threads = canUseThreads() && !singleThreaded.has(ffmpeg);
    try {
      await loadCore(ffmpeg, threads, isActive);
    } catch (error) {
      // Only a core that failed to start is the threads' fault, not a failed download or a
      // cancelled load (terminating the worker also fails the load, but isActive is then false).
      if (!threads || !(error instanceof CoreStartError) || !isActive()) throw error;
      // The multi-threaded core reserves 1 GB of memory and starts 32 threads up front,
      // which some browsers and devices refuse. The single-threaded core needs far less.
      console.warn('The multi-threaded FFmpeg core failed to load, so the single-threaded one is used.', error);
      threadsFailed = true;
      ffmpeg.terminate(); // Discard the failed worker; the next load starts a new one.
      await loadCore(ffmpeg, false, isActive);
    }
    finishedLoads.add(ffmpeg);
  })();
  loads.set(ffmpeg, load);
  // A failed load can be retried; successful loads stay cached per instance.
  void load.catch(() => { if (loads.get(ffmpeg) === load) loads.delete(ffmpeg); });
  return load;
};

/**
 * Restart an instance on the single-threaded core, which it then keeps. FFmpeg's memory can
 * grow to about 2 GB there, while the multi-threaded core's is fixed at 1 GB.
 */
const switchToSingleThread = (ffmpeg: FFmpeg, isActive: () => boolean) => {
  singleThreaded.add(ffmpeg);
  ffmpeg.terminate();
  loads.delete(ffmpeg);
  finishedLoads.delete(ffmpeg);
  return loadFFmpeg(ffmpeg, isActive);
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
  /**
   * Receives the converted file's object URL after its download starts, so the page can
   * offer it again. The receiver then owns the URL and must revoke it.
   */
  onOutput: (output: ConvertedFile) => void;
}

export interface ConvertedFile {
  url: string;
  filename: string;
  size: number;
}

export const convertFile = async (ffmpeg: FFmpeg, job: ConversionJob) => {
  // If the multi-threaded core crashes, most likely by running out of memory, try once more
  // with the single-threaded one, whose memory can grow further. It's slower, but can finish
  // where threads can't (e.g. with very large video frames, or filters that buffer a lot).
  if (await convertOnce(ffmpeg, job, false) === 'retry single-threaded') {
    await convertOnce(ffmpeg, job, true);
  }
};

const convertOnce = async (ffmpeg: FFmpeg, job: ConversionJob, isRetry: boolean): Promise<'retry single-threaded' | void> => {
  const { file, ffmpegArgs, outputFilename, knownTimeline, isActive, onAlert, onStatus, onLog, onOutput } = job;
  const inputFilename = file.name;
  let retry = false;
  // Whether the multi-threaded core failed to start just now, so the single-threaded one is used.
  let fellBack = false;
  /**
   * Whether the core crashed while running the command. The multi-threaded core's memory is
   * fixed at 1 GB, and FFmpeg needing more makes it crash (ffmpeg.wasm then reports a
   * TypeError rather than running out of memory). The single-threaded core's memory can grow
   * to about 2 GB. Files, including the output, are held outside that memory.
   */
  let execCrashed = false;
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
  const inputPath = `${INPUT_DIR}/${inputFilename}`;
  try {
    checkActive();
    report({ stage: 'Loading FFmpeg' });
    if (isRetry) {
      onAlert('warning', 'Multi-threaded FFmpeg crashed, most likely by running out of memory, so trying again '
        + 'without multi-threading. This is slower, but can use more memory.');
      onLog('The multi-threaded core crashed. Retrying with the single-threaded core.');
      await switchToSingleThread(ffmpeg, isActive);
    } else {
      onAlert('info', canUseThreads() ? 'Loading FFmpeg...'
        : 'Loading FFmpeg. This browser does not allow multi-threading here, so conversion will be slower.');
      const expectedThreads = canUseThreads();
      await loadFFmpeg(ffmpeg, isActive);
      fellBack = expectedThreads && !usesThreads(ffmpeg);
    }
    checkActive();
    ffmpeg.on('log', handleLog);
    ffmpeg.on('progress', handleProgress);
    filesTouched = true;
    // Never allow a failed execution to download a previous conversion's output.
    await ffmpeg.deleteFile(outputFilename).catch(() => {});
    // Mount the input read-only so it is read on demand rather than copied into memory.
    // It lives in its own directory, so an output may share its name.
    await ffmpeg.createDir(INPUT_DIR).catch(() => {}); // Exists after an earlier conversion.
    inputMounted = await ffmpeg.mount(WORKERFS, { blobs: [{ name: inputFilename, data: file }] }, INPUT_DIR);
    if (!inputMounted) throw new Error('Could not read the file.');
    checkActive();
    const args = ffmpegArgs.map((arg, i) => ffmpegArgs[i - 1] === '-i' && arg === inputFilename ? inputPath : arg);
    started = performance.now();
    report({ stage: 'Converting' });
    onAlert('info', isRetry ? 'Converting without multi-threading'
      : fellBack ? 'Converting. Multi-threaded FFmpeg failed to start in this browser, so this will be slower.'
      : 'Converting');
    let exitCode: number;
    try {
      exitCode = await ffmpeg.exec(args);
    } catch (error) {
      // FFmpeg reports its own errors as an exit code, so a throw means the core itself crashed.
      execCrashed = true;
      throw error;
    }
    checkActive();
    if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);
    report({ stage: 'Preparing output' });
    // Copying a large output out of the worker is where memory most often runs out.
    const fileData = await withTimeout(ffmpeg, ffmpeg.readFile(outputFilename));
    checkActive();
    // readFile returned a copy, so free FFmpeg's before making a third copy for the download.
    // A large output would otherwise be held in memory three times at once.
    await withTimeout(ffmpeg, ffmpeg.deleteFile(outputFilename)).catch(() => {});
    checkActive();
    const bytes = fileData as Uint8Array;
    // Blob only accepts views of a plain ArrayBuffer. slice() copies shared memory into one.
    const blobPart = bytes.buffer instanceof ArrayBuffer ? bytes as Uint8Array<ArrayBuffer> : bytes.slice();
    const blob = new Blob([blobPart]);
    const objectURL = URL.createObjectURL(blob);
    onOutput({ url: objectURL, filename: outputFilename, size: blob.size });
    downloadFile(objectURL, outputFilename);
    onAlert('success', 'Done! The converted file should have started downloading.');
    report({ stage: 'Conversion complete' });
  } catch (error) {
    if (isActive()) {
      console.error(error);
      // ffmpeg.wasm passes errors from its worker on as plain strings.
      const message = error instanceof Error ? error.message : typeof error === 'string' ? error : undefined;
      const detail = firstError ?? message;
      if (execCrashed && !isRetry && usesThreads(ffmpeg)) {
        retry = true;
      } else if (OUT_OF_MEMORY.test(`${message} ${firstError}`)) {
        onAlert('error', `The browser ran out of memory for the converted file. ${OUT_OF_MEMORY_ADVICE}`);
      } else {
        onAlert('error', detail ? `An error occurred during conversion: ${detail}` : 'An error occurred during conversion.');
      }
      if (!retry) report({ stage: 'Conversion failed' });
    }
  } finally {
    ffmpeg.off('log', handleLog);
    ffmpeg.off('progress', handleProgress);
    // Best effort: missing files and a terminated worker are expected here.
    if (filesTouched && isActive()) await ffmpeg.deleteFile(outputFilename).catch(() => {});
    if (inputMounted && isActive()) await ffmpeg.unmount(INPUT_DIR).catch(() => {});
  }
  if (retry) return 'retry single-threaded';
};
