#!/usr/bin/env node
/**
 * Tests "Keep the video" for every container and every audio format that offers it. For each
 * container it makes a small sample file with the system's FFmpeg, converts it in the real page
 * (Chromium, with the app's own FFmpeg core) to each audio format with "Keep the video" on, then
 * checks the downloaded file with ffprobe and a full decode: it must have the copied video and
 * the new audio codec, decode without errors, and be named with the input's extension, or .mkv
 * where the container can't hold the audio format (see keepVideoExtension).
 *
 * Usage:
 *   yarn build                      # once, and after changes: the script serves ./build
 *   npx playwright install chromium # once
 *   node scripts/test-keep-video.ts [--containers mp4,avi] [--formats AAC,MP3] [--timeout 120] [--keep DIR]
 *
 * Needs ffmpeg and ffprobe on the PATH. Prints one line per pairing and a summary; exits with
 * 1 if any pairing fails. Pairings the table in src/videoEncoders.tsx lists (so the container
 * is kept) are the ones this is for; a failure there means the table is wrong for video.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Page, chromium } from 'playwright';
import { type ConversionResult, chooseNames, positiveNumber, serveDirectory, waitForOutcome } from './shared.ts';

/** The result of one container + audio format pairing. */
type Outcome = { ok: boolean; detail: string; name?: string };

/** One stream in a file, as ffprobe reports it. */
type Stream = { codec_type: string; codec_name: string };

/** What execFileSync throws when the command fails: FFmpeg's error output is in `stderr`. */
type ExecError = Error & { stderr?: Buffer };

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** How long the page gets to load FFmpeg and read the sample, before the conversion starts. */
const PAGE_READY_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------------------
// What to test
// ---------------------------------------------------------------------------------------

/** The audio formats that offer "Keep the video" (keepVideo in src/formats.tsx), with the codec ffprobe reports. */
const FORMATS: Record<string, string> = { AAC: 'aac', AC3: 'ac3', ALAC: 'alac', DTS: 'dts', FLAC: 'flac', MP3: 'mp3' };

/**
 * Containers that can be kept (those with audioFormats in src/videoEncoders.tsx), each with the
 * FFmpeg arguments that make a sample in it: a video codec the container takes, and audio.
 */
const CONTAINERS: Record<string, string[]> = {
  mp4: ['-c:v', 'libx264', '-c:a', 'aac'],
  webm: ['-c:v', 'libvpx', '-c:a', 'libopus'],
  mkv: ['-c:v', 'libx264', '-c:a', 'aac'],
  mov: ['-c:v', 'libx264', '-c:a', 'aac'],
  avi: ['-c:v', 'mpeg4', '-c:a', 'mp3'],
  nut: ['-c:v', 'mpeg4', '-c:a', 'pcm_s16le'],
  flv: ['-c:v', 'flv', '-c:a', 'mp3', '-ar', '44100'],
  wmv: ['-c:v', 'wmv2', '-c:a', 'wmav2'],
  mpg: ['-c:v', 'mpeg2video', '-c:a', 'mp2'],
  ts: ['-c:v', 'libx264', '-c:a', 'aac'],
  ogv: ['-c:v', 'libtheora', '-c:a', 'libvorbis'],
  '3gp': ['-c:v', 'mpeg4', '-c:a', 'aac', '-ar', '44100', '-ac', '1'],
  rm: ['-c:v', 'rv10', '-c:a', 'ac3'],
};

// ---------------------------------------------------------------------------------------
// Options and setup
// ---------------------------------------------------------------------------------------

const { values: options } = parseArgs({
  options: {
    containers: { type: 'string' },
    formats: { type: 'string' },
    timeout: { type: 'string', default: '120' },
    keep: { type: 'string' },
  },
});

// Test every container and format, or only the ones named in the options.
const containers = chooseNames('--containers', Object.keys(CONTAINERS), options.containers);
const formats = chooseNames('--formats', Object.keys(FORMATS), options.formats);
const timeoutMs = positiveNumber('--timeout', options.timeout) * 1000;

if (!existsSync(join(repo, 'build', 'index.html'))) {
  console.error('There is no build: run "yarn build" first.');
  process.exit(1);
}

// A temporary folder for the samples and the converted files, deleted when the script ends.
// Ctrl+C exits normally, so the folder is deleted then too.
const work = mkdtempSync(join(tmpdir(), 'keep-video-'));
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
process.on('SIGINT', () => process.exit(130));
if (options.keep) mkdirSync(options.keep, { recursive: true });

// ---------------------------------------------------------------------------------------
// Reading the app's table of containers
// ---------------------------------------------------------------------------------------

// The audio formats each container holds, read from the table the app uses.
const table = readFileSync(join(repo, 'src', 'videoEncoders.tsx'), 'utf8');

/** Whether the app says `container` can hold audio in `format` (if not, the output is .mkv). */
const holds = (container: string, format: string) => {
  const row = table.match(new RegExp(`^\\s*'?${container}'?: \\{[^\\]]*?audioFormats: \\[([^\\]]*)\\]`, 'm'));

  // Every container in CONTAINERS has a row. If one is missing, the table has probably been
  // reformatted and the pattern above needs updating. Guessing "no" would report false failures.
  if (!row) throw new Error(`Found no audioFormats for ${container} in src/videoEncoders.tsx: update holds() in this script.`);

  return row[1].includes(`'${format}'`);
};

// ---------------------------------------------------------------------------------------
// Running and checking files with FFmpeg
// ---------------------------------------------------------------------------------------

/** Run a command and return its output. Throws if it fails. */
const run = (command: string, args: string[]) => execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();

/** The streams (video, audio...) in a file. */
const probe = (file: string): Stream[] =>
  JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file])).streams;

/** The codec of the first stream of a type, such as 'video' or 'audio'. */
const codecOf = (streams: Stream[], type: string) => streams.find(stream => stream.codec_type === type)?.codec_name;

/** Decode everything: any error in the output (not just the container) fails the pairing. */
const decodeErrors = (file: string) => {
  try {
    return run('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']).trim() || undefined;
  } catch (error) {
    const { stderr, message } = error as ExecError;
    return String(stderr ?? message).trim().split('\n')[0];
  }
};

/** Make a two second sample in `container` with the system's FFmpeg. Returns its path, or nothing if FFmpeg can't. */
const makeSample = (container: string) => {
  const sample = join(work, `sample.${container}`);
  try {
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=d=2:s=160x120:r=15',
      '-f', 'lavfi', '-i', 'sine=d=2', '-shortest', ...CONTAINERS[container], sample]);
    return sample;
  } catch (error) {
    // This FFmpeg build lacks an encoder the sample needs, so the container is skipped.
    console.log(`SKIP ${container}: the system's FFmpeg can't make a sample (${String((error as ExecError).stderr).trim().split('\n').pop()})`);
  }
};

// ---------------------------------------------------------------------------------------
// Serving the build and starting the browser
// ---------------------------------------------------------------------------------------

// Serve the build with the headers the multi-threaded core needs. The server stops when the
// script exits.
const { url } = await serveDirectory(join(repo, 'build'), { fallbackToIndex: true });

const browser = await chromium.launch();

// ---------------------------------------------------------------------------------------
// Testing one pairing
// ---------------------------------------------------------------------------------------

/** Open the converter in `page`, convert `input` to `format` with "Keep the video" on, and wait for it to end. */
const convertInPage = async (page: Page, input: string, format: string): Promise<ConversionResult> => {
  await page.goto(url);

  // Give the converter the sample, and wait for it to show the file's details.
  await page.setInputFiles('input[type=file]', input);
  await page.waitForSelector('text=Duration', { timeout: PAGE_READY_TIMEOUT_MS });

  // Choose the audio format and "Keep the video". The sample is a video, so the page starts on the
  // Video output type, which has no "Desired format" list: switch to Audio first.
  await page.locator('input[name=output_type][value=audio]').check({ force: true });
  await page.selectOption('#codecs', format);
  await page.locator('input[name=keep_video]').nth(0).check({ force: true });

  // Start waiting before clicking Convert, so the download can't be missed.
  const conversion = waitForOutcome(page, page.locator('text=Conversion failed'), timeoutMs);
  await page.getByRole('button', { name: /^Convert$/ }).click();
  return conversion;
};

/**
 * Check a converted file: its name, its streams, and that it decodes without errors.
 * Returns what is wrong with it, which is nothing if it is correct.
 */
const checkOutput = (file: string, name: string, container: string, format: string, inputVideo: string | undefined) => {
  const problems: string[] = [];
  const streams = probe(file);
  const video = codecOf(streams, 'video');
  const audio = codecOf(streams, 'audio');

  // The output keeps the input's extension if its container can hold the audio, else it is .mkv.
  const extension = name.split('.').pop();
  const expected = holds(container, format) ? container : 'mkv';
  if (extension !== expected) problems.push(`named .${extension}, expected .${expected}`);

  // "Keep the video" copies the video, so it must be the input's codec, and the audio the chosen one.
  if (video !== inputVideo) problems.push(`video is ${video}, not ${inputVideo}`);
  if (audio !== FORMATS[format]) problems.push(`audio is ${audio}, not ${FORMATS[format]}`);

  const errors = decodeErrors(file);
  if (errors) problems.push(`decode: ${errors}`);

  return problems;
};

/** Convert the sample to `format` in the converter, and check the result. */
const testPairing = async (container: string, format: string, input: string, inputVideo: string | undefined): Promise<Outcome> => {
  const page = await browser.newPage({ acceptDownloads: true });
  try {
    const conversion = await convertInPage(page, input, format);

    if (conversion.kind === 'timeout') return { ok: false, detail: 'timed out' };

    if (conversion.kind === 'failed') {
      // Report what the page says went wrong: the first few lines from "Conversion failed" on.
      const text = await page.locator('body').innerText();
      return { ok: false, detail: text.slice(text.indexOf('Conversion failed')).split('\n').slice(0, 3).join(' ').trim() };
    }

    // Save the output, and save a copy for inspection if asked to.
    const name = conversion.download.suggestedFilename();
    const saved = join(work, `out-${container}-${format}-${name}`);
    await conversion.download.saveAs(saved);
    if (options.keep) copyFileSync(saved, join(options.keep, `${container}-${format}-${name}`));

    const problems = checkOutput(saved, name, container, format, inputVideo);
    return { ok: problems.length === 0, detail: problems.join('; '), name };
  } catch (error) {
    return { ok: false, detail: String((error as Error).message).split('\n')[0] };
  } finally {
    await page.close();
  }
};

// ---------------------------------------------------------------------------------------
// Testing every pairing
// ---------------------------------------------------------------------------------------

const results: (Outcome & { container: string; format: string })[] = [];

for (const container of containers) {
  const input = makeSample(container);
  if (!input) continue;

  // The video codec the output must still have, because "Keep the video" copies it.
  const inputVideo = codecOf(probe(input), 'video');

  for (const format of formats) {
    const outcome = await testPairing(container, format, input, inputVideo);
    results.push({ container, format, ...outcome });
    console.log(`${outcome.ok ? 'PASS' : 'FAIL'} ${`${container} + ${format}`.padEnd(14)} ${outcome.name ?? ''}${outcome.detail ? `  ${outcome.detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------------------
// The summary
// ---------------------------------------------------------------------------------------

await browser.close();
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} pairings passed.`);
for (const result of failed) console.log(`  FAIL ${result.container} + ${result.format}: ${result.detail}`);

// A run that tested nothing (every container was skipped) is not a pass.
process.exit(failed.length > 0 || results.length === 0 ? 1 : 0);
