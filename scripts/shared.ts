/**
 * Helpers shared by the scripts in this folder: a small web server for the pages they open in
 * Chromium, a wait for a conversion in the converter's page to finish, fail or time out, and
 * checks for their command line options.
 */
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { extname, join, resolve, sep } from 'node:path';
import type { Download, Locator, Page } from 'playwright';

/** Content types for the files the pages load; anything else is sent as a plain download. */
const TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
};

/**
 * Serves the files in `root` on a free local port, and returns the address and a way to stop it.
 *
 * The pages are cross-origin isolated (the headers the multi-threaded FFmpeg core needs, as the
 * production server sends them).
 *
 * fallbackToIndex Answer a path with no file with index.html, as the single-page app expects.
 *                 Otherwise answer with a 404.
 */
export const serveDirectory = async (root: string, { fallbackToIndex }: { fallbackToIndex: boolean }) => {
  const base = resolve(root);

  const server = createServer((request, response) => {
    let path = join(base, decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname));

    // Never serve a file outside `base`, a folder, or a file that doesn't exist.
    if (!path.startsWith(base + sep) || !existsSync(path) || statSync(path).isDirectory()) {
      if (!fallbackToIndex) {
        response.writeHead(404).end();
        return;
      }
      path = join(base, 'index.html');
    }

    response.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
    createReadStream(path).pipe(response);
  });

  // Port 0 lets the operating system pick a free port.
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as AddressInfo;

  return { url: `http://127.0.0.1:${port}/`, close: () => server.close() };
};

/** How a conversion ended: the output was downloaded, the page showed an error, or time ran out. */
export type ConversionResult = { kind: 'downloaded'; download: Download } | { kind: 'failed' } | { kind: 'timeout' };

/**
 * Waits for the conversion in `page` to end. `failure` matches whatever the page shows when a
 * conversion fails. Call this before clicking Convert, so the download can't be missed, and
 * await the result afterwards.
 */
export const waitForOutcome = async (page: Page, failure: Locator, timeoutMs: number): Promise<ConversionResult> => {
  const downloaded = page.waitForEvent('download', { timeout: timeoutMs })
    .then(download => ({ kind: 'downloaded' as const, download }));
  const failed = failure.first().waitFor({ timeout: timeoutMs })
    .then(() => ({ kind: 'failed' as const }));

  try {
    // Whichever happens first wins. If neither happens in time, both wait calls reject.
    return await Promise.race([downloaded, failed]);
  } catch {
    return { kind: 'timeout' };
  }
};

/**
 * The names in `all` that the comma-separated option `requested` lists, or all of them if the
 * option wasn't given. A name that doesn't exist is an error: a typo would otherwise run nothing
 * and look like success.
 */
export const chooseNames = (flag: string, all: string[], requested: string | undefined) => {
  if (requested === undefined) return all;

  const names = requested.split(',');
  const unknown = names.filter(name => !all.includes(name));
  if (unknown.length > 0) {
    console.error(`${flag}: unknown ${unknown.join(', ')}. Choose from: ${all.join(', ')}`);
    process.exit(1);
  }
  return all.filter(name => names.includes(name));
};

/** A number option that must be above zero (and a whole number, if `integer`). Anything else is an error. */
export const positiveNumber = (flag: string, value: string | undefined, { integer = false } = {}) => {
  const number = Number(value);
  if (!(number > 0) || (integer && !Number.isInteger(number))) {
    console.error(`${flag} must be a positive ${integer ? 'whole ' : ''}number, not "${value}".`);
    process.exit(1);
  }
  return number;
};
