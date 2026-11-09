/**
 * FFmpeg's worker, which runs the FFmpeg core. FFmpeg.load() starts this in place of
 * ffmpeg.wasm's own worker (its classWorkerURL option; see convertFile.ts).
 *
 * It's a TypeScript copy of @ffmpeg/ffmpeg's worker (dist/esm/worker.js in version 0.12.15), so
 * it answers the same requests in the same way, with one addition: readFile can read part of a
 * file (see readFileRange.ts). That lets a large output be saved to disk a chunk at a time,
 * instead of being copied out of the worker whole.
 *
 * The cores are always given by URL here, and this runs as a module worker, so unlike the
 * original it imports the core directly rather than trying importScripts and a CDN first.
 */
import { parseRange } from './readFileRange';

/** The parts of the core's Emscripten file system used here. */
interface FileSystem {
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
  open(path: string, flags: string): unknown;
  read(stream: unknown, buffer: Uint8Array, offset: number, length: number, position: number): number;
  close(stream: unknown): void;
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

const load = async ({ coreURL, wasmURL, workerURL }: { coreURL: string; wasmURL?: string; workerURL?: string }) => {
  const first = !ffmpeg;
  const createCore: CreateCore = (await import(/* @vite-ignore */ coreURL)).default;
  if (!createCore) throw new Error('failed to import ffmpeg-core.js');
  ffmpeg = await createCore({
    // As in ffmpeg.wasm: the core finds its .wasm and thread worker files from these, encoded
    // in the URL (the multi-threaded core fails to start otherwise).
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({
      wasmURL: wasmURL ?? coreURL.replace(/.js$/g, '.wasm'),
      workerURL: workerURL ?? coreURL.replace(/.js$/g, '.worker.js'),
    }))}`,
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

/** Up to `length` bytes of a file from `offset`, in a buffer of their own so it can be moved. */
const readRange = (fs: FileSystem, path: string, offset: number, length: number) => {
  const stream = fs.open(path, 'r');
  try {
    const buffer = new Uint8Array(length);
    const read = fs.read(stream, buffer, 0, length, offset);
    // Only the file's last chunk is short, so this copies at most one chunk.
    return read < length ? buffer.slice(0, read) : buffer;
  } finally {
    fs.close(stream);
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
    case 'READ_FILE': {
      const range = parseRange(data.encoding);
      return range ? readRange(fs, data.path, range.offset, range.length)
        : fs.readFile(data.path, { encoding: data.encoding });
    }
    case 'DELETE_FILE': fs.unlink(data.path); return true;
    case 'RENAME': fs.rename(data.oldPath, data.newPath); return true;
    case 'CREATE_DIR': fs.mkdir(data.path); return true;
    case 'LIST_DIR': return fs.readdir(data.path).map(name => ({
      name, isDir: fs.isDir(fs.stat(`${data.path}/${name}`).mode),
    }));
    case 'DELETE_DIR': fs.rmdir(data.path); return true;
    case 'MOUNT': {
      const filesystem = fs.filesystems[data.fsType];
      if (!filesystem) return false;
      fs.mount(filesystem, data.options, data.mountPoint);
      return true;
    }
    case 'UNMOUNT': fs.unmount(data.mountPoint); return true;
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
