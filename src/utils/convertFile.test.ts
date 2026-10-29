// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { convertFile, loadFFmpeg, type ConversionJob } from './convertFile';

vi.mock('@ffmpeg/util', () => ({ fetchFile: vi.fn(), toBlobURL: vi.fn() }));

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
};
const worker = () => ({
  load: vi.fn().mockResolvedValue(true),
  on: vi.fn(), off: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(true),
  deleteFile: vi.fn().mockResolvedValue(true),
  createDir: vi.fn().mockResolvedValue(true),
  mount: vi.fn().mockResolvedValue(true),
  unmount: vi.fn().mockResolvedValue(true),
  exec: vi.fn().mockResolvedValue(0),
  readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2])),
});
type Worker = ReturnType<typeof worker>;
const asFFmpeg = (w: Worker) => w as unknown as FFmpeg;
const run = (w: Worker, isActive = () => true, overrides: Partial<ConversionJob> = {}) => {
  const callbacks = [vi.fn(), vi.fn(), vi.fn()] as const;
  const [onAlert, onStatus, onLog] = callbacks;
  const promise = convertFile(asFFmpeg(w), {
    file: new File(['input'], 'in.wav'), ffmpegArgs: ['-i', 'in.wav', 'out.wav'], outputFilename: 'out.wav',
    knownTimeline: true, isActive, onAlert, onStatus, onLog, ...overrides,
  });
  return { promise, callbacks };
};

beforeEach(() => {
  vi.mocked(toBlobURL).mockImplementation(async url => `blob:${url}`);
  vi.mocked(fetchFile).mockResolvedValue(new Uint8Array([3]));
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:download') });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); vi.useRealTimers(); });

describe('FFmpeg loading', () => {
  it('shares concurrent loading, caches success, and loads separate instances', async () => {
    const w = worker();
    const first = loadFFmpeg(asFFmpeg(w));
    expect(loadFFmpeg(asFFmpeg(w))).toBe(first);
    await first;
    await loadFFmpeg(asFFmpeg(w));
    expect(w.load).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
    const other = worker();
    await loadFFmpeg(asFFmpeg(other));
    expect(other.load).toHaveBeenCalledTimes(1);
  });
  it('revokes partial URLs and permits retry after failure', async () => {
    const w = worker();
    vi.mocked(toBlobURL).mockResolvedValueOnce('blob:first').mockRejectedValueOnce(new Error('fetch failed'));
    await expect(loadFFmpeg(asFFmpeg(w))).rejects.toThrow('fetch failed');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
    await loadFFmpeg(asFFmpeg(w));
    expect(w.load).toHaveBeenCalledTimes(1);
  });
  it('revokes all URLs on load failure', async () => {
    const w = worker();
    w.load.mockRejectedValueOnce(new Error('load failed'));
    await expect(loadFFmpeg(asFFmpeg(w))).rejects.toThrow('load failed');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
  });
  it('does not start a worker after unmount during blob fetching', async () => {
    const w = worker();
    const blob = deferred<string>();
    vi.mocked(toBlobURL).mockReturnValueOnce(blob.promise);
    let active = true;
    const job = run(w, () => active);
    active = false;
    const calls = job.callbacks.map(s => s.mock.calls.length);
    blob.resolve('blob:late');
    await job.promise;
    expect(w.load).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late');
    expect(job.callbacks.map(s => s.mock.calls.length)).toEqual(calls);
  });
});

describe('conversion cleanup', () => {
  it('does not finish a new session when cancellation occurs during filesystem cleanup', async () => {
    const old = worker();
    const cleaning = deferred<boolean>();
    old.unmount.mockReturnValueOnce(cleaning.promise);
    let active = true;
    const first = run(old, () => active);
    await vi.waitFor(() => expect(old.unmount).toHaveBeenCalledWith('/input'));
    active = false;
    const next = worker();
    const running = deferred<number>();
    next.exec.mockReturnValue(running.promise);
    const second = run(next);
    await vi.waitFor(() => expect(next.exec).toHaveBeenCalled());
    const calls = second.callbacks.map(s => s.mock.calls.length);
    cleaning.resolve(true);
    await first.promise;
    expect(old.deleteFile.mock.calls).toEqual([['out.wav'], ['out.wav']]);
    expect(second.callbacks.map(s => s.mock.calls.length)).toEqual(calls);
    running.resolve(0);
    await second.promise;
  });

  it.each(['load', 'mount', 'fetch', 'write', 'exec', 'read'])('suppresses completion and cleanup writes after cancellation during %s', async phase => {
    const w = worker();
    const pending = deferred<any>();
    if (phase === 'fetch' || phase === 'write') w.mount.mockResolvedValue(false);
    if (phase === 'load') w.load.mockReturnValue(pending.promise);
    if (phase === 'mount') w.mount.mockReturnValue(pending.promise);
    if (phase === 'fetch') vi.mocked(fetchFile).mockReturnValueOnce(pending.promise);
    if (phase === 'write') w.writeFile.mockReturnValue(pending.promise);
    if (phase === 'exec') w.exec.mockReturnValue(pending.promise);
    if (phase === 'read') w.readFile.mockReturnValue(pending.promise);
    let active = true;
    const job = run(w, () => active);
    const target = phase === 'load' ? w.load : phase === 'mount' ? w.mount : phase === 'fetch' ? fetchFile : phase === 'write' ? w.writeFile : phase === 'exec' ? w.exec : w.readFile;
    await vi.waitFor(() => expect(target).toHaveBeenCalled());
    active = false;
    const setterCalls = job.callbacks.map(s => s.mock.calls.length);
    const deleteCalls = w.deleteFile.mock.calls.length;
    pending.resolve(phase === 'read' || phase === 'fetch' ? new Uint8Array([1]) : phase === 'mount' ? true : 0);
    await job.promise;
    expect(job.callbacks.map(s => s.mock.calls.length)).toEqual(setterCalls);
    expect(w.deleteFile).toHaveBeenCalledTimes(deleteCalls);
    expect(w.unmount).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it('keeps a restarted worker isolated from an old execution finalizer', async () => {
    const old = worker();
    const execution = deferred<number>();
    old.exec.mockReturnValue(execution.promise);
    let active = true;
    const first = run(old, () => active);
    await vi.waitFor(() => expect(old.exec).toHaveBeenCalled());
    active = false;
    const next = worker();
    const nextExecution = deferred<number>();
    next.exec.mockReturnValue(nextExecution.promise);
    const second = run(next);
    await vi.waitFor(() => expect(next.exec).toHaveBeenCalled());
    const calls = second.callbacks.map(s => s.mock.calls.length);
    execution.resolve(0);
    await first.promise;
    expect(next.deleteFile.mock.calls).toEqual([['out.wav']]);
    expect(second.callbacks.map(s => s.mock.calls.length)).toEqual(calls);
    nextExecution.resolve(0);
    await second.promise;
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });

  it.each([true, false])('reports processed time, observed speed and only a usable timeline ETA (%s)', async knownTimeline => {
    const w = worker();
    const execution = deferred<number>();
    w.exec.mockReturnValue(execution.promise);
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const { promise, callbacks: [, status, log] } = run(w, () => true, { knownTimeline });
    await vi.waitFor(() => expect(w.exec).toHaveBeenCalled());
    const onLog = w.on.mock.calls.find(call => call[0] === 'log')![1];
    const onProgress = w.on.mock.calls.find(call => call[0] === 'progress')![1];
    onLog({ message: 'Duration: 00:01:40.00, start: 0' });
    vi.mocked(performance.now).mockReturnValue(6000);
    onProgress({ progress: 0.99, time: 25_000_000 });
    expect(status).toHaveBeenLastCalledWith(expect.objectContaining({
      stage: 'Converting', elapsed: 5, speed: '5.00x',
      percent: knownTimeline ? 25 : undefined, eta: knownTimeline ? 15 : undefined,
    }));
    onProgress({ progress: NaN, time: Infinity });
    expect(status.mock.calls.at(-1)![0].percent).toBeUndefined();
    expect(status.mock.calls.at(-1)![0].speed).toBeUndefined();
    expect(log).toHaveBeenCalledOnce();
    execution.resolve(0);
    await promise;
    expect(status.mock.calls.map(call => call[0].stage)).toEqual(expect.arrayContaining(['Loading FFmpeg', 'Preparing output', 'Conversion complete']));
  });

  it('removes stale output before execution, cleans files/listeners, and revokes download URLs', async () => {
    vi.useFakeTimers();
    const w = worker();
    await run(w).promise;
    expect(w.mount).toHaveBeenCalledWith('WORKERFS', { blobs: [{ name: 'in.wav', data: expect.any(File) }] }, '/input');
    expect(w.exec).toHaveBeenCalledWith(['-i', '/input/in.wav', 'out.wav']);
    expect(w.writeFile).not.toHaveBeenCalled();
    expect(fetchFile).not.toHaveBeenCalled();
    expect(w.deleteFile.mock.calls).toEqual([['out.wav'], ['out.wav']]);
    expect(w.unmount).toHaveBeenCalledWith('/input');
    expect(w.deleteFile.mock.invocationCallOrder[0]).toBeLessThan(w.exec.mock.invocationCallOrder[0]);
    for (const [event, callback] of w.on.mock.calls) expect(w.off).toHaveBeenCalledWith(event, callback);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:download');
    await run(w).promise;
    expect(w.load).toHaveBeenCalledTimes(1);
  });
  it.each(['exit', 'write', 'exec', 'read'])('cleans up on %s failure without downloading', async failure => {
    const w = worker();
    if (failure === 'exit') w.exec.mockResolvedValue(1);
    else if (failure === 'write') {
      w.mount.mockResolvedValue(false);
      w.writeFile.mockRejectedValue(new Error('write'));
    }
    else if (failure === 'exec') w.exec.mockRejectedValue(new Error('exec'));
    else w.readFile.mockRejectedValue(new Error('read'));
    const job = run(w);
    await job.promise;
    if (failure !== 'read') expect(w.readFile).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    if (failure === 'write') {
      expect(w.deleteFile.mock.calls).toEqual([['out.wav'], ['out.wav'], ['/input/in.wav']]);
      expect(w.unmount).not.toHaveBeenCalled();
    } else {
      expect(w.deleteFile.mock.calls).toEqual([['out.wav'], ['out.wav']]);
      expect(w.unmount).toHaveBeenCalledWith('/input');
    }
    expect(w.off).toHaveBeenCalledTimes(2);
    expect(job.callbacks[0]).toHaveBeenLastCalledWith('error', expect.stringContaining('An error occurred'));
  });
  it('ignores late events and completion after unmount, even if cleanup fails', async () => {
    const w = worker();
    const execution = deferred<number>();
    w.exec.mockReturnValue(execution.promise);
    let active = true;
    const job = run(w, () => active);
    await vi.waitFor(() => expect(w.exec).toHaveBeenCalled());
    active = false;
    const calls = job.callbacks.map(s => s.mock.calls.length);
    for (const [event, callback] of w.on.mock.calls) callback(event === 'log' ? { message: 'late' } : { progress: 0.5 });
    w.deleteFile.mockRejectedValue(new Error('terminated'));
    execution.resolve(0);
    await job.promise;
    expect(job.callbacks.map(s => s.mock.calls.length)).toEqual(calls);
    expect(w.readFile).not.toHaveBeenCalled();
    expect(w.off).toHaveBeenCalledTimes(2);
  });
});

describe('input mounting', () => {
  it('copies the input into memory when the core cannot mount it', async () => {
    const w = worker();
    w.mount.mockResolvedValue(false);
    await run(w).promise;
    expect(w.writeFile).toHaveBeenCalledWith('/input/in.wav', new Uint8Array([3]));
    expect(w.exec).toHaveBeenCalledWith(['-i', '/input/in.wav', 'out.wav']);
    expect(w.deleteFile.mock.calls).toEqual([['out.wav'], ['out.wav'], ['/input/in.wav']]);
    expect(w.unmount).not.toHaveBeenCalled();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  });
});

it('only redirects -i inputs, so an output may reuse the input name', async () => {
  const w = worker();
  await run(w, () => true, {
    file: new File(['input'], 'clip.mp4'), ffmpegArgs: ['-i', 'clip.mp4', '-c:V', 'copy', 'clip.mp4'], outputFilename: 'clip.mp4',
  }).promise;
  expect(w.exec).toHaveBeenCalledWith(['-i', '/input/clip.mp4', '-c:V', 'copy', 'clip.mp4']);
  expect(w.readFile).toHaveBeenCalledWith('clip.mp4');
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
});

describe('error reporting', () => {
  const failWith = async (lines: string[], exitCode = 1) => {
    const w = worker();
    w.exec.mockImplementation(async () => {
      const onLog = w.on.mock.calls.find(call => call[0] === 'log')![1];
      lines.forEach(message => onLog({ message }));
      return exitCode;
    });
    const job = run(w);
    await job.promise;
    return job.callbacks[0].mock.calls.at(-1)![1];
  };

  it('shows the first FFmpeg error line rather than its consequences', async () => {
    expect(await failWith([
      'Input #0, wav, from \'in.wav\':',
      '[libopus @ 0x1] The bit rate 320000 bps is unsupported. Please choose a value between 500 and 256000.',
      '[aost#0:0/libopus @ 0x2] Error while opening encoder - maybe incorrect parameters',
      'Conversion failed!',
    ])).toBe('An error occurred during conversion: [libopus @ 0x1] The bit rate 320000 bps is unsupported. Please choose a value between 500 and 256000.');
  });

  it('falls back to the exit code or thrown error when FFmpeg logged no error', async () => {
    expect(await failWith(['Conversion failed!'])).toBe('An error occurred during conversion: FFmpeg exited with code 1');
    const w = worker();
    w.mount.mockResolvedValue(false);
    w.writeFile.mockRejectedValue(new Error('Out of memory'));
    const job = run(w);
    await job.promise;
    expect(job.callbacks[0]).toHaveBeenLastCalledWith('error', 'An error occurred during conversion: Out of memory');
  });
});
