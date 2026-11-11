/**
 * The page's side of keeping converted files on disk rather than in memory: where they go in the
 * browser's private storage for this site, reading one back to download it, and clearing up.
 *
 * The private storage (the "origin private file system", or OPFS) is a folder the browser keeps
 * on disk for each site. Only this site can read it, the visitor never sees it among their own
 * files, and it needs no permission. FFmpeg writes the converted file there (see
 * diskFileSystem.ts), and the page then hands it to the browser to download, which copies it to
 * the visitor's downloads folder without loading it into memory.
 *
 * Layout: <storage>/converted-files/<tab>/<conversion number>/<output filename>
 * - Each tab has its own folder, so two tabs converting at once can't touch each other's files.
 * - Each conversion has its own folder within it, so discarding a cancelled conversion's file
 *   can't delete the next conversion's, even one with the same name.
 *
 * Clearing up: a converted file is deleted a second after its download starts (convertFile.ts
 * does that, and explains why it's safe), and straight away if the conversion fails or is
 * cancelled (discardOutput). Nothing can be relied on to run when a tab closes or crashes,
 * though, so whatever a closed tab left behind is deleted the next time the site is opened
 * (removeAbandonedOutputs). To tell a closed tab from an open one, each tab holds a lock named
 * after its folder (the Web Locks API) for as long as it's open: the browser releases it when
 * the tab goes away, however that happens.
 */

/** The folder in the private storage that holds every tab's folder. */
const ROOT = 'converted-files';

/** This tab's folder name: random, so no two tabs share one. */
const tab = typeof crypto.randomUUID === 'function'
  ? crypto.randomUUID()
  // randomUUID only exists on secure (HTTPS or localhost) pages.
  : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** The name of the lock a tab holds while it's open. */
const lockName = (tabFolder: string) => `${ROOT}/${tabFolder}`;

/** Numbers this tab's conversions, for their folder names. */
let conversions = 0;

/** Follows `path` (folder names, from the private storage's root) to its folder. Throws if one is missing. */
const folderAt = async (path: string[]) => {
  let folder = await navigator.storage.getDirectory();
  for (const name of path) folder = await folder.getDirectoryHandle(name);
  return folder;
};

let tabLock: Promise<boolean> | undefined;

/**
 * Takes this tab's lock, once, and keeps it until the tab goes away. Resolves once it's held, or
 * with false if the browser has no locks, in which case the private storage isn't used (other
 * tabs couldn't tell this tab's files are in use).
 */
const holdTabLock = () => tabLock ??= new Promise<boolean>(resolve => {
  if (!navigator.locks) {
    resolve(false);
    return;
  }
  navigator.locks.request(lockName(tab), () => {
    resolve(true);
    // The lock is held until this promise settles, which it never does.
    return new Promise<never>(() => {});
  }).catch(() => resolve(false));
});

/**
 * Gets ready to keep a conversion's output on disk: returns the folder for it, as a path from
 * the private storage's root. FFmpeg's worker creates the folder and the file in it (see
 * ffmpegWorker.ts).
 *
 * Returns undefined if the browser can't do this (no private storage, as in some private
 * windows, or no locks). The output is then held in memory instead.
 */
export const prepareOutputFolder = async (): Promise<string[] | undefined> => {
  try {
    // Hold the lock before the folder exists, so another tab can't take it for an abandoned one.
    if (!await holdTabLock()) return undefined;
    await navigator.storage.getDirectory(); // Throws where the private storage is unavailable.
    return [ROOT, tab, String(++conversions)];
  } catch {
    return undefined;
  }
};

/**
 * The converted file `name` in `folder` (from prepareOutputFolder), once FFmpeg has finished and
 * its worker has closed it. The File refers to the bytes on disk; it doesn't load them.
 */
export const storedOutput = async (folder: string[], name: string): Promise<File> =>
  (await (await folderAt(folder)).getFileHandle(name)).getFile();

/**
 * Deletes a conversion's folder (from prepareOutputFolder) and the file in it: once its
 * download has started, or after a conversion that failed or was cancelled. The browser refuses
 * while FFmpeg's worker still has the file open, and a cancelled worker takes a moment to let
 * go (about two seconds in Chromium), so this keeps trying for ten. If it still can't, the file
 * goes the next time the site is opened, after this tab has closed.
 */
export const discardOutput = async (folder: string[]) => {
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      const parent = await folderAt(folder.slice(0, -1));
      await parent.removeEntry(folder[folder.length - 1], { recursive: true });
      return;
    } catch (error) {
      // Already gone (or never created): nothing to delete.
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
};

/**
 * Deletes the files left by tabs that have since closed or crashed. Called when the page opens.
 * A tab's folder is abandoned if its lock is free; the lock is held while deleting, so nothing
 * else acts on the folder meanwhile.
 */
export const removeAbandonedOutputs = async () => {
  try {
    if (!navigator.locks) return;
    // The folder holding every tab's folder. A missing one means nothing was ever converted here.
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(ROOT);
    const tabFolders: string[] = [];
    // The folder is listed first, as it can't be changed while it's being listed.
    for await (const name of (root as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> }).keys()) tabFolders.push(name);
    for (const name of tabFolders) {
      if (name === tab) continue;
      // ifAvailable: don't wait for the lock. `lock` is null if an open tab holds it.
      await navigator.locks.request(lockName(name), { ifAvailable: true }, async lock => {
        if (lock) await root.removeEntry(name, { recursive: true }).catch(() => {});
      });
    }
  } catch {
    // No private storage here, or nothing in it, so there's nothing to clear.
  }
};

/**
 * The most remaining storage that browsers report for a site, in bytes. Chrome always reports
 * exactly this much for a normal profile, however much the disk has free (a site stored 12 GiB
 * with 28 GiB free), and Firefox limits a site to this much, so that sites can't tell how large
 * a visitor's disk is. A reading at this figure therefore only means "at least this much".
 */
const REPORTED_SPACE_CEILING = 10 * 1024 ** 3;

/**
 * How many bytes this site may still store: 0 if converted files can't be kept on disk here, or
 * Infinity if the browser says only that it's at least REPORTED_SPACE_CEILING, which no file
 * can be told to exceed. Otherwise the browser's figure, which is an estimate. Used to warn about
 * a file too large for memory only when it wouldn't fit on disk either.
 */
export const freeOutputSpace = async (): Promise<number> => {
  try {
    if (!navigator.locks) return 0;
    await navigator.storage.getDirectory(); // Throws where the private storage is unavailable.
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    const remaining = Math.max(0, quota - usage);
    return remaining >= REPORTED_SPACE_CEILING ? Infinity : remaining;
  } catch {
    return 0;
  }
};
