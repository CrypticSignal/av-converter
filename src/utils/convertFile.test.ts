import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FFmpeg } from '@ffmpeg/ffmpeg';

// Fetching a core returns its own URL, so a test can tell which core was loaded.
const toBlobURL = vi.fn(async (url: string) => url);
vi.mock('@ffmpeg/util', () => ({ toBlobURL: (url: string) => toBlobURL(url) }));
vi.mock('./downloadFile', () => ({ downloadFile: vi.fn() }));

type Core = 'mt' | 'st';
const coreOf = (coreURL: string): Core => (/\/mt\//.test(coreURL) ? 'mt' : 'st');

/** Just enough of FFmpeg for loadFFmpeg and convertFile, recording which cores it loaded. */
class FakeFFmpeg {
  loaded = false;
  core?: Core;
  loads: Core[] = [];
  terminations = 0;
  constructor(private behaviour: {
    failToStart?: Core[];
    exec?: (core: Core) => Promise<number>;
  } = {}) {}
  load = async ({ coreURL }: { coreURL: string }) => {
    const core = coreOf(coreURL);
    this.loads.push(core);
    if (this.behaviour.failToStart?.includes(core)) throw new Error(`${core} core failed to start`);
    this.core = core;
    this.loaded = true;
    return true;
  };
  /** Rejects a pending exec, as terminating ffmpeg.wasm's worker does. */
  private rejectExec?: (error: Error) => void;
  private logListeners = new Set<(event: { message: string }) => void>();
  terminate = () => {
    this.terminations++;
    this.loaded = false;
    this.core = undefined;
    this.rejectExec?.(new Error('called FFmpeg.terminate()'));
  };
  /** An exec that never finishes by itself, like a hung core. */
  hang = () => new Promise<number>((_, reject) => { this.rejectExec = reject; });
  log = (message: string) => this.logListeners.forEach(listener => listener({ message }));
  on = (event: string, listener: (event: { message: string }) => void) => {
    if (event === 'log') this.logListeners.add(listener);
  };
  off = (event: string, listener: (event: { message: string }) => void) => {
    if (event === 'log') this.logListeners.delete(listener);
  };
  deleteFile = async () => true;
  createDir = async () => true;
  mount = async () => true;
  unmount = async () => true;
  exec = async () => (this.behaviour.exec ? this.behaviour.exec(this.core!) : 0);
  readFile = async () => new Uint8Array([1, 2, 3]);
}
const asFFmpeg = (fake: FakeFFmpeg) => fake as unknown as FFmpeg;

/** A fresh copy of the module, as its record of failed threads lasts for the page's lifetime. */
const importFresh = async () => {
  vi.resetModules();
  return import('./convertFile');
};

beforeEach(() => {
  vi.stubGlobal('crossOriginIsolated', true);
  toBlobURL.mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('loadFFmpeg', () => {
  it('uses the multi-threaded core on a cross-origin isolated page', async () => {
    const { loadFFmpeg, usesThreads, canUseThreads } = await importFresh();
    const ffmpeg = new FakeFFmpeg();
    await loadFFmpeg(asFFmpeg(ffmpeg));
    expect(ffmpeg.loads).toEqual(['mt']);
    expect(usesThreads(asFFmpeg(ffmpeg))).toBe(true);
    expect(canUseThreads()).toBe(true);
  });

  it('uses the single-threaded core without cross-origin isolation', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    const { loadFFmpeg, usesThreads } = await importFresh();
    const ffmpeg = new FakeFFmpeg();
    await loadFFmpeg(asFFmpeg(ffmpeg));
    expect(ffmpeg.loads).toEqual(['st']);
    expect(usesThreads(asFFmpeg(ffmpeg))).toBe(false);
  });

  it('falls back to the single-threaded core when the multi-threaded one fails to start, from then on', async () => {
    const { loadFFmpeg, usesThreads, canUseThreads } = await importFresh();
    const ffmpeg = new FakeFFmpeg({ failToStart: ['mt'] });
    await loadFFmpeg(asFFmpeg(ffmpeg));
    expect(ffmpeg.loads).toEqual(['mt', 'st']);
    expect(ffmpeg.terminations).toBe(1); // The failed worker is discarded first.
    expect(usesThreads(asFFmpeg(ffmpeg))).toBe(false);
    // Later instances (e.g. after a cancel) skip the multi-threaded core.
    expect(canUseThreads()).toBe(false);
    const next = new FakeFFmpeg();
    await loadFFmpeg(asFFmpeg(next));
    expect(next.loads).toEqual(['st']);
  });

  it('does not blame threads for a failed download', async () => {
    const { loadFFmpeg, canUseThreads } = await importFresh();
    toBlobURL.mockRejectedValueOnce(new Error('Failed to fetch'));
    const ffmpeg = new FakeFFmpeg();
    await expect(loadFFmpeg(asFFmpeg(ffmpeg))).rejects.toThrow('Failed to fetch');
    expect(ffmpeg.loads).toEqual([]);
    expect(canUseThreads()).toBe(true);
    // Retrying works, still with threads.
    await loadFFmpeg(asFFmpeg(ffmpeg));
    expect(ffmpeg.loads).toEqual(['mt']);
  });

  it('does not fall back when the load was cancelled', async () => {
    const { loadFFmpeg, canUseThreads } = await importFresh();
    let active = true;
    const ffmpeg = new FakeFFmpeg();
    // Cancelling terminates the worker, which fails the load in progress.
    ffmpeg.load = async () => { active = false; throw new Error('called FFmpeg.terminate()'); };
    await expect(loadFFmpeg(asFFmpeg(ffmpeg), () => active)).rejects.toThrow('terminate');
    expect(canUseThreads()).toBe(true);
  });

  it('reports an error when neither core starts', async () => {
    const { loadFFmpeg } = await importFresh();
    const ffmpeg = new FakeFFmpeg({ failToStart: ['mt', 'st'] });
    await expect(loadFFmpeg(asFFmpeg(ffmpeg))).rejects.toThrow('st core failed to start');
  });

  it('reuses a load, but loads again once the worker has been terminated', async () => {
    const { loadFFmpeg } = await importFresh();
    const ffmpeg = new FakeFFmpeg();
    await loadFFmpeg(asFFmpeg(ffmpeg));
    await loadFFmpeg(asFFmpeg(ffmpeg));
    expect(ffmpeg.loads).toEqual(['mt']);
    // E.g. the worker stopped responding and was stopped.
    ffmpeg.terminate();
    await loadFFmpeg(asFFmpeg(ffmpeg));
    expect(ffmpeg.loads).toEqual(['mt', 'mt']);
  });
});

describe('convertFile', () => {
  const run = async (ffmpeg: FakeFFmpeg) => {
    const { convertFile } = await importFresh();
    const alerts: [string, string][] = [];
    const statuses: string[] = [];
    const onOutput = vi.fn();
    await convertFile(asFFmpeg(ffmpeg), {
      file: new File(['input'], 'in.wav'),
      ffmpegArgs: ['-i', 'in.wav', 'out.mp3'],
      outputFilename: 'out.mp3',
      knownTimeline: true,
      isActive: () => true,
      onAlert: (severity, message) => alerts.push([severity, message]),
      onStatus: ({ stage }) => statuses.push(stage),
      onLog: () => {},
      onOutput,
    });
    return { alerts, statuses, onOutput };
  };
  // How ffmpeg.wasm reports the multi-threaded core running out of memory: the core throws
  // the string 'unwind', and ffmpeg.wasm then fails reading its message.
  const CRASH = "TypeError: Cannot read properties of undefined (reading 'startsWith')";
  const crashWith = (failing: Core) => async (core: Core) => {
    if (core === failing) throw CRASH;
    return 0;
  };

  it('retries single-threaded when the multi-threaded core crashes', async () => {
    const ffmpeg = new FakeFFmpeg({ exec: crashWith('mt') });
    const { alerts, statuses, onOutput } = await run(ffmpeg);
    expect(ffmpeg.loads).toEqual(['mt', 'st']);
    expect(onOutput).toHaveBeenCalledOnce();
    expect(alerts.some(([severity, message]) => severity === 'warning' && /trying again without multi-threading/.test(message))).toBe(true);
    expect(alerts.at(-1)?.[0]).toBe('success');
    expect(statuses).not.toContain('Conversion failed');
    expect(statuses.at(-1)).toBe('Conversion complete');
  });

  it('retries only once', async () => {
    const ffmpeg = new FakeFFmpeg({ exec: async () => { throw new Error('Aborted(OOM)'); } });
    const { alerts, statuses, onOutput } = await run(ffmpeg);
    expect(ffmpeg.loads).toEqual(['mt', 'st']);
    expect(onOutput).not.toHaveBeenCalled();
    expect(alerts.at(-1)).toEqual(['error', expect.stringMatching(/ran out of memory/)]);
    expect(statuses.at(-1)).toBe('Conversion failed');
  });

  it('says when the multi-threaded core failed to start', async () => {
    const ffmpeg = new FakeFFmpeg({ failToStart: ['mt'] });
    const { alerts, onOutput } = await run(ffmpeg);
    expect(onOutput).toHaveBeenCalledOnce();
    expect(alerts).toContainEqual(['info', expect.stringMatching(/failed to start in this browser/)]);
  });

  it('does not retry when already single-threaded', async () => {
    vi.stubGlobal('crossOriginIsolated', false);
    const ffmpeg = new FakeFFmpeg({ exec: async () => { throw new Error('Aborted(OOM)'); } });
    const { alerts } = await run(ffmpeg);
    expect(ffmpeg.loads).toEqual(['st']);
    expect(alerts.at(-1)).toEqual(['error', expect.stringMatching(/ran out of memory/)]);
  });

  it('does not retry running out of memory for files, which both cores hold the same way', async () => {
    const ffmpeg = new FakeFFmpeg();
    ffmpeg.readFile = async () => { throw new Error('Array buffer allocation failed'); };
    const { alerts } = await run(ffmpeg);
    expect(ffmpeg.loads).toEqual(['mt']);
    expect(alerts.at(-1)).toEqual(['error', expect.stringMatching(/ran out of memory/)]);
  });

  describe('when FFmpeg stops responding', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('stops the multi-threaded core and retries single-threaded', async () => {
      const { STALL_TIMEOUT_MS } = await importFresh();
      const ffmpeg = new FakeFFmpeg();
      ffmpeg.exec = async () => (ffmpeg.core === 'mt' ? ffmpeg.hang() : 0);
      const conversion = run(ffmpeg);
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS + 1000);
      const { alerts, statuses, onOutput } = await conversion;
      expect(ffmpeg.loads).toEqual(['mt', 'st']);
      expect(onOutput).toHaveBeenCalledOnce();
      expect(alerts).toContainEqual(['warning', expect.stringMatching(/stopped responding, so trying again without multi-threading/)]);
      expect(statuses.at(-1)).toBe('Conversion complete');
    });

    it('waits while FFmpeg keeps logging, however long the conversion takes', async () => {
      const { STALL_TIMEOUT_MS } = await importFresh();
      const ffmpeg = new FakeFFmpeg();
      let finish!: (code: number) => void;
      ffmpeg.exec = () => new Promise<number>(resolve => { finish = resolve; });
      const conversion = run(ffmpeg);
      for (let i = 0; i < 5; i++) {
        await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS - 1000);
        ffmpeg.log('frame=    1 fps=0.0 q=0.0 size=       0kB time=00:00:00.00 bitrate=N/A speed=   0x');
      }
      finish(0);
      const { statuses } = await conversion;
      expect(ffmpeg.loads).toEqual(['mt']);
      expect(ffmpeg.terminations).toBe(0);
      expect(statuses.at(-1)).toBe('Conversion complete');
    });

    it('does not stop the single-threaded core', async () => {
      vi.stubGlobal('crossOriginIsolated', false);
      const { STALL_TIMEOUT_MS } = await importFresh();
      const ffmpeg = new FakeFFmpeg();
      let finish!: (code: number) => void;
      ffmpeg.exec = () => new Promise<number>(resolve => { finish = resolve; });
      const conversion = run(ffmpeg);
      await vi.advanceTimersByTimeAsync(STALL_TIMEOUT_MS * 3);
      finish(0);
      const { statuses } = await conversion;
      expect(ffmpeg.terminations).toBe(0);
      expect(statuses.at(-1)).toBe('Conversion complete');
    });
  });

  it('does not retry errors FFmpeg reports', async () => {
    const ffmpeg = new FakeFFmpeg({ exec: async () => 1 });
    const { alerts } = await run(ffmpeg);
    expect(ffmpeg.loads).toEqual(['mt']);
    expect(alerts.at(-1)).toEqual(['error', expect.stringMatching(/exited with code 1/)]);
  });
});
