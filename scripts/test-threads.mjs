#!/usr/bin/env node
/**
 * Checks which video encoders need `-threads 4` on the multi-threaded FFmpeg core. Each encoder
 * converts the same clip, with and without the flag, several times. A run that doesn't finish
 * within the timeout counts as a hang. The page loads the core through @ffmpeg/ffmpeg, as the
 * converter does, in Chromium with cross-origin isolation, so the multi-threaded core is used.
 *
 * Usage:
 *   npx playwright install chromium  # once
 *   node scripts/test-threads.mjs <input video> [--rounds 1] [--timeout 120] [--only libx264,gif]
 *
 * Output: one line per run (JSON), then a summary per encoder. Nothing in the repo is changed.
 */
import { copyFileSync, cpSync, createReadStream, existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Encoders to test, with the arguments the converter uses for them (see src/videoEncoders.tsx),
 * minus the options that only affect quality. Each writes to a file named by its container.
 */
const ENCODERS = [
  { name: 'gif', args: ['-c:v', 'gif', '-vf', 'fps=15,scale=480:-2,split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1'], out: 'out.gif' },
  { name: 'libx264', args: ['-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'], out: 'out.mp4' },
  { name: 'libx265', args: ['-c:v', 'libx265', '-crf', '28', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'], out: 'out.mp4' },
  { name: 'libvpx-vp9', args: ['-c:v', 'libvpx-vp9', '-crf', '31', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p'], out: 'out.webm' },
  { name: 'libvpx', args: ['-c:v', 'libvpx', '-crf', '10', '-b:v', '20M', '-pix_fmt', 'yuv420p'], out: 'out.webm' },
  { name: 'libaom-av1', args: ['-c:v', 'libaom-av1', '-usage', 'realtime', '-cpu-used', '8', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p'], out: 'out.webm' },
  { name: 'libsvtav1', args: ['-c:v', 'libsvtav1', '-crf', '35', '-preset', '10', '-svtav1-params', 'lp=1', '-pix_fmt', 'yuv420p'], out: 'out.webm' },
  { name: 'mpeg4', args: ['-c:v', 'mpeg4', '-q:v', '3'], out: 'out.mp4' },
  { name: 'theora', args: ['-c:v', 'libtheora', '-q:v', '7'], out: 'out.ogv' },
];

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rounds: { type: 'string', default: '1' },
    timeout: { type: 'string', default: '120' },
    only: { type: 'string' },
  },
});
const input = positionals[0] && resolve(positionals[0]);
if (!input || !existsSync(input)) {
  console.error('Usage: node scripts/test-threads.mjs <input video> [--rounds 1] [--timeout 120] [--only libx264,gif]');
  process.exit(1);
}
const only = options.only?.split(',');
const encoders = ENCODERS.filter(encoder => !only || only.includes(encoder.name));
const timeoutMs = Number(options.timeout) * 1000;

// A folder the page can load from: the page, FFmpeg's JavaScript library, and the multi-threaded core.
const site = mkdtempSync(join(tmpdir(), 'thread-test-'));
cpSync(join(repo, 'node_modules/@ffmpeg/ffmpeg/dist/esm'), join(site, 'ffmpeg'), { recursive: true });
cpSync(join(repo, 'node_modules/@ffmpeg/util/dist/esm'), join(site, 'util'), { recursive: true });
cpSync(join(repo, 'vendor/ffmpeg-core/mt'), join(site, 'core'), { recursive: true });
copyFileSync(input, join(site, `input${extname(input)}`));
const inputName = `input${extname(input)}`;
writeFileSync(join(site, 'index.html'), `<!doctype html><meta charset="utf-8"><title>thread test</title>
<script type="module">
import { FFmpeg } from './ffmpeg/index.js';
import { toBlobURL } from './util/index.js';
// Runs one conversion on a fresh FFmpeg instance, so a hang in one run can't affect the next.
window.convert = async (args, outName, timeoutMs) => {
  try {
    return await convertOnce(args, outName, timeoutMs);
  } catch (error) {
    return { outcome: 'failed', seconds: 0, bytes: 0, crossOriginIsolated: globalThis.crossOriginIsolated,
      errors: [String(error?.stack ?? error).split('\\n').slice(0, 3).join(' | ')] };
  }
};
const convertOnce = async (args, outName, timeoutMs) => {
  const ffmpeg = new FFmpeg();
  const log = [];
  ffmpeg.on('log', ({ message }) => log.push(message));
  await ffmpeg.load({
    coreURL: await toBlobURL('core/ffmpeg-core.js', 'text/javascript'),
    wasmURL: await toBlobURL('core/ffmpeg-core.wasm', 'application/wasm'),
    workerURL: await toBlobURL('core/ffmpeg-core.worker.js', 'text/javascript'),
  });
  await ffmpeg.writeFile(${JSON.stringify(inputName)}, new Uint8Array(await (await fetch(${JSON.stringify(inputName)})).arrayBuffer()));
  const started = performance.now();
  const result = await Promise.race([
    ffmpeg.exec(args).then(code => ({ code })),
    new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), timeoutMs)),
  ]);
  const seconds = (performance.now() - started) / 1000;
  let bytes = 0;
  if (result.code === 0) { try { bytes = (await ffmpeg.readFile(outName)).length; } catch {} }
  const errors = log.filter(line => /error|invalid|failed/i.test(line) && !/^Aborted\\(\\)$/.test(line)).slice(-2);
  ffmpeg.terminate();
  return {
    outcome: result.timedOut ? 'hung' : result.code === 0 && bytes > 0 ? 'ok' : 'failed',
    seconds: Math.round(seconds * 10) / 10,
    bytes,
    crossOriginIsolated: globalThis.crossOriginIsolated,
    errors,
  };
};
window.ready = true;
</script>
`);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.wasm': 'application/wasm', '.webm': 'video/webm', '.mp4': 'video/mp4', '.mkv': 'video/x-matroska' };
const server = createServer((request, response) => {
  const path = join(site, decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
  if (!path.startsWith(site) || !existsSync(path) || statSync(path).isDirectory()) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
  });
  createReadStream(path).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const url = `http://127.0.0.1:${server.address().port}/index.html`;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', error => console.error('page error:', String(error).slice(0, 200)));
await page.goto(url);
await page.waitForFunction(() => window.ready === true);
const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
if (!isolated) {
  console.error('The page is not cross-origin isolated, so the multi-threaded core would not be used.');
  process.exit(1);
}

const results = {};
try {
  for (const encoder of encoders) {
    results[encoder.name] = { withThreads: [], withoutThreads: [] };
    for (let round = 0; round < Number(options.rounds); round++) {
      for (const withThreads of [true, false]) {
        const args = ['-i', inputName, ...(withThreads ? ['-threads', '4'] : []), '-map', '0:V:0', '-an', ...encoder.args, encoder.out];
        const result = await page.evaluate(([a, o, t]) => window.convert(a, o, t), [args, encoder.out, timeoutMs]);
        const key = withThreads ? 'withThreads' : 'withoutThreads';
        results[encoder.name][key].push(result);
        console.log(JSON.stringify({ encoder: encoder.name, flag: withThreads ? '-threads 4' : 'none', round: round + 1, ...result }));
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}

console.log('\n| Encoder | Without -threads 4 | With -threads 4 | Output sizes match |\n| --- | --- | --- | --- |');
const summarise = runs => {
  const outcomes = runs.map(run => run.outcome);
  const counts = outcomes.reduce((acc, outcome) => ({ ...acc, [outcome]: (acc[outcome] ?? 0) + 1 }), {});
  return Object.entries(counts).map(([outcome, count]) => `${outcome} ${count}/${runs.length}`).join(', ');
};
for (const [name, { withThreads, withoutThreads }] of Object.entries(results)) {
  const sizes = new Set([...withThreads, ...withoutThreads].filter(run => run.outcome === 'ok').map(run => run.bytes));
  console.log(`| ${name} | ${summarise(withoutThreads)} | ${summarise(withThreads)} | ${sizes.size <= 1 ? 'yes' : 'no'} |`);
}
rmSync(site, { recursive: true, force: true });
