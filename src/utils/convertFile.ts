import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { Dispatch, SetStateAction } from 'react';
import { AlertColor } from '@mui/material';

export const convertFile = async (
  ffmpeg: FFmpeg,
  file: File,
  ffmpegArgs: string[],
  inputFilename: string,
  outputFilename: string,
  setProgress: Dispatch<SetStateAction<number>>,
  setAlertMessage: React.Dispatch<React.SetStateAction<string>>,
  setAlertSeverity: React.Dispatch<React.SetStateAction<AlertColor>>,
  setIsConverting: Dispatch<SetStateAction<boolean>>
) => {
  setIsConverting(true);
  try {
    setAlertSeverity('info');
    setAlertMessage('Loading @ffmpeg/core-mt...');

    const baseURL = "/ffmpeg_wasm";


// Using toBlobURL fixes the following error:
// Failed to load url /ffmpeg_wasm/ffmpeg-core.js (resolved id: /ffmpeg_wasm/ffmpeg-core.js). This file is in /public and will be copied as-is during build without going through the plugin transforms, and therefore should not be imported from source code. It can only be referenced via HTML tags.
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      workerURL: await toBlobURL(`${baseURL}/ffmpeg-core.worker.js`, 'text/javascript'),
    });

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
    const data = new Uint8Array(fileData as unknown as ArrayBuffer);
    const objectURL = URL.createObjectURL(new Blob([data.buffer]));

    const anchorTag = document.createElement('a');
    anchorTag.href = objectURL;
    anchorTag.download = outputFilename;
    anchorTag.click();

    setAlertSeverity('success');
    setAlertMessage("Done! The converted file should have started downloading.");
  } catch (error) {
    console.error(error);
    setAlertSeverity('error');
    setAlertMessage('An error occurred during conversion.');
  } finally {
    setIsConverting(false);
  }
};