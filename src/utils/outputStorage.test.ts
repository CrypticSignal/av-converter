import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A folder in the browser's private storage, with the parts of the browser's API used here. */
class FakeFolder {
  entries = new Map<string, FakeFolder | File>();
  /** How many more times removeEntry refuses, as the browser does while a file in it is open. */
  refusals = 0;

  getDirectoryHandle = async (name: string, { create = false } = {}) => {
    let entry = this.entries.get(name);
    if (!entry && create) this.entries.set(name, entry = new FakeFolder());
    if (!(entry instanceof FakeFolder)) throw new DOMException(`No folder ${name}`, 'NotFoundError');
    return entry;
  };

  getFileHandle = async (name: string) => {
    const entry = this.entries.get(name);
    if (!(entry instanceof File)) throw new DOMException(`No file ${name}`, 'NotFoundError');
    return { getFile: async () => entry };
  };

  removeEntry = async (name: string) => {
    if (!this.entries.has(name)) throw new DOMException(`No entry ${name}`, 'NotFoundError');
    if (this.refusals-- > 0) throw new DOMException('A file in it is open', 'NoModificationAllowedError');
    this.entries.delete(name);
  };

  async *keys() {
    yield* this.entries.keys();
  }

  /** Create the folders along `path` and return the last one. */
  make(...path: string[]) {
    let folder: FakeFolder = this as FakeFolder;
    for (const name of path) {
      if (!folder.entries.has(name)) folder.entries.set(name, new FakeFolder());
      folder = folder.entries.get(name) as FakeFolder;
    }
    return folder;
  }
}

/** The browser's locks: a lock stays held until the function it was requested with settles. */
class FakeLocks {
  held = new Set<string>();
  request = async (name: string, ...rest: unknown[]) => {
    const callback = rest[rest.length - 1] as (lock: object | null) => unknown;
    const ifAvailable = rest.length > 1 && (rest[0] as { ifAvailable?: boolean }).ifAvailable;
    if (this.held.has(name)) {
      if (ifAvailable) return callback(null);
      throw new Error('This fake never waits for a lock.');
    }
    this.held.add(name);
    try {
      return await callback({ name });
    } finally {
      this.held.delete(name);
    }
  };
}

let storage: FakeFolder;
let locks: FakeLocks;

/** The browser this page runs in. Either part can be left out, as in a browser that lacks it. */
const stubBrowser = ({ withStorage = true, withLocks = true, quota = 1000, usage = 100 } = {}) => {
  storage = new FakeFolder();
  locks = new FakeLocks();
  vi.stubGlobal('navigator', {
    storage: {
      getDirectory: async () => {
        if (!withStorage) throw new DOMException('Not allowed here', 'SecurityError');
        return storage;
      },
      estimate: async () => ({ quota, usage }),
    },
    locks: withLocks ? locks : undefined,
  });
};

/** A fresh copy of the module: a new tab, with its own folder name and no lock yet. */
const importFresh = async () => {
  vi.resetModules();
  return import('./outputStorage');
};

beforeEach(() => stubBrowser());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('prepareOutputFolder', () => {
  it('gives each conversion its own folder under this tab\'s, and holds the tab\'s lock', async () => {
    const { prepareOutputFolder } = await importFresh();
    const first = await prepareOutputFolder();
    const second = await prepareOutputFolder();
    expect(first).toEqual(['converted-files', expect.any(String), '1']);
    expect(second).toEqual(['converted-files', first![1], '2']);
    // The lock is named after the tab's folder, and stays held.
    expect([...locks.held]).toEqual([`converted-files/${first![1]}`]);
  });

  it('gives nothing where the browser has no private storage or no locks', async () => {
    stubBrowser({ withStorage: false });
    expect(await (await importFresh()).prepareOutputFolder()).toBeUndefined();
    stubBrowser({ withLocks: false });
    expect(await (await importFresh()).prepareOutputFolder()).toBeUndefined();
  });
});

describe('storedOutput', () => {
  it('returns the converted file from its folder', async () => {
    const { storedOutput } = await importFresh();
    const file = new File(['converted'], 'out.mp4');
    storage.make('converted-files', 'tab', '1').entries.set('out.mp4', file);
    expect(await storedOutput(['converted-files', 'tab', '1'], 'out.mp4')).toBe(file);
  });
});

describe('discardOutput', () => {
  it('deletes the conversion\'s folder', async () => {
    const { discardOutput } = await importFresh();
    storage.make('converted-files', 'tab', '1');
    await discardOutput(['converted-files', 'tab', '1']);
    expect(storage.make('converted-files', 'tab').entries.size).toBe(0);
  });

  it('tries again while FFmpeg\'s worker still has the file open', async () => {
    vi.useFakeTimers();
    const { discardOutput } = await importFresh();
    const tabFolder = storage.make('converted-files', 'tab');
    storage.make('converted-files', 'tab', '1');
    tabFolder.refusals = 2;
    const discarded = discardOutput(['converted-files', 'tab', '1']);
    await vi.runAllTimersAsync();
    await discarded;
    expect(tabFolder.entries.size).toBe(0);
  });

  it('does nothing if the folder was never made', async () => {
    const { discardOutput } = await importFresh();
    await expect(discardOutput(['converted-files', 'tab', '1'])).resolves.toBeUndefined();
  });
});

describe('removeAbandonedOutputs', () => {
  it('deletes the folders of tabs that have closed, and keeps those of open tabs', async () => {
    const { prepareOutputFolder, removeAbandonedOutputs } = await importFresh();
    const own = await prepareOutputFolder();
    storage.make(...own!);
    storage.make('converted-files', 'closed-tab', '1');
    storage.make('converted-files', 'open-tab', '1');
    // An open tab holds its lock; a closed tab's lock is free.
    locks.held.add('converted-files/open-tab');
    await removeAbandonedOutputs();
    expect([...storage.make('converted-files').entries.keys()].sort()).toEqual([own![1], 'open-tab'].sort());
  });

  it('does nothing where the browser has no private storage', async () => {
    stubBrowser({ withStorage: false });
    await expect((await importFresh()).removeAbandonedOutputs()).resolves.toBeUndefined();
  });
});

describe('freeOutputSpace', () => {
  it('is what the site may still store', async () => {
    stubBrowser({ quota: 5000, usage: 1200 });
    expect(await (await importFresh()).freeOutputSpace()).toBe(3800);
  });

  it('is unlimited when the browser reports its ceiling, however much is stored', async () => {
    const ceiling = 10 * 1024 ** 3;
    // Chrome reports the same remaining space as usage grows.
    stubBrowser({ quota: ceiling, usage: 0 });
    expect(await (await importFresh()).freeOutputSpace()).toBe(Infinity);
    stubBrowser({ quota: ceiling + 4 * 1024 ** 3, usage: 4 * 1024 ** 3 });
    expect(await (await importFresh()).freeOutputSpace()).toBe(Infinity);
    // Just under it is a real figure, so a file that doesn't fit within it is still warned about.
    stubBrowser({ quota: ceiling - 1, usage: 0 });
    expect(await (await importFresh()).freeOutputSpace()).toBe(ceiling - 1);
  });

  it('is nothing where converted files can\'t be kept on disk', async () => {
    stubBrowser({ withStorage: false });
    expect(await (await importFresh()).freeOutputSpace()).toBe(0);
    stubBrowser({ withLocks: false });
    expect(await (await importFresh()).freeOutputSpace()).toBe(0);
  });
});
