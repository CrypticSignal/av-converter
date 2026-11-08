#!/usr/bin/env node
/**
 * Benchmarks video encoders in the converter itself: the production build, in Chromium, with the
 * same FFmpeg WebAssembly cores and threading as visitors get. Each encoder converts the same
 * input; the table shows how long each took, the output's size, and its quality (PSNR against the
 * input, if FFmpeg is installed).
 *
 * Usage:
 *   yarn build
 *   yarn benchmark <input video> [--single-threaded] [--only <text>] [--keep <dir>] [--timeout <s>]
 *
 *   --single-threaded  Serve the page without cross-origin isolation, so it uses the
 *                      single-threaded core (as in browsers that don't allow multi-threading).
 *   --only <text>      Only run the encoders whose name contains <text> (e.g. "AV1").
 *   --keep <dir>       Save each output in <dir>.
 *   --timeout <s>      Give up on a conversion after this many seconds (default 600).
 *
 * Needs Chromium for Playwright (npx playwright install chromium), and optionally ffmpeg on the
 * PATH for the PSNR column. Use the same input for runs you compare: a few seconds of real
 * footage at the resolution you care about gives the most useful numbers.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

/**
 * The encoders to compare, with the arguments the converter uses for them by default (see
 * src/videoEncoders.tsx), plus other speed settings. Each output is video only, in Matroska.
 */
const ENCODERS = [
  { name: 'AV1 (libaom), speed 8, CRF 32', args: '-c:v libaom-av1 -usage realtime -cpu-used 8 -crf 32 -b:v 0 -row-mt 1 -pix_fmt yuv420p' },
  { name: 'AV1 (libaom), speed 6, CRF 32', args: '-c:v libaom-av1 -usage realtime -cpu-used 6 -crf 32 -b:v 0 -row-mt 1 -pix_fmt yuv420p' },
  { name: 'AV1 (SVT-AV1), preset 12, CRF 35', args: '-c:v libsvtav1 -crf 35 -preset 12 -svtav1-params lp=1 -pix_fmt yuv420p', threadsOnly: true },
  { name: 'AV1 (SVT-AV1), preset 10, CRF 35', args: '-c:v libsvtav1 -crf 35 -preset 10 -svtav1-params lp=1 -pix_fmt yuv420p', threadsOnly: true },
  { name: 'AV1 (SVT-AV1), preset 8, CRF 35', args: '-c:v libsvtav1 -crf 35 -preset 8 -svtav1-params lp=1 -pix_fmt yuv420p', threadsOnly: true },
  { name: 'VP9, speed 4, CRF 31', args: '-c:v libvpx-vp9 -crf 31 -b:v 0 -deadline good -cpu-used 4 -row-mt 1 -pix_fmt yuv420p' },
  { name: 'H.264, veryfast, CRF 23', args: '-c:v libx264 -crf 23 -preset veryfast -pix_fmt yuv420p' },
  { name: 'H.265, veryfast, CRF 28', args: '-c:v libx265 -crf 28 -preset veryfast -pix_fmt yuv420p', threadsOnly: true },
];

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    'single-threaded': { type: 'boolean', default: false },
    only: { type: 'string' },
    keep: { type: 'string' },
    timeout: { type: 'string', default: '600' },
  },
});
const input = positionals[0] && resolve(positionals[0]);
if (!input || !existsSync(input)) {
  console.error('Usage: yarn benchmark <input video> [--single-threaded] [--only <text>] [--keep <dir>] [--timeout <s>]');
  process.exit(1);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'build');
if (!existsSync(join(root, 'index.html'))) {
  console.error('Build the site first: yarn build');
  process.exit(1);
}
const isolated = !options['single-threaded'];
const timeoutMs = Number(options.timeout) * 1000;
if (options.keep) mkdirSync(options.keep, { recursive: true });

const hasFFmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

/** PSNR of `output` against `input`, comparing frames by their order rather than their timestamps. */
const psnr = (output) => {
  // Containers round timestamps differently (Matroska to the millisecond), so matching frames by
  // time can pair a frame with its neighbour. Numbering both inputs' frames avoids that.
  const filter = '[0:v]settb=1/1000,setpts=N[a];[1:v]settb=1/1000,setpts=N[b];[a][b]psnr';
  const { stderr } = spawnSync('ffmpeg', ['-hide_banner', '-i', output, '-i', input, '-lavfi', filter, '-f', 'null', '-'],
    { encoding: 'utf8' });
  const match = /average:([\d.]+|inf)/.exec(stderr);
  if (!match) return '?';
  return match[1] === 'inf' ? 'lossless' : `${Number(match[1]).toFixed(2)} dB`;
};

// Serve the production build as the real server does, with the headers that make the page
// cross-origin isolated (and so able to use the multi-threaded core), unless asked not to.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = createServer((request, response) => {
  let path = join(root, decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!path.startsWith(root) || !existsSync(path) || statSync(path).isDirectory()) path = join(root, 'index.html');
  response.writeHead(200, {
    'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
    ...(isolated && { 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp' }),
  });
  createReadStream(path).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/`;

/** Convert the input with one encoder through the page's manual command mode, and measure it. */
const run = async (browser, encoder) => {
  const page = await browser.newPage({ acceptDownloads: true });
  try {
    await page.goto(url);
    const threads = await page.evaluate(() => globalThis.crossOriginIsolated);
    if (encoder.threadsOnly && !threads) return { result: 'skipped: needs multi-threading' };
    await page.setInputFiles('input[type=file]', input);
    // FFmpeg has loaded once it has read the file, so the time is the conversion's alone.
    await page.getByText('Duration').first().waitFor({ timeout: 120_000 });
    await page.getByLabel('Write my own FFmpeg command').check();
    await page.fill('#manual_command', `-an ${encoder.args} output.mkv`);
    const download = page.waitForEvent('download', { timeout: timeoutMs });
    const failed = page.locator('.MuiAlert-standardError').first().waitFor({ timeout: timeoutMs });
    const started = performance.now();
    await page.getByRole('button', { name: 'Convert', exact: true }).click();
    const outcome = await Promise.race([download, failed.then(() => null)]).catch(() => undefined);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    if (outcome === undefined) return { result: `timed out after ${seconds} s` };
    if (outcome === null) {
      const message = await page.locator('.MuiAlert-standardError').first().textContent();
      return { result: `failed: ${message.slice(0, 100)}` };
    }
    const path = await outcome.path();
    if (options.keep) copyFileSync(path, join(options.keep, `${encoder.name.replace(/\W+/g, '_')}.mkv`));
    return {
      time: `${seconds} s`,
      size: `${Math.round(statSync(path).size / 1024)} KB`,
      quality: hasFFmpeg ? psnr(path) : 'n/a',
    };
  } catch (error) {
    return { result: `failed: ${String(error.message ?? error).split('\n')[0].slice(0, 100)}` };
  } finally {
    await page.close();
  }
};

const encoders = ENCODERS.filter(encoder => !options.only || encoder.name.includes(options.only));
console.log(`Input: ${basename(input)}. Core: ${isolated ? 'multi-threaded' : 'single-threaded'}.`
  + (hasFFmpeg ? '' : ' (Install ffmpeg to measure quality.)'));
const rows = [];
const browser = await chromium.launch();
try {
  for (const encoder of encoders) {
    const row = { encoder: encoder.name, ...await run(browser, encoder) };
    rows.push(row);
    console.log(`${row.encoder}: ${row.result ?? `${row.time}, ${row.size}, ${row.quality}`}`);
  }
} finally {
  await browser.close();
  server.close();
}

console.log('\n| Encoder | Time | Size | PSNR |\n| --- | --- | --- | --- |');
for (const row of rows) {
  console.log(row.result ? `| ${row.encoder} | ${row.result} | | |` : `| ${row.encoder} | ${row.time} | ${row.size} | ${row.quality} |`);
}
