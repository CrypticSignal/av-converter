/**
 * FFmpeg's worker, which runs the FFmpeg core. FFmpeg.load() starts this in place of
 * ffmpeg.wasm's own worker (its classWorkerURL option; see convertFile.ts).
 *
 * It's a TypeScript copy of @ffmpeg/ffmpeg's worker (dist/esm/worker.js in version 0.12.15), so
 * it answers the same requests in the same way, with one addition: it can mount a folder whose
 * file is kept on disk, in the browser's private storage, rather than in memory (see
 * diskFileSystem.ts). FFmpeg writes its output there, so a large output doesn't have to fit in
 * memory. ffmpeg.wasm's own worker can only mount the file systems built into the core, and a
 * file there can only be opened for FFmpeg's use from inside the worker, hence our own.
 *
 * The cores' files are always given by URL here, and this runs as a module worker, so unlike
 * the original it imports the core directly rather than trying importScripts and a CDN first,
 * and doesn't guess the other files' URLs from the core's.
 */
import { createDiskFileSystem, DISK_FS, type DiskMountOptions, type EmscriptenFS, type SyncFile } from './diskFileSystem';

/** The parts of the core's Emscripten file system used here, and by the disk file system. */
interface FileSystem extends EmscriptenFS {
  readFile(path: string, options: { encoding?: string }): Uint8Array | string;
  writeFile(path: string, data: Uint8Array | string): void;
  unlink(path: string): void;
  rename(oldPath: string, newPath: string): void;
  mkdir(path: string): void;
  rmdir(path: string): void;
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  filesystems: Record<string, unknown>;
  mount(type: unknown, options: unknown, mountPoint: string): void;
  unmount(mountPoint: string): void;
}

/** A started FFmpeg core (see vendor/ffmpeg-core). */
interface Core {
  FS: FileSystem;
  ret: number;
  exec(...args: string[]): void;
  ffprobe(...args: string[]): void;
  reset(): void;
  setTimeout(timeout: number): void;
  setLogger(logger: (data: unknown) => void): void;
  setProgress(handler: (data: unknown) => void): void;
}

type CreateCore = (options: { mainScriptUrlOrBlob: string }) => Promise<Core>;

/** The worker's side of its messages. The DOM's Worker type has the same two members. */
const scope = self as unknown as Pick<Worker, 'postMessage' | 'onmessage'>;

let ffmpeg: Core | undefined;

/** Starts the core. convertFile.ts always gives every URL (the single-threaded core has no thread worker file). */
const load = async ({ coreURL, wasmURL, workerURL }: { coreURL: string; wasmURL: string; workerURL?: string }) => {
  const first = !ffmpeg;
  const createCore: CreateCore = (await import(/* @vite-ignore */ coreURL)).default;
  if (!createCore) throw new Error('failed to import ffmpeg-core.js');
  ffmpeg = await createCore({
    // As in ffmpeg.wasm: the core finds its .wasm and thread worker files from these, encoded
    // in the URL (the multi-threaded core fails to start otherwise).
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
  });
  ffmpeg.setLogger(data => scope.postMessage({ type: 'LOG', data }));
  ffmpeg.setProgress(data => scope.postMessage({ type: 'PROGRESS', data }));
  return first;
};

const run = (core: Core, command: 'exec' | 'ffprobe', { args, timeout = -1 }: { args: string[]; timeout?: number }) => {
  core.setTimeout(timeout);
  core[command](...args);
  const ret = core.ret;
  core.reset();
  return ret;
};

/**
 * The files on disk that are open for a mounted folder, by the folder's path. They stay open
 * (and locked against everything else, including the page) until the folder is unmounted.
 */
const diskFiles = new Map<string, SyncFile>();

/**
 * Mounts a folder at `mountPoint` holding one empty file, `name`, kept on disk in `folder` of
 * the browser's private storage (see diskFileSystem.ts for why and how).
 *
 * Returns false if the browser can't do this (no private storage, as in some private windows, or
 * a name it won't store). Nothing is mounted then, and the caller writes to memory instead.
 */
const mountDisk = async (fs: FileSystem, { folder, name }: DiskMountOptions, mountPoint: string) => {
  let file: SyncFile | undefined;
  try {
    // Walk down from the private storage's root, creating the folders on the way.
    let directory = await navigator.storage.getDirectory();
    for (const part of folder) directory = await directory.getDirectoryHandle(part, { create: true });
    const handle = await directory.getFileHandle(name, { create: true });
    // Synchronous access is what FFmpeg needs: its reads and writes can't wait for a promise.
    // Only a worker may open a file this way, and only one at a time.
    file = await (handle as FileSystemFileHandle & { createSyncAccessHandle(): Promise<SyncFile> }).createSyncAccessHandle();
    file.truncate(0); // Empty, in case a file of this name was left there.
    fs.mount(createDiskFileSystem(fs), { files: [{ name, file }] }, mountPoint);
  } catch (error) {
    file?.close();
    console.warn('The converted file can\'t be kept on disk here, so it will be held in memory.', error);
    return false;
  }
  diskFiles.set(mountPoint, file);
  return true;
};

/** Unmounts a folder. If its file is on disk, closes it, so the page can then read or delete it. */
const unmount = (fs: FileSystem, mountPoint: string) => {
  fs.unmount(mountPoint);
  const file = diskFiles.get(mountPoint);
  if (!file) return;
  diskFiles.delete(mountPoint);
  try {
    file.flush(); // Make sure everything written is on disk first.
  } finally {
    file.close();
  }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each request has its own data
type Request = { id: number; type: string; data: any };

const handle = async ({ type, data }: Request): Promise<unknown> => {
  if (type === 'LOAD') return load(data);
  if (!ffmpeg) throw new Error('ffmpeg is not loaded, call `await ffmpeg.load()` first');
  const fs = ffmpeg.FS;
  switch (type) {
    case 'EXEC': return run(ffmpeg, 'exec', data);
    case 'FFPROBE': return run(ffmpeg, 'ffprobe', data);
    case 'WRITE_FILE': fs.writeFile(data.path, data.data); return true;
    case 'READ_FILE': return fs.readFile(data.path, { encoding: data.encoding });
    case 'DELETE_FILE': fs.unlink(data.path); return true;
    case 'RENAME': fs.rename(data.oldPath, data.newPath); return true;
    case 'CREATE_DIR': fs.mkdir(data.path); return true;
    case 'LIST_DIR': return fs.readdir(data.path).map(name => ({
      name, isDir: fs.isDir(fs.stat(`${data.path}/${name}`).mode),
    }));
    case 'DELETE_DIR': fs.rmdir(data.path); return true;
    case 'MOUNT': {
      // Our own file system, which isn't one of the core's (see diskFileSystem.ts).
      if (data.fsType === DISK_FS) return mountDisk(fs, data.options, data.mountPoint);
      const filesystem = fs.filesystems[data.fsType];
      if (!filesystem) return false;
      fs.mount(filesystem, data.options, data.mountPoint);
      return true;
    }
    case 'UNMOUNT': unmount(fs, data.mountPoint); return true;
    default: throw new Error('unknown message type');
  }
};

scope.onmessage = async ({ data: request }: MessageEvent<Request>) => {
  let result: unknown;
  try {
    result = await handle(request);
  } catch (error) {
    // ffmpeg.wasm passes errors on as strings.
    scope.postMessage({ id: request.id, type: 'ERROR', data: String(error) });
    return;
  }
  // Move a file's bytes to the page rather than copying them.
  const transfer = result instanceof Uint8Array ? [result.buffer] : [];
  scope.postMessage({ id: request.id, type: request.type, data: result }, transfer);
};
