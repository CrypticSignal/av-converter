// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { convertFile, loadFFmpeg } from './convertFile';

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
  exec: vi.fn().mockResolvedValue(0),
  readFile: vi.fn().mockResolvedValue(new Uint8Array([1, 2])),
});
type Worker = ReturnType<typeof worker>;
const asFFmpeg = (w: Worker) => w as unknown as FFmpeg;
const run = (w: Worker, active = () => true) => {
  const setters = [vi.fn(), vi.fn(), vi.fn(), vi.fn()] as const;
  const promise = convertFile(asFFmpeg(w), new File(['input'], 'in.wav'),
    ['-i', 'in.wav', 'out.wav'], 'in.wav', 'out.wav', ...setters, active);
  return { promise, setters };
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
    const calls = job.setters.map(s => s.mock.calls.length);
    blob.resolve('blob:late');
    await job.promise;
    expect(w.load).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:late');
    expect(job.setters.map(s => s.mock.calls.length)).toEqual(calls);
  });
});

describe('conversion cleanup', () => {
  it('removes stale output before execution, cleans files/listeners, and revokes download URLs', async () => {
    vi.useFakeTimers();
    const w = worker();
    await run(w).promise;
    expect(w.deleteFile.mock.calls).toEqual([['out.wav'], ['in.wav'], ['out.wav']]);
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
    else if (failure === 'write') w.writeFile.mockRejectedValue(new Error('write'));
    else if (failure === 'exec') w.exec.mockRejectedValue(new Error('exec'));
    else w.readFile.mockRejectedValue(new Error('read'));
    const job = run(w);
    await job.promise;
    if (failure !== 'read') expect(w.readFile).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(w.deleteFile).toHaveBeenCalledWith('in.wav');
    expect(w.deleteFile).toHaveBeenLastCalledWith('out.wav');
    expect(w.off).toHaveBeenCalledTimes(2);
    expect(job.setters[3]).toHaveBeenLastCalledWith(false);
  });
  it('ignores late events and completion after unmount, even if cleanup fails', async () => {
    const w = worker();
    const execution = deferred<number>();
    w.exec.mockReturnValue(execution.promise);
    let active = true;
    const job = run(w, () => active);
    await vi.waitFor(() => expect(w.exec).toHaveBeenCalled());
    active = false;
    const calls = job.setters.map(s => s.mock.calls.length);
    for (const [event, callback] of w.on.mock.calls) callback(event === 'log' ? { message: 'late' } : { progress: 0.5 });
    w.deleteFile.mockRejectedValue(new Error('terminated'));
    execution.resolve(0);
    await job.promise;
    expect(job.setters.map(s => s.mock.calls.length)).toEqual(calls);
    expect(w.readFile).not.toHaveBeenCalled();
    expect(w.off).toHaveBeenCalledTimes(2);
  });
});
