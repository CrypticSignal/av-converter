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
// Our own copy of ffmpeg.wasm's worker, which can also keep a file on disk (see ffmpegWorker.ts).
import ffmpegWorkerURL from './ffmpegWorker?worker&url';
import type { AlertSeverity } from '../components/Alert';
import { nonnegative, OperationProgress } from './progress';
import { downloadFile } from './downloadFile';
import { DISK_FS, type DiskMountOptions } from './diskFileSystem';
import { discardOutput, prepareOutputFolder, storedOutput } from './outputStorage';

const loads = new WeakMap<FFmpeg, Promise<void>>();
/** Instances whose load has succeeded (their promise in `loads` has resolved). */
const finishedLoads = new WeakSet<FFmpeg>();
const INPUT_DIR = '/input';
/**
 * The folder FFmpeg writes the converted file to when it's kept on disk, in the browser's
 * private storage, rather than in FFmpeg's memory (see diskFileSystem.ts and outputStorage.ts).
 */
const OUTPUT_DIR = '/output';
// FFFSType.WORKERFS; the package's runtime exports are stubbed outside browsers.
const WORKERFS = 'WORKERFS' as FFFSType;
const ERROR_PATTERN = /error|invalid|unsupported|unknown|not found|no such|could not|unable|cannot|failed/i;
// How browsers and FFmpeg's WebAssembly runtime report running out of memory.
const OUT_OF_MEMORY = /out of memory|allocation failed|Cannot enlarge memory|Aborted\(OOM\)|Invalid typed array length|Array buffer allocation/i;
// How FFmpeg reports that a write failed for lack of space: the site's storage allowance ran out
// while the converted file was being written to disk (see diskFileSystem.ts).
const STORAGE_FULL = /No space left on device/i;
/**
 * What to try after running out of memory. The converted file is only held in memory where the
 * browser can't keep it on disk (see outputStorage.ts), but FFmpeg itself can also run out.
 */
export const OUT_OF_MEMORY_ADVICE = 'Try converting a shorter part of the file (e.g. in manual mode, -t 600 converts the first 10 minutes), or closing other tabs.';

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
      await ffmpeg.load({ classWorkerURL: ffmpegWorkerURL, coreURL, wasmURL, ...(workerURL && { workerURL }) });
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
  /** The output's length in seconds when it isn't the input's (e.g. when trimmed). */
  outputDuration?: number;
  /** Turns false once the job is cancelled or the page unmounts; nothing is reported after that. */
  isActive: () => boolean;
  onAlert: (severity: AlertSeverity, message: string) => void;
  onStatus: (value: OperationProgress) => void;
  onLog: (message: string) => void;
  /**
   * Receives the converted file's object URL after its download starts, so the page can
   * offer it again. The receiver then owns the URL and must revoke it. Only called when the
   * converted file is held in memory: one kept on disk is deleted once its download has
   * started (see DELETE_DELAY_MS), so it can't be offered again.
   */
  onOutput: (output: ConvertedFile) => void;
}

export interface ConvertedFile {
  url: string;
  filename: string;
  size: number;
}

/**
 * How long the multi-threaded core may go without a log line or progress report from FFmpeg
 * before the conversion counts as hung. Threads can make it hang without any error
 * (https://github.com/ffmpegwasm/ffmpeg.wasm/issues/597). FFmpeg reports progress as frames
 * go through, and even the slowest encoder here (Cinepak, about 2 s per 720p frame) stays
 * far below this.
 */
export const STALL_TIMEOUT_MS = 120_000;

/**
 * How long after a converted file's download starts its copy on disk, in the browser's private
 * storage, is deleted. The download carries on reading the deleted file to the end.
 *
 * The browser never says when a download has started or finished, so this is a fixed wait. It
 * mustn't be too short: deleting the file before the browser has opened it cancels the
 * download. In Chromium on Linux that took a few milliseconds: of 20 downloads each, all failed
 * with no wait, 1 failed after 2 ms, and none failed from 5 ms up, even with every CPU core
 * busy, or for 2 GiB files deleted part-way through. A second leaves a wide margin, and is
 * short enough that the file is almost never left behind by a tab that's closed.
 *
 * This also relies on every download following a click on Convert. Chrome holds a tab's second
 * and later automatic downloads (ones the page starts with no recent click) behind a "Download
 * multiple files" prompt, and the file would be deleted before the user answered it. That
 * doesn't happen here: a conversion outlasts the 5 seconds for which Chrome counts a click as
 * the cause of what the page does, yet in a test of four conversions in a row in one tab, none
 * was held, so the click on Convert appears to reset Chrome's count. Anything that starts a
 * conversion without a click, such as converting several files in a row, would need this
 * reworked.
 */
export const DELETE_DELAY_MS = 1000;

/**
 * Why a conversion is tried again:
 * - 'crashed' or 'stalled': the multi-threaded core crashed (most likely by running out of
 *   memory) or stopped responding, so it's tried on the single-threaded core. Its memory can
 *   grow further, and it has no threads to hang. It's slower, but can finish where threads can't
 *   (e.g. with very large video frames, or filters that buffer a lot).
 * - 'storage-full': the site's storage allowance ran out while the converted file was being
 *   written to disk, so it's tried with the file held in memory instead. Private windows allow
 *   very little storage, for example, and the file may well still fit in memory.
 */
type RetryReason = 'crashed' | 'stalled' | 'storage-full';

export const convertFile = async (ffmpeg: FFmpeg, job: ConversionJob) => {
  // Whether to keep the converted file on disk, where the browser can. Off once that has failed.
  let onDisk = true;
  // Each reason is acted on once at most. convertOnce doesn't give the same one twice (after
  // 'crashed' or 'stalled' it no longer uses threads, and after 'storage-full' it no longer
  // writes to disk), so this only makes sure the loop can't go on forever.
  const retried = new Set<RetryReason>();
  let reason: RetryReason | undefined;
  for (;;) {
    reason = await convertOnce(ffmpeg, job, onDisk, reason) ?? undefined;
    if (!reason || retried.has(reason)) return;
    retried.add(reason);
    if (reason === 'storage-full') onDisk = false;
  }
};

/**
 * Runs the conversion once. Returns why it should be run again, if it should (the caller,
 * convertFile, decides whether it is). Otherwise the outcome has been reported through the job's
 * callbacks.
 *
 * onDisk      Keep the converted file on disk if the browser can, rather than in memory.
 * retryReason Why this is another attempt, if it is.
 */
const convertOnce = async (ffmpeg: FFmpeg, job: ConversionJob, onDisk: boolean, retryReason?: RetryReason): Promise<RetryReason | void> => {
  // Whether this attempt moves to the single-threaded core because threads failed.
  const withoutThreads = retryReason === 'crashed' || retryReason === 'stalled';
  const { file, ffmpegArgs, outputFilename, knownTimeline, outputDuration, isActive, onAlert, onStatus, onLog, onOutput } = job;
  const inputFilename = file.name;
  let retry: RetryReason | undefined;
  // Whether the multi-threaded core failed to start just now, so the single-threaded one is used.
  let fellBack = false;
  /**
   * Whether the core crashed while running the command. The multi-threaded core's memory is
   * fixed at 1 GB, and FFmpeg needing more makes it crash (ffmpeg.wasm then reports a
   * TypeError rather than running out of memory). The single-threaded core's memory can grow
   * to about 2 GB. Files, including the output, are held outside that memory.
   */
  let execCrashed = false;
  /** Whether the watchdog stopped the core because FFmpeg stopped responding. */
  let stalled = false;
  /** Whether FFmpeg said it ran out of space while writing (see STORAGE_FULL). */
  let storageFull = false;
  /** When FFmpeg last logged or reported progress (Date.now()). */
  let lastActivity = Date.now();
  let duration: number | undefined = knownTimeline ? outputDuration : undefined;
  let started: number | undefined;
  // FFmpeg's first error line is usually the root cause; later ones are consequences.
  let firstError: string | undefined;
  const report = (value: OperationProgress) => { if (isActive()) onStatus(value); };
  const checkActive = () => { if (!isActive()) throw new Error('Page unmounted'); };
  const handleLog = ({ message }: { message: string }) => {
    lastActivity = Date.now();
    if (!isActive()) return;
    onLog(message);
    if (STORAGE_FULL.test(message)) storageFull = true;
    if (firstError === undefined && message !== 'Conversion failed!' && ERROR_PATTERN.test(message)) {
      firstError = message.trim().slice(0, 300);
    }
    const match = message.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
    if (knownTimeline && outputDuration === undefined && match) {
      const seconds = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
      if (seconds > 0) duration = seconds;
    }
  };
  const handleProgress = ({ time }: { progress: number; time?: number }) => {
    lastActivity = Date.now();
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
  /**
   * The folder in the browser's private storage that holds this attempt's converted file, if
   * it's kept on disk (see outputStorage.ts). Undefined when it's held in memory.
   */
  let outputFolder: string[] | undefined;
  /** Whether OUTPUT_DIR is mounted, which keeps the file on disk open in FFmpeg's worker. */
  let outputMounted = false;
  try {
    checkActive();
    report({ stage: 'Loading FFmpeg' });
    if (retryReason === 'stalled') {
      onAlert('warning', 'Multi-threaded FFmpeg stopped responding, so trying again without multi-threading. '
        + 'This is slower.');
      onLog(`The multi-threaded core stopped responding for ${STALL_TIMEOUT_MS / 1000} seconds. `
        + 'Retrying with the single-threaded core.');
      await switchToSingleThread(ffmpeg, isActive);
    } else if (retryReason === 'crashed') {
      onAlert('warning', 'Multi-threaded FFmpeg crashed, most likely by running out of memory, so trying again '
        + 'without multi-threading. This is slower, but can use more memory.');
      onLog('The multi-threaded core crashed. Retrying with the single-threaded core.');
      await switchToSingleThread(ffmpeg, isActive);
    } else {
      if (retryReason === 'storage-full') {
        onLog('The browser\'s storage for this site filled up. Retrying with the converted file held in memory.');
      }
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
    // Have FFmpeg write the output to disk, in the browser's private storage, where it can. The
    // output then never has to fit in memory, however large it is. Our worker opens the file
    // and mounts a folder holding it (see ffmpegWorker.ts). Where the browser can't (some
    // private windows, older browsers), FFmpeg writes it to its own memory, as it always did.
    if (onDisk) outputFolder = await prepareOutputFolder();
    checkActive();
    if (outputFolder) {
      await ffmpeg.createDir(OUTPUT_DIR).catch(() => {}); // Exists after an earlier conversion.
      const options: DiskMountOptions = { folder: outputFolder, name: outputFilename };
      // ffmpeg.wasm's types only know the core's own file systems and their options, but it
      // passes both to the worker untouched.
      outputMounted = await ffmpeg.mount(DISK_FS as FFFSType, options as object, OUTPUT_DIR).catch(() => false);
      checkActive();
      // The worker couldn't open the file: delete whatever it made, and use memory.
      if (!outputMounted) {
        void discardOutput(outputFolder);
        outputFolder = undefined;
      }
    }
    // Where FFmpeg writes the output: its last argument is always the output's filename.
    const outputPath = outputFolder ? `${OUTPUT_DIR}/${outputFilename}` : outputFilename;
    const args = ffmpegArgs.map((arg, i) =>
      ffmpegArgs[i - 1] === '-i' && arg === inputFilename ? inputPath
        : i === ffmpegArgs.length - 1 ? outputPath
        : arg);
    started = performance.now();
    report({ stage: 'Converting' });
    onAlert('info', withoutThreads ? 'Converting without multi-threading'
      : fellBack ? 'Converting. Multi-threaded FFmpeg failed to start in this browser, so this will be slower.'
      : 'Converting');
    let exitCode: number;
    // Only the multi-threaded core hangs this way. The single-threaded one is slower per frame,
    // so a slow frame there is less clearly a hang, and it has no other core to fall back to.
    lastActivity = Date.now();
    const watchdog = usesThreads(ffmpeg) ? setInterval(() => {
      if (Date.now() - lastActivity < STALL_TIMEOUT_MS) return;
      stalled = true;
      ffmpeg.terminate(); // Makes the exec below fail.
    }, 1000) : undefined;
    try {
      exitCode = await ffmpeg.exec(args);
    } catch (error) {
      // FFmpeg reports its own errors as an exit code, so a throw means the core itself crashed
      // (or the watchdog stopped it).
      execCrashed = true;
      throw error;
    } finally {
      clearInterval(watchdog);
    }
    checkActive();
    if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);
    // Some of FFmpeg's writers carry on after a failed write and still exit with 0. A file that
    // didn't fit on disk is incomplete either way.
    if (storageFull && outputFolder) throw new Error('No space left on device');
    report({ stage: 'Preparing output' });
    if (outputFolder) {
      // The output is on disk. Unmounting its folder closes the file in the worker, which until
      // then is the only thing allowed to touch it.
      await withTimeout(ffmpeg, ffmpeg.unmount(OUTPUT_DIR));
      outputMounted = false;
      checkActive();
      // A File that refers to the bytes on disk. The browser copies them to the downloads
      // folder itself, so they never pass through the page's memory.
      const stored = await storedOutput(outputFolder, outputFilename);
      checkActive();
      const objectURL = URL.createObjectURL(stored);
      downloadFile(objectURL, outputFilename);
      // Delete the copy on disk once the browser has had time to open it for the download (see
      // DELETE_DELAY_MS). The timer now looks after the folder, so it's forgotten here, or the
      // clean-up at the end of this function would delete it straight away.
      const downloadingFolder = outputFolder;
      outputFolder = undefined;
      setTimeout(() => {
        URL.revokeObjectURL(objectURL);
        void discardOutput(downloadingFolder);
      }, DELETE_DELAY_MS);
      onAlert('success', 'Done! The converted file should have started downloading.');
      report({ stage: 'Conversion complete' });
      return retry;
    }
    // The output is in FFmpeg's memory, from where it's copied to the page and then into a Blob.
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
      if (execCrashed && !withoutThreads && usesThreads(ffmpeg)) {
        retry = stalled ? 'stalled' : 'crashed';
      } else if (storageFull && outputFolder) {
        // Only when the file was on disk, so the attempt in memory can't ask for another.
        retry = 'storage-full';
        onAlert('warning', 'The browser\'s storage for this site filled up, so trying again with the converted file '
          + 'held in memory.');
      } else if (OUT_OF_MEMORY.test(`${message} ${firstError}`)) {
        onAlert('error', `The browser ran out of memory. ${OUT_OF_MEMORY_ADVICE}`);
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
    // Close the file on disk, if it's still open in the worker.
    if (outputMounted && isActive()) await ffmpeg.unmount(OUTPUT_DIR).catch(() => {});
    // A failed or cancelled conversion's file is of no use: free the space now. This also runs
    // after a cancel (isActive is false then), when the stopped worker has let go of the file.
    if (outputFolder) void discardOutput(outputFolder);
  }
  return retry;
};
