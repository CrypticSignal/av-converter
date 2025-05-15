import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL, fetchFile } from '@ffmpeg/util'
import { Dispatch, SetStateAction, useRef } from 'react';
import Alert from 'react-bootstrap/Alert';
import reset from './reset';

export const convertFile = async (
  file: File,
  ffmpegArgs: string[],
  inputFilename: string,
  outputFilename: string,
  setProgress: Dispatch<SetStateAction<number>>
) => {
  showAlert('Loading @ffmpeg/core-mt...', 'warning');

  const ffmpegRef = useRef(new FFmpeg());
  const ffmpeg = ffmpegRef.current;

  const baseURL = "https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm";

  // Using toBlobURL to fix the following error:
  //SecurityError: Failed to construct 'Worker': Script at 'https://unpkg.com/@ffmpeg/core-mt@0.12.10/dist/esm/ffmpeg-core.worker.js' cannot be accessed from origin 'https://av-converter.com'.
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    workerURL: await toBlobURL(
      `${baseURL}/ffmpeg-core.worker.js`,
      'text/javascript'
    ),
  });

  ffmpeg.on('log', ({ message }) => {
    if (message === 'Aborted()') {
      reset();
      showAlert('Unable to convert file.', 'danger');
      return;
    }

    showAlert(message, 'info');
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

  showAlert(
    `The converted file should have downloaded to your device.<br>If it hasn't, click <a href="${objectURL}" download="${outputFilename}">here</a>`,
    'success'
  );

  reset();
};
