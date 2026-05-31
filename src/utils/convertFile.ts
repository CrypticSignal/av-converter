import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { Dispatch, SetStateAction } from 'react';
import { AlertColor } from '@mui/material';

const MULTITHREAD_LOAD_TIMEOUT_MS = 8000;
const appAssetURL = (path: string) => new URL(path, window.location.origin).toString();

const withTimeout = async <T,>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
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
  setIsConverting: Dispatch<SetStateAction<boolean>>
) => {
  setIsConverting(true);
  try {
    const isCrossOriginIsolated = typeof window !== 'undefined' ? window.crossOriginIsolated : false;
    const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const canUseMultithreadCore = isCrossOriginIsolated && hasSharedArrayBuffer && !isMobile;

    if (canUseMultithreadCore) {
      try {
        setAlertSeverity('info');
        setAlertMessage('Loading multithread FFmpeg core...');

        await withTimeout(
          ffmpeg.load({
            coreURL: await toBlobURL(appAssetURL('/ffmpeg_wasm/ffmpeg-core.js'), 'text/javascript'),
            wasmURL: await toBlobURL(appAssetURL('/ffmpeg_wasm/ffmpeg-core.wasm'), 'application/wasm'),
            workerURL: await toBlobURL(appAssetURL('/ffmpeg_wasm/ffmpeg-core.worker.js'), 'text/javascript'),
          }),
          MULTITHREAD_LOAD_TIMEOUT_MS,
          'Timed out while loading multithread core',
        );
      } catch (error) {
        console.warn('Falling back to single-thread core after multithread load failure.', error);
        setAlertSeverity('info');
        setAlertMessage('Falling back to single-thread FFmpeg core...');
        await ffmpeg.load({
          coreURL: await toBlobURL(appAssetURL('/ffmpeg_wasm_single/ffmpeg-core.js'), 'text/javascript'),
          wasmURL: await toBlobURL(appAssetURL('/ffmpeg_wasm_single/ffmpeg-core.wasm'), 'application/wasm'),
        });
      }
    } else {
      setAlertSeverity('info');
      setAlertMessage(isMobile ? 'Loading mobile-safe FFmpeg core...' : 'Loading single-thread FFmpeg core...');
      await ffmpeg.load({
        coreURL: await toBlobURL(appAssetURL('/ffmpeg_wasm_single/ffmpeg-core.js'), 'text/javascript'),
        wasmURL: await toBlobURL(appAssetURL('/ffmpeg_wasm_single/ffmpeg-core.wasm'), 'application/wasm'),
      });
    }

    ffmpeg.on('log', ({ message }) => {
      if (message === 'Aborted()') {
        setAlertSeverity('error');
        setAlertMessage('Unable to convert file.');
        return;
      }

      setAlertSeverity('info');
      setAlertMessage(message);
    });

    ffmpeg.on('progress', ({ progress }) => {
      progress = Math.round(progress * 100 * 10) / 10;
      setProgress(progress);
    });

    await ffmpeg.writeFile(inputFilename, await fetchFile(file));

    await ffmpeg.exec(ffmpegArgs);

    setProgress(0);

    const fileData = await ffmpeg.readFile(outputFilename);
    const data = new Uint8Array(fileData as Uint8Array);
    const objectURL = URL.createObjectURL(new Blob([data.buffer]));

    const anchorTag = document.createElement('a');
    anchorTag.href = objectURL;
    anchorTag.download = outputFilename;
    anchorTag.click();

    setTimeout(() => {
      URL.revokeObjectURL(objectURL);
    }, 100);

    setAlertSeverity('success');
    setAlertMessage("Done! The converted file should have started downloading.");
  } catch (error) {
    console.error(error);
    setAlertSeverity('error');
    const errorText = error instanceof Error ? error.message : String(error);
    setAlertMessage(`An error occurred during conversion: ${errorText}`);
  } finally {
    setIsConverting(false);
  }
};
