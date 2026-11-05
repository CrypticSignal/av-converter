import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { canUseThreads, convertFile, loadFFmpeg, type ConvertedFile } from '../utils/convertFile';
import OperationStatus from '../components/OperationStatus';
import type { OperationProgress } from '../utils/progress';
import Button from '@mui/material/Button';
import { createFFmpegArgs } from '../utils/createFFmpegArgs';
import { formatCommand, parseArgs } from '../utils/parseArgs';
import { formatBytes } from '../utils/progress';
import { loadSettings, saveSettings } from '../utils/savedSettings';
import { probeFile } from '../utils/probeFile';
import MediaInfoPanel, { type MediaInfoState } from '../components/MediaInfoPanel';
import { FORMATS, bitrateFor, type Codec, type FormatSettings, type StringSetting } from '../formats';
// General Components
import FileInput from '../components/FileInput';
import FormatSelector from '../components/FormatSelector';
import IsKeepVideo from '../components/IsKeepVideo';
import YesNoRadio from '../components/YesNoRadio';
// Images
import ffmpegLogo from '../images/ffmpeg-25.png';
import webAssemblyLogo from '../images/webassembly-25.png';
// Material UI
import Alert, { AlertColor } from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';

/** The largest input the in-browser FFmpeg can reliably handle. */
export const MAX_FILE_BYTES = 2 * 1024 ** 3;

const withoutExtension = (filename: string) =>
  filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;

/**
 * The output is read back by the name the command ends with, so reject names that
 * FFmpeg would treat as an option, write somewhere else, or couldn't pick a format for.
 */
const checkManualOutputFilename = (name: string, hasFormatOption: boolean) => {
  if (name.startsWith('-')) {
    throw new Error(`The command must end with the output filename (e.g. output.mp4), not the option ${name}.`);
  }
  if (/[/\\]/.test(name)) throw new Error(`The output filename ${name} can't include a folder.`);
  if (/[:*?"<>|\u0000-\u001f]/.test(name)) {
    throw new Error(`The output filename ${name} contains characters that aren't allowed in filenames.`);
  }
  if (!hasFormatOption && !/\.[^.]+$/.test(name)) {
    throw new Error(`The output filename ${name} needs an extension, such as .mp4, so FFmpeg knows which format to write.`);
  }
};

/** Build the arguments for manual mode, where the user types everything after `ffmpeg -i <input>`. */
const manualCommandArgs = (inputFilename: string, command: string) => {
  const restOfArgs = parseArgs(command);
  if (restOfArgs.length === 0) throw new Error('Please enter the rest of the command.');

  // https://github.com/ffmpegwasm/ffmpeg.wasm/issues/597
  // Directly after the input, -threads is always an option of the first output,
  // whatever the user's command ends with.
  const encodesVideo = restOfArgs.some(arg => ['-c:v', '-c:V', '-codec:v', '-vcodec'].includes(arg));
  const threads = encodesVideo && canUseThreads() && !navigator.userAgent.toLowerCase().includes('firefox')
    ? ['-threads', '4'] : [];

  const ffmpegArgs = ['-i', inputFilename, ...threads, ...restOfArgs];
  const outputFilename = ffmpegArgs[ffmpegArgs.length - 1];
  checkManualOutputFilename(outputFilename, restOfArgs.includes('-f'));
  return { ffmpegArgs, outputFilename };
};

const Homepage = (): React.JSX.Element => {
  const [alert, setAlert] = useState<{ severity: AlertColor; message: string } | null>(null);
  // Start from the format and settings used last time.
  const [saved] = useState(loadSettings);
  const [codec, setCodec] = useState<Codec>(saved.codec);
  const [settings, setSettings] = useState<FormatSettings>(saved.settings);
  const [ffmpegCommand, setFfmpegCommand] = useState('');
  const [file, setFile] = useState<File | undefined>(undefined);
  const [outputName, setOutputName] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [manualCommandInput, setManualCommandInput] = useState('');
  const [manualMode, setManualMode] = useState(false);
  // Conversion progress.
  const [status, setStatus] = useState<OperationProgress>({ stage: 'Ready' });
  const [logs, setLogs] = useState('');
  // What ffprobe found in the selected file; a token ignores results for an older file.
  const [mediaInfo, setMediaInfo] = useState<MediaInfoState | null>(null);
  const probeToken = useRef<object | null>(null);
  // The last converted file, kept so it can be downloaded again. Its URL is revoked
  // when it is replaced and when the page unmounts.
  const [output, setOutputState] = useState<ConvertedFile | null>(null);
  const outputURL = useRef<string | null>(null);
  const setOutput = (next: ConvertedFile | null) => {
    if (outputURL.current) URL.revokeObjectURL(outputURL.current);
    outputURL.current = next?.url ?? null;
    setOutputState(next);
  };
  // The FFmpeg worker, and a token for the running conversion. Callbacks from a
  // conversion are ignored once either is replaced (on cancel or unmount).
  const ffmpegRef = useRef<FFmpeg | null>(null);
  const session = useRef<object | null>(null);

  const stopWorker = () => {
    session.current = null;
    const current = ffmpegRef.current;
    ffmpegRef.current = null;
    current?.terminate();
  };

  useEffect(() => {
    ffmpegRef.current = new FFmpeg();
    return () => {
      stopWorker();
      if (outputURL.current) URL.revokeObjectURL(outputURL.current);
      outputURL.current = null;
    };
  }, []);

  useEffect(() => saveSettings({ codec, settings }), [codec, settings]);

  const inputFilename = file?.name ?? '';
  const format = FORMATS[codec];
  const update = <K extends keyof FormatSettings>(key: K, value: FormatSettings[K]) =>
    setSettings(previous => ({ ...previous, [key]: value }));
  const onSettingChange = (key: StringSetting) => (value: string) => update(key, value);
  const bitrate = format.bitrate && {
    min: format.bitrate.min,
    max: format.bitrate.max,
    step: format.bitrate.step,
    value: bitrateFor(codec, settings),
    onChange: (value: string) => update('bitrates', { ...settings.bitrates, [codec]: value }),
  };

  const onFile = (currentFile: File | undefined) => {
    probeToken.current = null;
    setMediaInfo(null);
    if (currentFile && currentFile.size > MAX_FILE_BYTES) {
      setFile(undefined);
      setAlert({ severity: 'error', message:
        `${currentFile.name} is ${formatBytes(currentFile.size)}. The maximum file size is ${formatBytes(MAX_FILE_BYTES)}.` });
      return;
    }
    setFile(currentFile);
    if (!currentFile) return;
    setAlert(null);
    setOutputName(withoutExtension(currentFile.name));
    // Fetch the ~30 MB core while the user picks settings. Failures are retried on convert.
    const instance = ffmpegRef.current ?? new FFmpeg();
    ffmpegRef.current = instance;
    void loadFFmpeg(instance, () => ffmpegRef.current === instance).catch(() => {});
    // Then show the file's duration and streams. A conversion started meanwhile is
    // unaffected: the worker runs one command at a time and the probe uses its own paths.
    const token = {};
    probeToken.current = token;
    const probeActive = () => probeToken.current === token && ffmpegRef.current === instance;
    setMediaInfo({ status: 'loading' });
    probeFile(instance, currentFile, probeActive).then(
      info => { if (probeActive()) setMediaInfo({ status: 'ready', info }); },
      () => { if (probeActive()) setMediaInfo({ status: 'failed' }); },
    );
  };

  const cancel = () => {
    stopWorker();
    setIsConverting(false);
    setAlert({ severity: 'info', message: 'Conversion cancelled.' });
    setStatus({ stage: 'Cancelled' });
  };

  const onConvertClicked = () => {
    if (session.current) return;
    if (file === undefined) {
      setAlert({ severity: 'error', message: 'You must select an input file.' });
      return;
    }
    if (!manualMode && !outputName.trim()) {
      setAlert({ severity: 'error', message: 'Please enter an output filename.' });
      return;
    }

    setAlert(null);
    setFfmpegCommand('');

    let ffmpegArgs: string[];
    let outputFilename: string;
    try {
      ({ ffmpegArgs, outputFilename } = manualMode
        ? manualCommandArgs(file.name, manualCommandInput)
        : createFFmpegArgs(file.name, codec, settings, outputName.trim()));
    } catch (error) {
      setAlert({ severity: 'error', message: (error as Error).message });
      return;
    }

    setFfmpegCommand(`ffmpeg ${formatCommand(ffmpegArgs)}`);
    const ffmpeg = ffmpegRef.current ?? new FFmpeg();
    ffmpegRef.current = ffmpeg;
    const currentSession = {};
    session.current = currentSession;
    const isActive = () => session.current === currentSession && ffmpegRef.current === ffmpeg;
    setLogs('');
    setOutput(null);
    setIsConverting(true);
    void convertFile(ffmpeg, {
      file,
      ffmpegArgs,
      outputFilename,
      knownTimeline: !manualMode,
      isActive,
      onAlert: (severity, message) => setAlert({ severity, message }),
      onStatus: setStatus,
      onLog: message => setLogs(previous => (previous + message + '\n').slice(-100_000)),
      onOutput: converted => {
        if (isActive()) setOutput(converted);
        else URL.revokeObjectURL(converted.url);
      },
    }).finally(() => {
      if (!isActive()) return;
      session.current = null;
      setIsConverting(false);
    });
  };

  return (
    <>
        <div className="bg-black text-white text-center">
            <h1 className="text-4xl font-sans mt-0 mb-0 pt-5 pb-1">Audio / Video Converter</h1>
            <div className="text-sm mb-5 flex items-center justify-center">
                <i className="mr-1">Powered by FFmpeg</i>
                <a href="https://ffmpeg.org/" target="_blank" rel="noreferrer" className="inline-block align-middle mr-1">
                <img src={ffmpegLogo} alt="ffmpeg logo" className="h-6 w-6" />
                </a>
                <i className="mr-1">and WebAssembly</i>
                <a href="https://webassembly.org/" target="_blank" rel="noreferrer" className="inline-block align-middle">
                <img src={webAssemblyLogo} alt="web assembly logo" className="h-6 w-6" />
                </a>
            </div>
        </div>
      <FileInput onFile={onFile} filename={inputFilename} />
      {mediaInfo && <MediaInfoPanel state={mediaInfo} />}
      <Typography variant="caption" sx={{ display: 'block' }}>
        Max file size: {formatBytes(MAX_FILE_BYTES)}
      </Typography>
      <Divider sx={{ my: 2 }} />

      <FormControlLabel
        control={<Checkbox checked={manualMode} onChange={(_, checked) => setManualMode(checked)} />}
        label="Manual FFmpeg Command"
      />

      <Divider sx={{ my: 2 }} />

      {manualMode ? (
        <div className="my-4 w-full max-w-xl mx-auto px-4">
          <Typography variant="h5" component="h2" gutterBottom>
            Enter FFmpeg Command
          </Typography>
          <TextField
            id="manual_command"
            label="Rest of the command"
            value={manualCommandInput}
            onChange={e => setManualCommandInput(e.target.value)}
            placeholder="-c:v libx264 output.mp4"
            helperText={<>Enter everything after the input, ending with the output filename (e.g. <code>-c:v libx264 output.mp4</code>).</>}
            fullWidth
            autoComplete="off"
            slotProps={{
              inputLabel: { shrink: true },
              input: {
                startAdornment: (
                  <InputAdornment position="start" title={`ffmpeg -i ${inputFilename || 'input.mp4'}`}
                    sx={{ maxWidth: '50%', flexShrink: 0, overflow: 'hidden' }}>
                    <span className="block whitespace-nowrap overflow-hidden text-ellipsis">
                      ffmpeg -i {inputFilename || 'input.mp4'}
                    </span>
                  </InputAdornment>
                ),
              },
            }}
          />
        </div>
      ) : (
        <>
          <FormatSelector onCodecChange={setCodec} codec={codec} />
          <Divider sx={{ my: 2 }} />

          <Typography variant="h5" component="h2" gutterBottom>
            Encoder Settings
          </Typography>

          <format.Panel settings={settings} onChange={onSettingChange} bitrate={bitrate} />
          {format.keepVideo && (
            <IsKeepVideo onIsKeepVideoChange={value => update('isKeepVideo', value)} isKeepVideo={settings.isKeepVideo} />
          )}

          {!format.copiesAudio && (
            <div>
              <YesNoRadio name="downmix" label="Downmix to stereo?" value={settings.downmixToStereo}
                onChange={value => update('downmixToStereo', value)} />
            </div>
          )}
          <Divider sx={{ my: 2 }} />

          <TextField
            id="output_name"
            label="Output filename"
            value={outputName}
            onChange={e => setOutputName(e.target.value)}
            autoComplete="off"
            size="small"
            fullWidth
            sx={{ maxWidth: 320, my: 1.5 }}
            slotProps={{ htmlInput: { maxLength: 200 }, inputLabel: { shrink: true } }}
          />
        </>
      )}

      <div className={`text-center my-4 ${isConverting ? 'block' : 'hidden'}`}>
        {ffmpegCommand && <>Running: {ffmpegCommand}...</>}
      </div>

      <OperationStatus progress={status} busy={isConverting} logs={logs} />
      {isConverting && <Button onClick={cancel}>Cancel</Button>}
      {alert && <div className="w-full max-w-xs mx-auto"><Alert severity={alert.severity} sx={{ textAlign: 'center', my: 2, display: 'flex', justifyContent: 'center' }}>{alert.message}</Alert></div>}
      {output && !isConverting && (
        <Typography variant="body2">
          If the download didn't start,{' '}
          <a href={output.url} download={output.filename} className="underline text-sky-700">
            download {output.filename}
          </a>{' '}
          ({formatBytes(output.size)}).
        </Typography>
      )}

      <div className={`mt-4 ${!isConverting ? 'block' : 'hidden'}`}>
        <Button variant="contained" onClick={onConvertClicked}>Convert</Button>
      </div>
    </>
  );
};

export default Homepage;
