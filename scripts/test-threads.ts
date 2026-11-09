#!/usr/bin/env node
/**
 * Checks which video encoders need `-threads 4` on the multi-threaded FFmpeg core. Each encoder
 * converts the same clip, with and without the flag, several times. A run that doesn't finish
 * within the timeout counts as a hang. The page loads the core through @ffmpeg/ffmpeg, as the
 * converter does, in Chromium with cross-origin isolation, so the multi-threaded core is used.
 *
 * Usage:
 *   npx playwright install chromium  # once
 *   node scripts/test-threads.ts <input video> [--rounds 1] [--timeout 120] [--only libx264,gif]
 *
 * Output: one line per run (JSON), then a summary per encoder. Nothing in the repo is changed.
 */
import { copyFileSync, cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';
import { chooseNames, positiveNumber, serveDirectory } from './shared.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

type Encoder = { name: string; args: string[]; out: string };

/** What the page's convert() reports for one run (see thread-test-page.html). */
type RunResult = { outcome: 'ok' | 'failed' | 'hung'; seconds: number; bytes: number; crossOriginIsolated: boolean; errors: string[] };

/** The globals the page defines (see thread-test-page.html). */
declare global {
  interface Window {
    ready?: boolean;
    convert(inputName: string, args: string[], outName: string, timeoutMs: number): Promise<RunResult>;
  }
}

// ---------------------------------------------------------------------------------------
// The encoders to test
// ---------------------------------------------------------------------------------------

/**
 * Encoders to test, with the arguments the converter uses for them (see src/videoEncoders.tsx),
 * minus the options that only affect quality. Each writes to a file named by its container.
 */
const ENCODERS: Encoder[] = [
  { name: 'gif', args: ['-c:v', 'gif', '-vf', 'fps=15,scale=480:-2,split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1'], out: 'out.gif' },
  { name: 'libx264', args: ['-c:v', 'libx264', '-crf', '23', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'], out: 'out.mp4' },
  // The same x264 library, and it crashes without -threads 4 in the same way.
  { name: 'libx264rgb', args: ['-c:v', 'libx264rgb', '-qp', '0', '-preset', 'veryfast'], out: 'out.mkv' },
  { name: 'libx265', args: ['-c:v', 'libx265', '-crf', '28', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'], out: 'out.mp4' },
  { name: 'libvpx-vp9', args: ['-c:v', 'libvpx-vp9', '-crf', '31', '-b:v', '0', '-deadline', 'good', '-cpu-used', '4', '-pix_fmt', 'yuv420p'], out: 'out.webm' },
  { name: 'libvpx', args: ['-c:v', 'libvpx', '-crf', '10', '-b:v', '20M', '-pix_fmt', 'yuv420p'], out: 'out.webm' },
  { name: 'libaom-av1', args: ['-c:v', 'libaom-av1', '-usage', 'realtime', '-cpu-used', '8', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p'], out: 'out.webm' },
  { name: 'libsvtav1', args: ['-c:v', 'libsvtav1', '-crf', '35', '-preset', '10', '-svtav1-params', 'lp=1', '-pix_fmt', 'yuv420p'], out: 'out.webm' },
  { name: 'mpeg4', args: ['-c:v', 'mpeg4', '-q:v', '3'], out: 'out.mp4' },
  { name: 'theora', args: ['-c:v', 'libtheora', '-q:v', '7'], out: 'out.ogv' },
];

// ---------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------

const { values: options, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rounds: { type: 'string', default: '1' },
    timeout: { type: 'string', default: '120' },
    only: { type: 'string' },
  },
});

// The input video is the one argument that isn't an option.
const input = positionals[0] && resolve(positionals[0]);
if (!input || !existsSync(input)) {
  console.error('Usage: node scripts/test-threads.ts <input video> [--rounds 1] [--timeout 120] [--only libx264,gif]');
  process.exit(1);
}

// Test every encoder, or only the ones named in --only.
const names = chooseNames('--only', ENCODERS.map(encoder => encoder.name), options.only);
const encoders = ENCODERS.filter(encoder => names.includes(encoder.name));
const rounds = positiveNumber('--rounds', options.rounds, { integer: true });
const timeoutMs = positiveNumber('--timeout', options.timeout) * 1000;

// ---------------------------------------------------------------------------------------
// Building and serving the test page
// ---------------------------------------------------------------------------------------

// A folder the page can load from: the page, FFmpeg's JavaScript library, the multi-threaded
// core, and the input video.
const site = mkdtempSync(join(tmpdir(), 'thread-test-'));

// Delete the folder when the script ends, however it ends. Ctrl+C exits normally, so the folder
// is deleted then too.
process.on('exit', () => rmSync(site, { recursive: true, force: true }));
process.on('SIGINT', () => process.exit(130));

const inputName = `input${extname(input)}`;
copyFileSync(join(repo, 'scripts', 'thread-test-page.html'), join(site, 'index.html'));
cpSync(join(repo, 'node_modules/@ffmpeg/ffmpeg/dist/esm'), join(site, 'ffmpeg'), { recursive: true });
cpSync(join(repo, 'node_modules/@ffmpeg/util/dist/esm'), join(site, 'util'), { recursive: true });
cpSync(join(repo, 'vendor/ffmpeg-core/mt'), join(site, 'core'), { recursive: true });
copyFileSync(input, join(site, inputName));

// Serve it with the headers the multi-threaded core needs. Unknown paths are a 404, because the
// page only loads files that exist.
const { url: siteUrl, close } = await serveDirectory(site, { fallbackToIndex: false });
const url = `${siteUrl}index.html`;

// ---------------------------------------------------------------------------------------
// Opening the page
// ---------------------------------------------------------------------------------------

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', error => console.error('page error:', String(error).slice(0, 200)));
await page.goto(url);
await page.waitForFunction(() => window.ready === true);

// The multi-threaded core only works in a cross-origin isolated page, so stop if it isn't one.
const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
if (!isolated) {
  console.error('The page is not cross-origin isolated, so the multi-threaded core would not be used.');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------
// Running every encoder, with and without -threads 4
// ---------------------------------------------------------------------------------------

const results: Record<string, { withThreads: RunResult[]; withoutThreads: RunResult[] }> = {};
try {
  for (const encoder of encoders) {
    results[encoder.name] = { withThreads: [], withoutThreads: [] };

    for (let round = 0; round < rounds; round++) {
      for (const withThreads of [true, false]) {
        const args = ['-i', inputName, ...(withThreads ? ['-threads', '4'] : []), '-map', '0:V:0', '-an', ...encoder.args, encoder.out];

        // A fresh page for each run: after about 50 runs in one page, loading the core starts
        // failing with "Failed to fetch".
        await page.goto(url);
        await page.waitForFunction(() => window.ready === true);

        // Run FFmpeg in the page, and print the run as one line of JSON.
        const result = await page.evaluate(([i, a, o, t]: [string, string[], string, number]) => window.convert(i, a, o, t), [inputName, args, encoder.out, timeoutMs] as [string, string[], string, number]);
        const key = withThreads ? 'withThreads' : 'withoutThreads';
        results[encoder.name][key].push(result);
        console.log(JSON.stringify({ encoder: encoder.name, flag: withThreads ? '-threads 4' : 'none', round: round + 1, ...result }));
      }
    }
  }
} finally {
  await browser.close();
  close();
}

// ---------------------------------------------------------------------------------------
// The summary table
// ---------------------------------------------------------------------------------------

console.log('\n| Encoder | Without -threads 4 | With -threads 4 | Output sizes match |\n| --- | --- | --- | --- |');

/** The outcomes of some runs, counted: for example "ok 2/3, hung 1/3". */
const summarise = (runs: RunResult[]) => {
  const counts = new Map<string, number>();
  for (const run of runs) counts.set(run.outcome, (counts.get(run.outcome) ?? 0) + 1);

  return [...counts].map(([outcome, count]) => `${outcome} ${count}/${runs.length}`).join(', ');
};

for (const [name, { withThreads, withoutThreads }] of Object.entries(results)) {
  // Every successful run of an encoder should write the same number of bytes, with or without the flag.
  const sizes = new Set([...withThreads, ...withoutThreads].filter(run => run.outcome === 'ok').map(run => run.bytes));
  console.log(`| ${name} | ${summarise(withoutThreads)} | ${summarise(withThreads)} | ${sizes.size <= 1 ? 'yes' : 'no'} |`);
}
