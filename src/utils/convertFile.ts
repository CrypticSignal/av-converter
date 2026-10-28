import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import { Dispatch, SetStateAction } from 'react';
import { AlertColor } from '@mui/material';

const loads = new WeakMap<FFmpeg, Promise<void>>();

export const loadFFmpeg = (ffmpeg: FFmpeg, isActive = () => true): Promise<void> => {
  const existing = loads.get(ffmpeg);
  if (existing) return existing;
  const load = (async () => {
    const urls: string[] = [];
    try {
      // Create sequentially so even a partial failure releases every created URL.
      for (const [file, type] of [
        ['ffmpeg-core.js', 'text/javascript'],
        ['ffmpeg-core.wasm', 'application/wasm'],
        ['ffmpeg-core.worker.js', 'text/javascript'],
      ]) {
        if (!isActive()) throw new Error('Page unmounted');
        urls.push(await toBlobURL(`/ffmpeg_wasm/${file}`, type));
      }
      if (!isActive()) throw new Error('Page unmounted');
      await ffmpeg.load({ coreURL: urls[0], wasmURL: urls[1], workerURL: urls[2] });
    } finally {
      urls.forEach(url => URL.revokeObjectURL(url));
    }
  })();
  loads.set(ffmpeg, load);
  // A failed load can be retried; successful loads stay cached per instance.
  void load.catch(() => { if (loads.get(ffmpeg) === load) loads.delete(ffmpeg); });
  return load;
};

export const convertFile = async (
  ffmpeg: FFmpeg,
  file: File,
  ffmpegArgs: string[],
  inputFilename: string,
  outputFilename: string,
  setProgress: Dispatch<SetStateAction<number>>,
  setAlertMessage: Dispatch<SetStateAction<string>>,
  setAlertSeverity: Dispatch<SetStateAction<AlertColor>>,
  setIsConverting: Dispatch<SetStateAction<boolean>>,
  isActive = () => true,
) => {
  const checkActive = () => { if (!isActive()) throw new Error('Page unmounted'); };
  const onLog = ({ message }: { message: string }) => {
    if (!isActive()) return;
    setAlertSeverity(message === 'Aborted()' ? 'error' : 'info');
    setAlertMessage(message === 'Aborted()' ? 'Unable to convert file.' : message);
  };
  const onProgress = ({ progress }: { progress: number }) => {
    if (isActive()) setProgress(Math.round(progress * 100 * 10) / 10);
  };
  let filesTouched = false;
  try {
    checkActive();
    setIsConverting(true);
    setAlertSeverity('info');
    setAlertMessage('Loading @ffmpeg/core-mt...');
    await loadFFmpeg(ffmpeg, isActive);
    checkActive();
    ffmpeg.on('log', onLog);
    ffmpeg.on('progress', onProgress);
    filesTouched = true;
    // Never allow a failed execution to download a previous conversion's output.
    await ffmpeg.deleteFile(outputFilename).catch(() => {});
    checkActive();
    const input = await fetchFile(file);
    checkActive();
    await ffmpeg.writeFile(inputFilename, input);
    checkActive();
    const exitCode = await ffmpeg.exec(ffmpegArgs);
    checkActive();
    if (exitCode !== 0) throw new Error(`FFmpeg exited with code ${exitCode}`);
    setProgress(0);
    const fileData = await ffmpeg.readFile(outputFilename);
    checkActive();
    const data = new Uint8Array(fileData as Uint8Array);
    const objectURL = URL.createObjectURL(new Blob([data.buffer]));
    try {
      const anchor = document.createElement('a');
      anchor.href = objectURL;
      anchor.download = outputFilename;
      anchor.click();
    } finally {
      setTimeout(() => URL.revokeObjectURL(objectURL), 100);
    }
    setAlertSeverity('success');
    setAlertMessage('Done! The converted file should have started downloading.');
  } catch (error) {
    if (isActive()) {
      console.error(error);
      setAlertSeverity('error');
      setAlertMessage('An error occurred during conversion.');
    }
  } finally {
    ffmpeg.off('log', onLog);
    ffmpeg.off('progress', onProgress);
    if (filesTouched) {
      // Missing files and a terminated worker are expected cleanup cases.
      for (const name of new Set([inputFilename, outputFilename])) {
        try { await ffmpeg.deleteFile(name); } catch { /* best effort */ }
      }
    }
    if (isActive()) setIsConverting(false);
  }
};
