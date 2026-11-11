/**
 * A file system for the FFmpeg core that keeps its files on disk, in the browser's private storage
 * for this site (the "origin private file system", or OPFS), rather than in memory.
 *
 * Why it exists: FFmpeg's own file system (Emscripten's MEMFS) holds every file it writes in
 * memory, so a converted file had to fit in memory, several times over at the peak. Mounted
 * where FFmpeg writes its output, this file system passes each read and write straight to a file
 * on disk instead, so the output's size no longer matters to memory.
 *
 * How it fits together:
 * 1. The page asks FFmpeg's worker to mount this file system at a folder (convertFile.ts), naming
 *    the output file and the folder in the private storage to keep it in (outputStorage.ts).
 * 2. The worker (ffmpegWorker.ts) opens that file for synchronous access, which only a worker can
 *    do, and mounts this file system with it. Opening is asynchronous, but FFmpeg's reads and
 *    writes can't wait, which is why the file is opened before FFmpeg runs, not when FFmpeg asks.
 * 3. FFmpeg writes its output there like any other file.
 * 4. The page unmounts the folder, which closes the file, and reads it from the private storage.
 *
 * This is the only code here that talks to Emscripten's file system layer. A file system for it
 * is an object with a mount() that returns the root folder's node, and each node carries the
 * functions Emscripten calls for it: `node_ops` (about the file itself: its size, its folder's
 * entries) and `stream_ops` (about an open file: read, write, seek).
 */

/**
 * The name the page mounts this file system by, in place of one of Emscripten's own ('MEMFS',
 * 'WORKERFS'...): ffmpeg.mount(DISK_FS, options, folder). The worker recognises it.
 */
export const DISK_FS = 'OPFS';

/** What the page passes to ffmpeg.mount() with DISK_FS. */
export interface DiskMountOptions {
  /** The folder in the private storage to keep the file in, as a path from its root. Created if missing. */
  folder: string[];
  /** The file's name, both in that folder and in the folder FFmpeg sees. */
  name: string;
}

/**
 * A file in the private storage, opened for synchronous reads and writes (the browser's
 * FileSystemSyncAccessHandle; only the parts used here). `at` is the position in the file.
 */
export interface SyncFile {
  read(buffer: ArrayBufferView, options: { at: number }): number;
  write(buffer: ArrayBufferView, options: { at: number }): number;
  truncate(size: number): void;
  getSize(): number;
  flush(): void;
  close(): void;
}

/** A file or folder in Emscripten's file system. */
export interface FsNode {
  id: number;
  mode: number;
  timestamp: number;
  node_ops: object;
  stream_ops: object;
  /** A folder's entries, by name. */
  contents?: Record<string, FsNode>;
  /** A file's contents, on disk. */
  file?: SyncFile;
}

/** An open file: its node and where the next read or write goes. */
interface FsStream {
  node: FsNode;
  position: number;
}

/** The parts of Emscripten's file system layer (the core's `FS`) that a file system needs. */
export interface EmscriptenFS {
  /** Makes a node and registers it under its parent, so paths resolve to it. */
  createNode(parent: FsNode | null, name: string, mode: number, dev: number): FsNode;
  /** What a failed operation throws: Emscripten turns it into the error code FFmpeg sees. */
  ErrnoError: new (errno: number) => Error;
}

// Error codes, as numbered by the core's C library (WASI's numbering, which Emscripten uses).
const EINVAL = 28; // Invalid argument.
const EIO = 29; // Input/output error.
const ENOENT = 44; // No such file or directory.
const ENOSPC = 51; // No space left on device.

// File types and permissions, as in Unix: a folder and a regular file, open to all.
const FOLDER_MODE = 0o40777;
const FILE_MODE = 0o100666;

/** Bytes copied at a time when the browser won't read or write FFmpeg's memory directly. */
const COPY_BYTES = 1024 ** 2;

/**
 * Makes the file system for one core. Mount it with `{ files }`: the files it holds, already
 * open. FFmpeg can read, write, seek in and truncate them, but not add, rename or delete files,
 * as a new file couldn't be opened in time (see the top of this file).
 */
export const createDiskFileSystem = (fs: EmscriptenFS) => {
  /**
   * Runs one operation on a file on disk. Emscripten only understands its own errors, so
   * anything the browser throws is turned into one: "no space left" when the site's storage
   * allowance is used up (which FFmpeg then reports, and convertFile.ts looks for), or a
   * general I/O error.
   */
  const onDisk = <T>(operation: () => T): T => {
    try {
      return operation();
    } catch (error) {
      const full = error instanceof DOMException && error.name === 'QuotaExceededError';
      throw new fs.ErrnoError(full ? ENOSPC : EIO);
    }
  };

  /**
   * Whether the browser refused to read or write FFmpeg's memory directly. The multi-threaded
   * core's memory is shared between its threads, and a browser may not accept shared memory
   * here. Once one call fails this way, the bytes go through a buffer of our own instead.
   */
  let copyShared = false;
  let copyBuffer: Uint8Array | undefined;

  /**
   * Reads or writes `length` bytes at `position` in the file, to or from `buffer` at `offset`
   * (FFmpeg's memory, whichever array type Emscripten passes), and returns how many were moved.
   */
  const transfer = (file: SyncFile, direction: 'read' | 'write', buffer: ArrayBufferView, offset: number, length: number, position: number) => {
    // The same bytes as a plain byte array, without copying them.
    const bytes = new Uint8Array(buffer.buffer, buffer.byteOffset + offset, length);
    const shared = !(buffer.buffer instanceof ArrayBuffer);
    if (!shared || !copyShared) {
      try {
        return file[direction](bytes, { at: position });
      } catch (error) {
        // A TypeError means the browser won't take shared memory; anything else is a real failure.
        if (!shared || !(error instanceof TypeError)) throw error;
        copyShared = true;
      }
    }
    // Go through a buffer that isn't shared, a piece at a time.
    copyBuffer ??= new Uint8Array(COPY_BYTES);
    let moved = 0;
    while (moved < length) {
      const piece = copyBuffer.subarray(0, Math.min(COPY_BYTES, length - moved));
      if (direction === 'write') piece.set(bytes.subarray(moved, moved + piece.length));
      const count = file[direction](piece, { at: position + moved });
      if (direction === 'read') bytes.set(piece.subarray(0, count), moved);
      moved += count;
      // Fewer bytes than asked for: the end of the file when reading, or a partial write.
      if (count < piece.length) break;
    }
    return moved;
  };

  /** What a program sees when it asks about a file or folder (stat). */
  const attributes = (node: FsNode, size: number) => {
    const time = new Date(node.timestamp);
    return {
      dev: 1, ino: node.id, mode: node.mode, nlink: 1, uid: 0, gid: 0, rdev: 0,
      size, atime: time, mtime: time, ctime: time, blksize: 4096, blocks: Math.ceil(size / 4096),
    };
  };

  /** Called by Emscripten for a change to a file's attributes: its time, or its length. */
  const setAttributes = (node: FsNode, { size, timestamp }: { size?: number; timestamp?: number }) => {
    if (timestamp !== undefined) node.timestamp = timestamp;
    // Opening a file for writing truncates it to nothing this way.
    if (size !== undefined) onDisk(() => node.file!.truncate(size));
  };

  /**
   * The folder can't be changed: its files are fixed when it's mounted. That needs no code:
   * Emscripten refuses to add, rename or delete an entry ("operation not permitted") in a
   * folder that has no function for it.
   */
  const folderOps = {
    getattr: (node: FsNode) => attributes(node, 4096),
    // Emscripten finds the folder's files itself (createNode registered them), and only asks
    // here about a name it doesn't know.
    lookup: () => { throw new fs.ErrnoError(ENOENT); },
    readdir: (node: FsNode) => ['.', '..', ...Object.keys(node.contents ?? {})],
  };

  const fileOps = {
    getattr: (node: FsNode) => attributes(node, onDisk(() => node.file!.getSize())),
    setattr: setAttributes,
  };

  /** Reads, writes and seeks in an open file. `position` is where in the file, kept by Emscripten. */
  const fileStreamOps = {
    read: (stream: FsStream, buffer: ArrayBufferView, offset: number, length: number, position: number) =>
      onDisk(() => transfer(stream.node.file!, 'read', buffer, offset, length, position)),
    write: (stream: FsStream, buffer: ArrayBufferView, offset: number, length: number, position: number) => {
      const written = onDisk(() => transfer(stream.node.file!, 'write', buffer, offset, length, position));
      stream.node.timestamp = Date.now();
      return written;
    },
    /** The new position for a seek: from the start (0), the current position (1) or the end (2). */
    llseek: (stream: FsStream, offset: number, whence: number) => {
      let position = offset;
      if (whence === 1) position += stream.position;
      else if (whence === 2) position += onDisk(() => stream.node.file!.getSize());
      if (position < 0) throw new fs.ErrnoError(EINVAL);
      return position;
    },
  };

  return {
    /** Called by Emscripten's FS.mount(). Builds the folder and returns its node. */
    mount: ({ opts }: { opts: { files: { name: string; file: SyncFile }[] } }) => {
      const root = fs.createNode(null, '/', FOLDER_MODE, 0);
      root.node_ops = folderOps;
      root.stream_ops = {};
      root.contents = {};
      root.timestamp = Date.now();
      for (const { name, file } of opts.files) {
        const node = fs.createNode(root, name, FILE_MODE, 0);
        node.node_ops = fileOps;
        node.stream_ops = fileStreamOps;
        node.timestamp = Date.now();
        node.file = file;
        root.contents[name] = node;
      }
      return root;
    },
  };
};
