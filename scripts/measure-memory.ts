#!/usr/bin/env node
/**
 * Measures how much memory the browser needs to convert a large file, with the converted file
 * kept on disk (in the browser's private storage, as the converter does where it can; see
 * src/utils/outputStorage.ts) and held in memory (as it does where it can't). It's how the
 * figures in the README's "File size and memory" section were made, and it shows how large an
 * output each way can manage.
 *
 * For each size it makes an input with the system's FFmpeg, converts it in the real page
 * (Chromium, with the app's own FFmpeg core) and, while that runs, adds up the memory of every
 * Chromium process several times a second. It reports the highest total above what the browser
 * used just before Convert was clicked, and whether the conversion finished.
 *
 * Usage:
 *   yarn build                      # once, and after changes: the script serves ./build
 *   npx playwright install chromium # once
 *   node scripts/measure-memory.ts [--sizes 300,600] [--conversions wav,keep-video] [--output disk,memory]
 *                                  [--runs 3] [--timeout 900] [--build DIR]
 *
 * --sizes        The inputs' sizes in MiB. The outputs are about the same size.
 * --conversions  wav: a WAV file to WAV. keep-video: an MP4 to AAC with "Keep the video" on, which
 *                copies the video, so the output is about as large as the input.
 * --output       Where the converted file is kept: disk, or memory (the private storage is
 *                switched off in the page, so the converter falls back to memory).
 * --runs         How many times to run each, to report the median.
 *
 * Needs ffmpeg on the PATH, and Linux (it reads /proc). The inputs, the browser's storage and the
 * downloads go in a temporary folder, which needs about three times the largest size free.
 * Prints one line per run, then a table.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Page, chromium } from 'playwright';
import { chooseNames, positiveNumber, serveDirectory, waitForOutcome } from './shared.ts';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MIB = 1024 ** 2;

/** How long the page gets to load FFmpeg and read the input, before the conversion starts. */
const PAGE_READY_TIMEOUT_MS = 120_000;
/** How often the browser's memory is read while a conversion runs. */
const SAMPLE_INTERVAL_MS = 200;

/** How one run ended, and what it needed. */
type Run = {
  /** 'ok', or what went wrong: the page's error, 'the tab crashed' or 'timed out'. */
  outcome: string;
  /** The highest memory use above the starting point, in bytes. */
  peak: number;
  /** The converted file's size in bytes, if it finished. */
  outputBytes?: number;
  seconds: number;
  /** Whether the converted file was kept on disk, in the browser's private storage. */
  onDisk: boolean;
};

// ---------------------------------------------------------------------------------------
// Options and setup
// ---------------------------------------------------------------------------------------

const { values: options } = parseArgs({
  options: {
    sizes: { type: 'string', default: '300,600' },
    conversions: { type: 'string' },
    output: { type: 'string' },
    runs: { type: 'string', default: '3' },
    timeout: { type: 'string', default: '900' },
    build: { type: 'string', default: join(repo, 'build') },
  },
});

const sizes = options.sizes.split(',').map(size => positiveNumber('--sizes', size));
const conversions = chooseNames('--conversions', ['wav', 'keep-video'], options.conversions);
const outputs = chooseNames('--output', ['disk', 'memory'], options.output);
const runs = positiveNumber('--runs', options.runs, { integer: true });
const timeoutMs = positiveNumber('--timeout', options.timeout) * 1000;

if (!existsSync(join(options.build, 'index.html'))) {
  console.error(`There is no build in ${options.build}: run "yarn build" first.`);
  process.exit(1);
}
if (!existsSync('/proc/self/smaps_rollup')) {
  console.error('This script reads memory use from /proc, so it needs Linux.');
  process.exit(1);
}

// A temporary folder for the inputs, the browser's profile and the downloads, deleted when the
// script ends. Ctrl+C exits normally, so the folder is deleted then too.
const work = mkdtempSync(join(tmpdir(), 'measure-memory-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
process.on('SIGINT', () => process.exit(130));

// Serve the build with the headers the multi-threaded core needs. The server stops when the
// script exits.
const { url } = await serveDirectory(options.build, { fallbackToIndex: true });

// ---------------------------------------------------------------------------------------
// Making the inputs
// ---------------------------------------------------------------------------------------

/** Run the system's FFmpeg. Throws if it fails. */
const ffmpeg = (args: string[]) => { execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'inherit'] }); };

/** A WAV file of about `bytes`: a tone, in 16-bit stereo at 48 kHz, which is 192,000 bytes a second. */
const makeWav = (bytes: number) => {
  const file = join(work, `input-${Math.round(bytes / MIB)}.wav`);
  ffmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-ac', '2', '-t', String(bytes / 192_000), file]);
  return file;
};

/**
 * An MP4 of about `bytes`. The video is noise, which barely compresses, encoded at the highest
 * quality, so the file is large without being long: the converter copies the video and only
 * re-encodes the short audio track.
 */
const makeVideo = (bytes: number) => {
  const make = (seconds: number, file: string) => ffmpeg([
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30,noise=alls=100:allf=t',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(seconds), '-c:v', 'mpeg4', '-q:v', '1', '-c:a', 'aac', file]);
  // Make two seconds first, to find how many bytes a second of it takes.
  const sample = join(work, 'sample.mp4');
  make(2, sample);
  const bytesPerSecond = statSync(sample).size / 2;
  rmSync(sample);
  const file = join(work, `input-${Math.round(bytes / MIB)}.mp4`);
  make(bytes / bytesPerSecond, file);
  return file;
};

// ---------------------------------------------------------------------------------------
// Measuring the browser's memory
// ---------------------------------------------------------------------------------------

/** The process IDs of `root` and every process started by it, directly or not. */
const processTree = (root: number) => {
  // Each process's parent, read from /proc/<pid>/stat: "pid (name) state parent ...".
  const parents = new Map<number, number>();
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, 'utf8');
      // The name can contain spaces and brackets, so read from its last closing bracket.
      parents.set(Number(entry), Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]));
    } catch {
      // The process ended while we were looking.
    }
  }
  const tree = [root];
  for (const pid of tree) {
    for (const [child, parent] of parents) if (parent === pid) tree.push(child);
  }
  return tree;
};

/**
 * The memory used by the browser, in bytes: every one of its processes' "proportional set size"
 * (Pss), which is the memory a process has in use, with memory shared between processes divided
 * among them so that it's counted once in the total.
 */
const browserMemory = (browserPid: number) => {
  let kilobytes = 0;
  for (const pid of processTree(browserPid)) {
    try {
      const pss = /^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${pid}/smaps_rollup`, 'utf8'));
      if (pss) kilobytes += Number(pss[1]);
    } catch {
      // The process ended while we were looking.
    }
  }
  return kilobytes * 1024;
};

/** The browser's main process: the one started with our profile folder that isn't a helper (those have --type=). */
const findBrowserPid = (profile: string) => {
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    try {
      const command = readFileSync(`/proc/${entry}/cmdline`, 'utf8');
      if (command.includes(`--user-data-dir=${profile}`) && !command.includes('--type=')) return Number(entry);
    } catch {
      // The process ended while we were looking.
    }
  }
  throw new Error('Could not find the browser\'s process.');
};

// ---------------------------------------------------------------------------------------
// One run
// ---------------------------------------------------------------------------------------

/** Choose the settings for `conversion` in the converter's page. */
const chooseSettings = async (page: Page, conversion: string) => {
  if (conversion === 'wav') {
    await page.selectOption('#codecs', 'WAV');
  } else {
    await page.selectOption('#codecs', 'AAC');
    await page.locator('input[name=keep_video]').nth(0).check({ force: true });
  }
};

/** Convert `input` once, and measure the browser's memory while it runs. */
const measure = async (input: string, conversion: string, output: string): Promise<Run> => {
  // A browser with its own profile on disk, as a visitor's has. (Playwright's usual pages are
  // like private windows, which are allowed very little storage.)
  const profile = mkdtempSync(join(work, 'profile-'));
  const downloads = mkdtempSync(join(work, 'downloads-'));
  const context = await chromium.launchPersistentContext(profile, { acceptDownloads: true, downloadsPath: downloads });
  try {
    const page = context.pages()[0] ?? await context.newPage();
    if (output === 'memory') {
      // Without the private storage the converter holds the converted file in memory.
      await page.addInitScript(() => {
        navigator.storage.getDirectory = () => Promise.reject(new DOMException('Switched off', 'SecurityError'));
      });
    }
    let crashed = false;
    page.on('crash', () => { crashed = true; });

    // Open the converter, give it the input, and wait for it to show the file's details.
    await page.goto(url);
    await page.setInputFiles('input[type=file]', input);
    await page.waitForSelector('text=Duration', { timeout: PAGE_READY_TIMEOUT_MS });
    await chooseSettings(page, conversion);

    // The starting point: the browser with the page loaded and idle.
    const browserPid = findBrowserPid(profile);
    await page.waitForTimeout(1000);
    const before = browserMemory(browserPid);
    let highest = before;
    const sampler = setInterval(() => { highest = Math.max(highest, browserMemory(browserPid)); }, SAMPLE_INTERVAL_MS);

    const started = Date.now();
    let outcome = 'ok';
    let outputBytes: number | undefined;
    let onDisk = false;
    try {
      // Start waiting before clicking Convert, so the download can't be missed.
      const conversionEnd = waitForOutcome(page, page.locator('text=Conversion failed'), timeoutMs);
      await page.getByRole('button', { name: /^Convert$/ }).click();
      const result = await conversionEnd;
      if (result.kind === 'downloaded') {
        // Wait for the browser to finish writing the download: that's part of what it needs.
        const saved = await result.download.path();
        outputBytes = statSync(saved).size;
        // The page only offers the file again when it was held in memory (one on disk has been
        // deleted by now), so no link means it was on disk.
        onDisk = await page.locator('a[download]').count() === 0;
      } else if (crashed) {
        outcome = 'the tab crashed';
      } else if (result.kind === 'timeout') {
        outcome = 'timed out';
      } else {
        // What the page says went wrong: its error message, without the advice after it.
        const alert = await page.locator('[role=alert]').last().innerText().catch(() => '');
        outcome = alert.split('. ')[0] || 'failed';
      }
    } finally {
      clearInterval(sampler);
    }
    return { outcome, peak: highest - before, outputBytes, seconds: (Date.now() - started) / 1000, onDisk };
  } finally {
    await context.close().catch(() => {});
    // Free the space before the next run.
    rmSync(profile, { recursive: true, force: true });
    rmSync(downloads, { recursive: true, force: true });
  }
};

// ---------------------------------------------------------------------------------------
// Every run, and the table
// ---------------------------------------------------------------------------------------

const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

const rows: string[] = [];
for (const conversion of conversions) {
  for (const size of sizes) {
    const input = conversion === 'wav' ? makeWav(size * MIB) : makeVideo(size * MIB);
    for (const output of outputs) {
      const results: Run[] = [];
      for (let run = 1; run <= runs; run++) {
        const result = await measure(input, conversion, output);
        results.push(result);
        console.log(`${conversion} ${size} MiB, output in ${output}, run ${run}: ${result.outcome}, `
          + `peak ${gib(result.peak)}, ${result.seconds.toFixed(0)} s`
          + (result.outputBytes !== undefined ? `, output ${Math.round(result.outputBytes / MIB)} MiB` : '')
          + (result.onDisk ? ', kept on disk' : ''));
      }
      const finished = results.filter(result => result.outcome === 'ok');
      const failure = results.find(result => result.outcome !== 'ok');
      rows.push(`| ${conversion} | ${size} MiB | ${output} | ${gib(median(results.map(result => result.peak)))} | `
        + `${finished.length} of ${runs} finished${failure ? ` (${failure.outcome})` : ''} |`);
    }
    rmSync(input);
  }
}

console.log('\n| Conversion | Input | Output kept in | Peak memory (median) | Result |');
console.log('| --- | --- | --- | --- | --- |');
for (const row of rows) console.log(row);

// The web server would keep the script running.
process.exit(0);
