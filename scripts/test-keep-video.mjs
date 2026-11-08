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
 *   node scripts/test-keep-video.mjs [--containers mp4,avi] [--formats AAC,MP3] [--timeout 120] [--keep DIR]
 *
 * Needs ffmpeg and ffprobe on the PATH. Prints one line per pairing and a summary; exits with
 * 1 if any pairing fails. Pairings the table in src/videoEncoders.tsx lists (so the container
 * is kept) are the ones this is for; a failure there means the table is wrong for video.
 */
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The audio formats that offer "Keep the video" (keepVideo in src/formats.tsx), with the codec ffprobe reports. */
const FORMATS = { AAC: 'aac', AC3: 'ac3', ALAC: 'alac', DTS: 'dts', FLAC: 'flac', MP3: 'mp3' };

/**
 * Containers that can be kept (those with audioFormats in src/videoEncoders.tsx), each with the
 * FFmpeg arguments that make a sample in it: a video codec the container takes, and audio.
 */
const CONTAINERS = {
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

const { values: options } = parseArgs({
  options: {
    containers: { type: 'string' },
    formats: { type: 'string' },
    timeout: { type: 'string', default: '120' },
    keep: { type: 'string' },
  },
});
const containers = Object.keys(CONTAINERS).filter(name => !options.containers || options.containers.split(',').includes(name));
const formats = Object.keys(FORMATS).filter(name => !options.formats || options.formats.split(',').includes(name));
const timeoutMs = Number(options.timeout) * 1000;

if (!existsSync(join(repo, 'build', 'index.html'))) {
  console.error('There is no build: run "yarn build" first.');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'keep-video-'));
if (options.keep) mkdirSync(options.keep, { recursive: true });

// The audio formats each container holds, read from the table the app uses.
const table = readFileSync(join(repo, 'src', 'videoEncoders.tsx'), 'utf8');
const holds = (container, format) => {
  const row = table.match(new RegExp(`^\\s*'?${container}'?: \\{[^\\]]*?audioFormats: \\[([^\\]]*)\\]`, 'm'));
  return Boolean(row && row[1].includes(`'${format}'`));
};

const run = (command, args) => execFileSync(command, args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
const probe = file => JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name', '-of', 'json', file])).streams;
/** Decode everything: any error in the output (not just the container) fails the pairing. */
const decodeErrors = file => {
  try {
    return run('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']).trim() || undefined;
  } catch (error) {
    return String(error.stderr ?? error.message).trim().split('\n')[0];
  }
};

// Serve the build with vite preview, which sends the headers the multi-threaded core needs.
const port = 4000 + Math.floor(Math.random() * 1000);
const server = spawn('npx', ['vite', 'preview', '--port', String(port), '--strictPort'], { cwd: repo, stdio: 'ignore' });
const stop = () => { server.kill(); rmSync(work, { recursive: true, force: true }); };
process.on('exit', stop);
process.on('SIGINT', () => process.exit(130));
const url = `http://localhost:${port}/`;
for (let tries = 0; ; tries++) {
  try { if ((await fetch(url)).ok) break; } catch { /* not up yet */ }
  if (tries > 50) { console.error('The preview server did not start.'); process.exit(1); }
  await new Promise(done => setTimeout(done, 200));
}

const browser = await chromium.launch();
const results = [];

for (const container of containers) {
  const input = join(work, `sample.${container}`);
  try {
    run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc=d=2:s=160x120:r=15',
      '-f', 'lavfi', '-i', 'sine=d=2', '-shortest', ...CONTAINERS[container], input]);
  } catch (error) {
    console.log(`SKIP ${container}: the system's FFmpeg can't make a sample (${String(error.stderr).trim().split('\n').pop()})`);
    continue;
  }
  const inputVideo = probe(input).find(stream => stream.codec_type === 'video')?.codec_name;

  for (const format of formats) {
    const page = await browser.newPage({ acceptDownloads: true });
    const label = `${container} + ${format}`;
    let outcome;
    try {
      await page.goto(url);
      await page.setInputFiles('input[type=file]', input);
      await page.waitForSelector('text=Duration', { timeout: 30000 });
      await page.selectOption('#codecs', format);
      await page.locator('input[name=keep_video]').nth(0).check({ force: true });

      const download = page.waitForEvent('download', { timeout: timeoutMs }).catch(() => undefined);
      const failure = page.waitForSelector('text=Conversion failed', { timeout: timeoutMs }).then(() => 'failed').catch(() => undefined);
      await page.getByRole('button', { name: /^Convert$/ }).click();
      const first = await Promise.race([download.then(file => file && { file }), failure.then(message => message && { failed: true })]);

      if (!first?.file) {
        const text = await page.locator('body').innerText();
        outcome = { ok: false, detail: first?.failed ? text.slice(text.indexOf('Conversion failed')).split('\n').slice(0, 3).join(' ').trim() : 'timed out' };
      } else {
        const name = first.file.suggestedFilename();
        const saved = join(work, `out-${container}-${format}-${name}`);
        await first.file.saveAs(saved);
        if (options.keep) copyFileSync(saved, join(options.keep, `${container}-${format}-${name}`));
        const streams = probe(saved);
        const video = streams.find(stream => stream.codec_type === 'video')?.codec_name;
        const audio = streams.find(stream => stream.codec_type === 'audio')?.codec_name;
        const problems = [];
        const expected = holds(container, format) ? container : 'mkv';
        if (name.split('.').pop() !== expected) problems.push(`named .${name.split('.').pop()}, expected .${expected}`);
        if (video !== inputVideo) problems.push(`video is ${video}, not ${inputVideo}`);
        if (audio !== FORMATS[format]) problems.push(`audio is ${audio}, not ${FORMATS[format]}`);
        const errors = decodeErrors(saved);
        if (errors) problems.push(`decode: ${errors}`);
        outcome = { ok: problems.length === 0, detail: problems.join('; '), name };
      }
    } catch (error) {
      outcome = { ok: false, detail: String(error.message).split('\n')[0] };
    }
    await page.close();
    results.push({ container, format, ...outcome });
    console.log(`${outcome.ok ? 'PASS' : 'FAIL'} ${label.padEnd(14)} ${outcome.name ?? ''}${outcome.detail ? `  ${outcome.detail}` : ''}`);
  }
}

await browser.close();
const failed = results.filter(result => !result.ok);
console.log(`\n${results.length - failed.length} of ${results.length} pairings passed.`);
for (const result of failed) console.log(`  FAIL ${result.container} + ${result.format}: ${result.detail}`);
process.exit(failed.length ? 1 : 0);
