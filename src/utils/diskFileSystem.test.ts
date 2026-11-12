import { describe, expect, it } from 'vitest';
import { createDiskFileSystem, type EmscriptenFS, type FsNode, type SyncFile } from './diskFileSystem';

/** What Emscripten throws for a failed operation: its number is the error code FFmpeg sees. */
class ErrnoError extends Error {
  constructor(public errno: number) { super(`errno ${errno}`); }
}

/** Just enough of Emscripten's file system layer to make nodes. */
const fakeFS = (): EmscriptenFS => {
  let nextId = 1;
  return {
    createNode: (_parent, _name, mode) => ({ id: nextId++, mode, timestamp: 0, node_ops: {}, stream_ops: {} }),
    ErrnoError,
  };
};

/**
 * A file on disk, held in an array, behaving like the browser's synchronous access to a file.
 *
 * rejectShared Refuse shared memory with a TypeError, as a browser might.
 * quota        The most bytes it holds: a write past that fails as a full disk does.
 */
const fakeFile = ({ rejectShared = false, quota = Infinity } = {}) => {
  let bytes = new Uint8Array(0);
  const view = (buffer: ArrayBufferView) => {
    if (rejectShared && !(buffer.buffer instanceof ArrayBuffer)) throw new TypeError('Shared memory is not allowed');
    return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  };
  const file: SyncFile & { contents(): number[] } = {
    contents: () => [...bytes],
    read: (buffer, { at }) => {
      const target = view(buffer);
      const chunk = bytes.subarray(at, at + target.length);
      target.set(chunk);
      return chunk.length;
    },
    write: (buffer, { at }) => {
      const source = view(buffer);
      if (at + source.length > quota) throw new DOMException('The quota has been exceeded', 'QuotaExceededError');
      if (at + source.length > bytes.length) {
        const grown = new Uint8Array(at + source.length);
        grown.set(bytes);
        bytes = grown;
      }
      bytes.set(source, at);
      return source.length;
    },
    truncate: size => {
      const resized = new Uint8Array(size);
      resized.set(bytes.subarray(0, size));
      bytes = resized;
    },
    getSize: () => bytes.length,
    flush: () => {},
    close: () => {},
  };
  return file;
};

/** The operations Emscripten calls on a file's node and on an open file. */
type FileOps = {
  getattr(node: FsNode): { size: number; mode: number };
  setattr(node: FsNode, attributes: { size?: number; timestamp?: number }): void;
};
type StreamOps = {
  read(stream: object, buffer: ArrayBufferView, offset: number, length: number, position: number): number;
  write(stream: object, buffer: ArrayBufferView, offset: number, length: number, position: number): number;
  llseek(stream: object, offset: number, whence: number): number;
};
type FolderOps = {
  lookup(parent: FsNode, name: string): never;
  readdir(node: FsNode): string[];
  mknod?: unknown;
  unlink?: unknown;
};

/** Mount a folder holding `file` as out.mp4, and return what Emscripten would use to reach it. */
const mounted = (file: SyncFile) => {
  const root = createDiskFileSystem(fakeFS()).mount({ opts: { files: [{ name: 'out.mp4', file }] } });
  const node = root.contents!['out.mp4'];
  return {
    root,
    node,
    folderOps: root.node_ops as FolderOps,
    fileOps: node.node_ops as FileOps,
    streamOps: node.stream_ops as StreamOps,
    /** The file, open at `position`. */
    stream: (position = 0) => ({ node, position }),
  };
};

/** The error code an operation fails with. */
const errnoOf = (operation: () => unknown) => {
  try {
    operation();
  } catch (error) {
    return (error as ErrnoError).errno;
  }
  return undefined;
};

describe('the disk file system', () => {
  it('lists the mounted file, and nothing else can be found or made', () => {
    const { root, folderOps } = mounted(fakeFile());
    expect(folderOps.readdir(root)).toEqual(['.', '..', 'out.mp4']);
    expect(errnoOf(() => folderOps.lookup(root, 'other.mp4'))).toBe(44); // No such file.
    // With no function to add or delete an entry, Emscripten refuses to.
    expect(folderOps.mknod).toBeUndefined();
    expect(folderOps.unlink).toBeUndefined();
  });

  it('writes to and reads from the file on disk, at the position given', () => {
    const file = fakeFile();
    const { streamOps, stream } = mounted(file);
    // FFmpeg's memory, with the bytes to write somewhere inside it.
    const memory = new Uint8Array([0, 0, 1, 2, 3, 4, 0]);
    expect(streamOps.write(stream(), memory, 2, 4, 0)).toBe(4);
    // Writing past the end leaves a gap of zeros, as on any file system.
    expect(streamOps.write(stream(), memory, 2, 2, 6)).toBe(2);
    expect(file.contents()).toEqual([1, 2, 3, 4, 0, 0, 1, 2]);

    const back = new Uint8Array(6);
    expect(streamOps.read(stream(), back, 1, 4, 2)).toBe(4);
    expect([...back]).toEqual([0, 3, 4, 0, 0, 0]);
    // Reading at the end gives fewer bytes than asked for.
    expect(streamOps.read(stream(), back, 0, 6, 5)).toBe(3);
  });

  it('accepts FFmpeg\'s memory as any kind of array', () => {
    const file = fakeFile();
    const { streamOps, stream } = mounted(file);
    // Emscripten passes its signed byte array for writes.
    const memory = new Int8Array([9, -1, 7]);
    streamOps.write(stream(), memory, 1, 2, 0);
    expect(file.contents()).toEqual([255, 7]);
  });

  it('copies through its own buffer when the browser refuses shared memory', () => {
    const file = fakeFile({ rejectShared: true });
    const { streamOps, stream } = mounted(file);
    // The multi-threaded core's memory is shared between its threads.
    const memory = new Uint8Array(new SharedArrayBuffer(8));
    memory.set([5, 6, 7, 8], 2);
    expect(streamOps.write(stream(), memory, 2, 4, 0)).toBe(4);
    expect(file.contents()).toEqual([5, 6, 7, 8]);

    const back = new Uint8Array(new SharedArrayBuffer(8));
    expect(streamOps.read(stream(), back, 0, 8, 1)).toBe(3);
    expect([...back.subarray(0, 3)]).toEqual([6, 7, 8]);
  });

  it('reports the file\'s size, and truncates it', () => {
    const file = fakeFile();
    const { node, fileOps, streamOps, stream } = mounted(file);
    streamOps.write(stream(), new Uint8Array([1, 2, 3, 4, 5]), 0, 5, 0);
    expect(fileOps.getattr(node).size).toBe(5);
    // Opening a file for writing truncates it to nothing this way.
    fileOps.setattr(node, { size: 2 });
    expect(file.contents()).toEqual([1, 2]);
    expect(fileOps.getattr(node).size).toBe(2);
  });

  it('seeks from the start, the current position and the end', () => {
    const { streamOps, stream } = mounted(fakeFile());
    streamOps.write(stream(), new Uint8Array(10), 0, 10, 0);
    expect(streamOps.llseek(stream(4), 3, 0)).toBe(3);
    expect(streamOps.llseek(stream(4), 3, 1)).toBe(7);
    expect(streamOps.llseek(stream(4), -2, 2)).toBe(8);
    expect(errnoOf(() => streamOps.llseek(stream(), -1, 0))).toBe(28); // Invalid argument.
  });

  it('tells FFmpeg there is no space left when the site\'s storage is full', () => {
    const { streamOps, stream } = mounted(fakeFile({ quota: 4 }));
    expect(errnoOf(() => streamOps.write(stream(), new Uint8Array(8), 0, 8, 0))).toBe(51); // No space left on device.
  });

  it('reports any other failure as an I/O error', () => {
    const file = fakeFile();
    file.getSize = () => { throw new DOMException('The file was deleted', 'InvalidStateError'); };
    const { node, fileOps } = mounted(file);
    expect(errnoOf(() => fileOps.getattr(node))).toBe(29); // Input/output error.
  });
});
