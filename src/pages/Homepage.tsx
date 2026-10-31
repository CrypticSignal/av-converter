import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { convertFile, loadFFmpeg } from '../utils/convertFile';
import OperationStatus from '../components/OperationStatus';
import type { OperationProgress } from '../utils/progress';
import Button from '@mui/material/Button';
import { createFFmpegArgs } from '../utils/createFFmpegArgs';
import { parseArgs } from '../utils/parseArgs';
import { DEFAULT_SETTINGS, FORMATS, bitrateFor, type Codec, type FormatSettings, type StringSetting } from '../formats';
// General Components
import FileInput from '../components/FileInput';
import FormatSelector from '../components/FormatSelector';
import IsKeepVideo from '../components/IsKeepVideo';
// Images
import ffmpegLogo from '../images/ffmpeg-25.png';
import webAssemblyLogo from '../images/webassembly-25.png';
// Material UI
import Alert, { AlertColor } from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';

const withoutExtension = (filename: string) =>
  filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;

/** Build the arguments for manual mode, where the user types everything after `ffmpeg -i <input>`. */
const manualCommandArgs = (inputFilename: string, command: string) => {
  const restOfArgs = parseArgs(command);
  if (restOfArgs.length === 0) throw new Error('Please enter the rest of the command.');

  // https://github.com/ffmpegwasm/ffmpeg.wasm/issues/597
  // Directly after the input, -threads is always an option of the first output,
  // whatever the user's command ends with.
  const encodesVideo = restOfArgs.some(arg => ['-c:v', '-c:V', '-codec:v', '-vcodec'].includes(arg));
  const threads = encodesVideo && !navigator.userAgent.toLowerCase().includes('firefox') ? ['-threads', '4'] : [];

  const ffmpegArgs = ['-i', inputFilename, ...threads, ...restOfArgs];
  const outputFilename = ffmpegArgs[ffmpegArgs.length - 1];
  if (!outputFilename) throw new Error('Could not parse output filename from command.');
  return { ffmpegArgs, outputFilename };
};

const Homepage = (): React.JSX.Element => {
  const [alert, setAlert] = useState<{ severity: AlertColor; message: string } | null>(null);
  const [codec, setCodec] = useState<Codec>('MP3');
  const [settings, setSettings] = useState<FormatSettings>(DEFAULT_SETTINGS);
  const [ffmpegCommand, setFfmpegCommand] = useState('');
  const [file, setFile] = useState<File | undefined>(undefined);
  const [outputName, setOutputName] = useState('');
  const [isConverting, setIsConverting] = useState(false);
  const [manualCommandInput, setManualCommandInput] = useState('');
  const [manualMode, setManualMode] = useState(false);
  // Conversion progress.
  const [status, setStatus] = useState<OperationProgress>({ stage: 'Ready' });
  const [logs, setLogs] = useState('');
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
    return stopWorker;
  }, []);

  const inputFilename = file?.name ?? '';
  const format = FORMATS[codec];
  const update = <K extends keyof FormatSettings>(key: K, value: FormatSettings[K]) =>
    setSettings(previous => ({ ...previous, [key]: value }));
  const onSettingChange = (key: StringSetting) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => update(key, e.currentTarget.value);
  // Radio pairs with "yes" and "no" values.
  const onYesNoChange = (key: 'isKeepVideo' | 'downmixToStereo') =>
    (e: React.ChangeEvent<HTMLInputElement>) => update(key, e.currentTarget.value === 'yes');
  const bitrate = format.bitrate && {
    min: format.bitrate.min,
    max: format.bitrate.max,
    step: format.bitrate.step,
    value: bitrateFor(codec, settings),
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      update('bitrates', { ...settings.bitrates, [codec]: e.currentTarget.value }),
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const currentFile = e.currentTarget.files?.[0];
    setFile(currentFile);
    if (!currentFile) return;
    setOutputName(withoutExtension(currentFile.name));
    // Fetch the ~30 MB core while the user picks settings. Failures are retried on convert.
    const instance = ffmpegRef.current;
    if (instance) void loadFFmpeg(instance, () => ffmpegRef.current === instance).catch(() => {});
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

    console.clear();
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

    setFfmpegCommand(`ffmpeg ${ffmpegArgs.join(' ')}`);
    const ffmpeg = ffmpegRef.current ?? new FFmpeg();
    ffmpegRef.current = ffmpeg;
    const currentSession = {};
    session.current = currentSession;
    const isActive = () => session.current === currentSession && ffmpegRef.current === ffmpeg;
    setLogs('');
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
      <FileInput onFileInput={onFileInput} filename={inputFilename} />
      <Typography variant="caption" display="block">
        Max Filesize: 2 GB
      </Typography>
      <Divider sx={{ my: 2 }} />

      <div className="my-4 text-center">
        <label className="inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            className="form-checkbox h-5 w-5 text-sky-600"
            checked={manualMode}
            onChange={(e) => setManualMode(e.target.checked)}
          />
          <span className="ml-2 text-black">Manual FFmpeg Command</span>
        </label>
      </div>

      <Divider sx={{ my: 2 }} />

      {manualMode ? (
        <div className="my-4 w-full max-w-xl mx-auto">
          <Typography variant="h5" component="h2" gutterBottom>
            Enter FFmpeg Command
          </Typography>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            Enter the rest of the command (e.g. <code>-c:v libx264 output.mp4</code>).
          </Typography>
          <div className="flex items-stretch mt-1">
            <span
              className="bg-gray-200 border border-gray-300 border-r-0 rounded-l-md px-3 py-2 text-sm text-gray-700 whitespace-nowrap overflow-hidden text-ellipsis shrink-0 max-w-[150px] sm:max-w-[250px]"
              title={`ffmpeg -i "${inputFilename || 'input.mp4'}"`}
            >
              ffmpeg -i {inputFilename || 'input.mp4'}
            </span>
            <input
              type="text"
              className="flex-1 block w-full px-3 py-2 bg-white border border-gray-300 rounded-r-md text-sm shadow-sm placeholder-gray-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 text-black min-w-[100px]"
              value={manualCommandInput}
              onChange={(e) => setManualCommandInput(e.target.value)}
              placeholder="-c:v libx264 output.mp4"
            />
          </div>
        </div>
      ) : (
        <>
          <FormatSelector onCodecChange={e => setCodec(e.currentTarget.value as Codec)} codec={codec} />
          <Divider sx={{ my: 2 }} />

          <Typography variant="h5" component="h2" gutterBottom>
            Encoder Settings
          </Typography>

          <format.Panel settings={settings} onChange={onSettingChange} bitrate={bitrate} />
          {format.keepVideo && (
            <IsKeepVideo onIsKeepVideoChange={onYesNoChange('isKeepVideo')} isKeepVideo={settings.isKeepVideo} />
          )}
          
          {!format.copiesAudio && (
            <div className="my-4">
              <Typography variant="subtitle1" component="h3" gutterBottom>
                Downmix to stereo?
              </Typography>
              <label className="mr-4">
                <input
                  type="radio"
                  name="downmix"
                  value="yes"
                  checked={settings.downmixToStereo}
                  onChange={onYesNoChange('downmixToStereo')}
                  className="mr-1"
                />
                Yes
              </label>
              <label>
                <input
                  type="radio"
                  name="downmix"
                  value="no"
                  checked={!settings.downmixToStereo}
                  onChange={onYesNoChange('downmixToStereo')}
                  className="mr-1"
                />
                No
              </label>
            </div>
          )}
          <Divider sx={{ my: 2 }} />

          <Typography variant="h5" component="h2" gutterBottom>
            Output Filename
          </Typography>
          <input
            type="text"
            autoComplete="off"
            className="mt-1 block w-full max-w-xs mx-auto px-3 py-2 bg-white border border-gray-300 rounded-md text-sm shadow-sm placeholder-gray-400 focus:outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:bg-gray-50 disabled:text-gray-500 disabled:border-gray-200 disabled:shadow-none invalid:border-pink-500 invalid:text-pink-600 focus:invalid:border-pink-500 focus:invalid:ring-pink-500 text-black"
            maxLength={200}
            id="output_name"
            value={outputName}
            onChange={e => setOutputName(e.target.value)}
          />
        </>
      )}

      <div className={`text-center my-4 ${isConverting ? 'block' : 'hidden'}`}>
        {ffmpegCommand && <>Running: {ffmpegCommand}...</>}
      </div>

      <OperationStatus progress={status} busy={isConverting} logs={logs} />
      {isConverting && <Button onClick={cancel}>Cancel</Button>}
      {alert && <div className="w-full max-w-xs mx-auto"><Alert severity={alert.severity} sx={{ textAlign: 'center', my: 2, display: 'flex', justifyContent: 'center' }}>{alert.message}</Alert></div>}

      <div className={`mt-4 ${!isConverting ? 'block' : 'hidden'}`}>
        <Button variant="contained" onClick={onConvertClicked}>Convert</Button>
      </div>
    </>
  );
};

export default Homepage;
