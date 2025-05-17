import type { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util'
import { Dispatch, SetStateAction } from 'react';
import reset from './reset';
import { AlertColor } from '@mui/material';

export const convertFile = async (
  ffmpeg: FFmpeg,
  file: File,
  ffmpegArgs: string[],
  inputFilename: string,
  outputFilename: string,
  setProgress: Dispatch<SetStateAction<number>>,
  setAlertMessage: React.Dispatch<React.SetStateAction<string>>,
  setAlertSeverity: React.Dispatch<React.SetStateAction<AlertColor>>
) => {
  setAlertSeverity('info');
  setAlertMessage('Loading @ffmpeg/core-mt...');

  const baseURL = "/ffmpeg_wasm";

  await ffmpeg.load({
    coreURL: `${baseURL}/ffmpeg-core.js`,
    wasmURL: `${baseURL}/ffmpeg-core.wasm`,
    workerURL: `${baseURL}/ffmpeg-core.worker.js`
  });

  ffmpeg.on('log', ({ message }) => {
    if (message === 'Aborted()') {
      reset();
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

  document.getElementById('converting_spinner')!.style.display = 'block';
  document.getElementById('conversion_progress')!.style.display = 'block';

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

  reset();
};