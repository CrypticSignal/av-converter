/**
 * The converter page. The user picks a file and either a format with its settings, or types
 * their own FFmpeg command. FFmpeg (compiled to WebAssembly) then converts the file inside
 * the browser and the result is downloaded. Nothing is uploaded to a server.
 *
 * The formats and their settings are defined in src/formats.tsx; this page only shows
 * whichever format is selected.
 */
import React, { useState, useRef, useEffect } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { convertFile, loadFFmpeg, type ConvertedFile } from '../utils/convertFile';
import OperationStatus from '../components/OperationStatus';
import type { OperationProgress } from '../utils/progress';
import Button from '@mui/material/Button';
import { allowsAllAudioTracks, createFFmpegArgs, type AudioTrack } from '../utils/createFFmpegArgs';
import { formatCommand } from '../utils/parseArgs';
import { manualCommandArgs } from '../utils/manualCommand';
import { formatBytes } from '../utils/progress';
import { loadSettings, saveSettings } from '../utils/savedSettings';
import { probeFile, type StreamInfo } from '../utils/probeFile';
import MediaInfoPanel, { type MediaInfoState } from '../components/MediaInfoPanel';
import { FORMATS, type Codec, type FormatSettings, type SetSetting } from '../formats';
// General Components
import FileInput from '../components/FileInput';
import SelectField from '../components/SelectField';
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

/** The largest input the in-browser FFmpeg can reliably handle (2 GiB). */
const MAX_FILE_BYTES = 2 * 1024 ** 3;

/** "song.final.wav" -> "song.final". Used as the default output filename. */
const withoutExtension = (filename: string) =>
  filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;

/** An audio track's name in the track picker, e.g. "Stream 1 (aac) — eng, 48000 Hz, 5.1". */
const trackLabel = (stream: StreamInfo) =>
  `Stream ${stream.index}`
  + (stream.codec ? ` (${stream.codec})` : '')
  + (stream.details.length ? ` — ${stream.details.join(', ')}` : '');

const Homepage = (): React.JSX.Element => {
  // ---------------------------------------------------------------------------
  // State. Changing any of these re-renders the page.
  // ---------------------------------------------------------------------------

  // The message box under the status (an error, "Converting", "Done!", ...).
  const [alert, setAlert] = useState<{ severity: AlertColor; message: string } | null>(null);

  // The chosen format (e.g. 'MP3') and every format's settings (see FormatSettings in formats.tsx).
  // Both start from what the visitor used last time. Passing loadSettings itself (not
  // loadSettings()) makes React call it only on the first render.
  const [saved] = useState(loadSettings);
  const [codec, setCodec] = useState<Codec>(saved.codec);
  const [settings, setSettings] = useState<FormatSettings>(saved.settings);

  // The command being run, shown while converting.
  const [ffmpegCommand, setFfmpegCommand] = useState('');
  // The selected input file.
  const [file, setFile] = useState<File | undefined>(undefined);
  // The output filename without its extension; the extension comes from the format.
  const [outputName, setOutputName] = useState('');
  // The audio track the user picked, or null for the format's default (see audioTrack below).
  // Track numbers only make sense for this file, so unlike the settings this isn't saved.
  const [chosenTrack, setChosenTrack] = useState<AudioTrack | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // Manual mode: the user types everything after `ffmpeg -i <input>` themselves.
  const [manualCommandInput, setManualCommandInput] = useState('');
  const [manualMode, setManualMode] = useState(false);

  // Conversion progress and FFmpeg's log output, shown by <OperationStatus>.
  const [status, setStatus] = useState<OperationProgress>({ stage: 'Ready' });
  const [logs, setLogs] = useState('');

  // What ffprobe found in the selected file (duration, format, streams).
  const [mediaInfo, setMediaInfo] = useState<MediaInfoState | null>(null);
  // Identifies the latest probe, so a slow probe of a previous file can't overwrite the
  // current file's information. (useRef holds a value without re-rendering when it changes.)
  const probeToken = useRef<object | null>(null);

  // The last converted file, kept so it can be downloaded again from the link on the page.
  const [output, setOutput] = useState<ConvertedFile | null>(null);
  // The file is held in memory behind an object URL. Free it when it's replaced or the
  // page closes. (The function an effect returns runs before the next effect, and on unmount.)
  useEffect(() => () => {
    if (output) URL.revokeObjectURL(output.url);
  }, [output]);

  // The FFmpeg instance, which runs in a background worker.
  const ffmpegRef = useRef<FFmpeg | null>(null);
  // Identifies the running conversion. Cancelling sets it to null, and from then on
  // that conversion's progress updates are ignored (see isActive in onConvertClicked).
  const session = useRef<object | null>(null);

  /** Stop FFmpeg immediately. Its worker can't be interrupted any other way. */
  const stopWorker = () => {
    session.current = null;
    const current = ffmpegRef.current;
    ffmpegRef.current = null;
    current?.terminate();
  };

  // Create FFmpeg when the page opens, and stop it when the visitor leaves the page.
  useEffect(() => {
    ffmpegRef.current = new FFmpeg();
    return stopWorker;
  }, []);

  // Remember the format and settings for next time, whenever they change.
  useEffect(() => saveSettings({ codec, settings }), [codec, settings]);

  // ---------------------------------------------------------------------------
  // Values worked out from the state on every render.
  // ---------------------------------------------------------------------------

  const inputFilename = file?.name ?? '';
  // The selected format's entry in formats.tsx: its label, extension, args, Panel and flags.
  const format = FORMATS[codec];
  // The selected file's audio tracks, once ffprobe has read it.
  const audioStreams = mediaInfo?.status === 'ready'
    ? mediaInfo.info.streams.filter(stream => stream.type === 'audio') : [];
  // Whether the output can hold every audio track (MKA, or when keeping the video).
  const allowsAll = allowsAllAudioTracks(codec, settings);
  // The audio track that will be converted: the user's choice, else all tracks for MKA and the
  // first track for every other format. "All" falls back to the first track if the user then
  // switches to a format that holds only one.
  const audioTrack: AudioTrack = chosenTrack === 'all' && !allowsAll ? 0
    : chosenTrack ?? (format.allAudioTracks ? 'all' : 0);
  // Change one setting, e.g. update('mp3Bitrate', '256'). It copies the settings object
  // rather than editing it, because React only notices a change when it gets a new object.
  const update: SetSetting = (key, value) => setSettings(previous => ({ ...previous, [key]: value }));

  // ---------------------------------------------------------------------------
  // Event handlers.
  // ---------------------------------------------------------------------------

  /** Called when a file is picked or dropped. */
  const onFile = (currentFile: File | undefined) => {
    // The input can't change during a conversion.
    if (session.current) return;
    // Forget the previous file's information and track choice.
    probeToken.current = null;
    setMediaInfo(null);
    setChosenTrack(null);
    if (currentFile && currentFile.size > MAX_FILE_BYTES) {
      setFile(undefined);
      setAlert({ severity: 'error', message:
        `${currentFile.name} is ${formatBytes(currentFile.size)}. The maximum file size is ${formatBytes(MAX_FILE_BYTES)}.` });
      return;
    }
    setFile(currentFile);
    if (!currentFile) return;
    setAlert(null);
    // Suggest the input's name as the output name, e.g. "song.wav" -> "song".
    setOutputName(withoutExtension(currentFile.name));
    // Start downloading FFmpeg (~30 MB) while the user picks settings. If it fails,
    // it's tried again when they click Convert.
    const instance = ffmpegRef.current ?? new FFmpeg();
    ffmpegRef.current = instance;
    void loadFFmpeg(instance, () => ffmpegRef.current === instance).catch(() => {});
    // Then read the file's duration and streams with ffprobe. This can't interfere with a
    // conversion: FFmpeg runs one command at a time, and the probe uses its own files.
    const token = {};
    probeToken.current = token;
    // False once another file is chosen or FFmpeg is stopped, so stale results are dropped.
    const probeActive = () => probeToken.current === token && ffmpegRef.current === instance;
    setMediaInfo({ status: 'loading' });
    probeFile(instance, currentFile, probeActive).then(
      info => { if (probeActive()) setMediaInfo({ status: 'ready', info }); },
      () => { if (probeActive()) setMediaInfo({ status: 'failed' }); },
    );
  };

  /** Cancel the running conversion by stopping FFmpeg. A new instance is created on the next Convert. */
  const cancel = () => {
    stopWorker();
    setIsConverting(false);
    setAlert({ severity: 'info', message: 'Conversion cancelled.' });
    setStatus({ stage: 'Cancelled' });
  };

  const onConvertClicked = () => {
    // Ignore clicks while a conversion is running.
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

    // Work out the FFmpeg arguments: from the user's own command in manual mode,
    // otherwise from the chosen format and settings. Both throw an Error with a message
    // for the user if something is wrong (e.g. an invalid output filename).
    let ffmpegArgs: string[];
    let outputFilename: string;
    try {
      ({ ffmpegArgs, outputFilename } = manualMode
        ? manualCommandArgs(file.name, manualCommandInput)
        : createFFmpegArgs(file.name, codec, settings, outputName.trim(), audioTrack));
    } catch (error) {
      setAlert({ severity: 'error', message: (error as Error).message });
      return;
    }

    // Show the command as it would be typed in a terminal.
    setFfmpegCommand(`ffmpeg ${formatCommand(ffmpegArgs)}`);
    // FFmpeg is null after a cancel, so create a new instance if needed.
    const ffmpeg = ffmpegRef.current ?? new FFmpeg();
    ffmpegRef.current = ffmpeg;
    // Mark this conversion as the current one. isActive() turns false if it's cancelled
    // or the page closes, and convertFile then stops reporting progress.
    const currentSession = {};
    session.current = currentSession;
    const isActive = () => session.current === currentSession && ffmpegRef.current === ffmpeg;
    setLogs('');
    setOutput(null);
    setIsConverting(true);
    // Run the conversion in the background. convertFile reports back through these callbacks.
    void convertFile(ffmpeg, {
      file,
      ffmpegArgs,
      outputFilename,
      // A manual command might change the output's length (e.g. by trimming), so the
      // input's duration can't be used to show a percentage.
      knownTimeline: !manualMode,
      isActive,
      onAlert: (severity, message) => setAlert({ severity, message }),
      onStatus: setStatus,
      // Keep only the last 100,000 characters of the log, so a long conversion can't use up memory.
      onLog: message => setLogs(previous => (previous + message + '\n').slice(-100_000)),
      onOutput: converted => {
        // Keep the converted file for the "download again" link, or free it if this
        // conversion was cancelled meanwhile.
        if (isActive()) setOutput(converted);
        else URL.revokeObjectURL(converted.url);
      },
    }).finally(() => {
      if (!isActive()) return;
      session.current = null;
      setIsConverting(false);
    });
  };

  // ---------------------------------------------------------------------------
  // What's shown on the page.
  // ---------------------------------------------------------------------------
  return (
    <>
      {/* Page header. */}
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

      {/* All the inputs. A disabled <fieldset> disables every control inside it, so nothing can
          change during a conversion. Status and Cancel are outside it, so Cancel stays usable. */}
      <fieldset disabled={isConverting} aria-label="Conversion settings" className="border-0 m-0 p-0 min-w-0">
        {/* File picker, and the file's duration and streams once ffprobe has read them. */}
        <FileInput onFile={onFile} filename={inputFilename} disabled={isConverting} />
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
          // Manual mode: one text box for the rest of the command. The fixed start,
          // "ffmpeg -i <input>", is shown in front of it.
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
          // Normal mode: choose a format and its settings.
          <>
            {/* "Desired format" dropdown, with one option per entry in FORMATS, e.g. ['MP3', 'MP3 (.mp3)']. */}
            <SelectField id="codecs" label="Desired format" value={codec}
              onChange={value => setCodec(value as Codec)}
              options={Object.entries(FORMATS).map(([value, { label }]) => [value, label] as const)} />

            {/* Audio track picker. Shown when ffprobe has found more than one audio track.
                Otherwise (or before ffprobe finishes, or if it fails) the default is used. */}
            {audioStreams.length > 1 && (
              <SelectField id="audio_track" label="Audio track" value={String(audioTrack)}
                onChange={value => setChosenTrack(value === 'all' ? 'all' : Number(value))}
                options={[
                  ...(allowsAll ? [['all', 'All audio tracks'] as const] : []),
                  // The value is the track's position among the audio tracks (0 is the first): -map 0:a:<position>.
                  ...audioStreams.map((stream, position) => [String(position), trackLabel(stream)] as const),
                ]} />
            )}
            <Divider sx={{ my: 2 }} />

            <Typography variant="h5" component="h2" gutterBottom>
              Encoder Settings
            </Typography>

            {/* The selected format's own controls, defined by its Panel in formats.tsx
                (e.g. MP3's encoding type and bitrate). They read `settings` and change them with `update`. */}
            <format.Panel settings={settings} set={update} />

            {/* Options every format shares, shown only where they apply. */}
            {/* Keep the input's video: only for formats that can go into a video file (keepVideo). */}
            {format.keepVideo && (
              <div>
                <YesNoRadio name="keep_video" label="Output" value={settings.isKeepVideo}
                  onChange={value => update('isKeepVideo', value)}
                  yesLabel="Keep the video (if applicable)" noLabel="I want an audio file" />
              </div>
            )}

            {/* Downmix to stereo: not for formats that copy the audio unchanged (copiesAudio). */}
            {!format.copiesAudio && (
              <div>
                <YesNoRadio name="downmix" label="Downmix to stereo?" value={settings.downmixToStereo}
                  onChange={value => update('downmixToStereo', value)} />
              </div>
            )}
            <Divider sx={{ my: 2 }} />

            {/* Output filename, without the extension; createFFmpegArgs adds the format's. */}
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
      </fieldset>

      {/* The command being run, shown only while converting. */}
      <div className={`text-center my-4 ${isConverting ? 'block' : 'hidden'}`}>
        {ffmpegCommand && <>Running: {ffmpegCommand}...</>}
      </div>

      {/* Progress (stage, percentage, speed, ETA) and the FFmpeg log. */}
      <OperationStatus progress={status} busy={isConverting} logs={logs} />
      {isConverting && <Button onClick={cancel}>Cancel</Button>}

      {alert && <div className="w-full max-w-xs mx-auto"><Alert severity={alert.severity} sx={{ textAlign: 'center', my: 2, display: 'flex', justifyContent: 'center' }}>{alert.message}</Alert></div>}

      {/* A link to download the converted file again, in case the automatic download was blocked. */}
      {output && !isConverting && (
        <Typography variant="body2">
          If the download didn't start,{' '}
          <a href={output.url} download={output.filename} className="underline text-sky-700">
            download {output.filename}
          </a>{' '}
          ({formatBytes(output.size)}).
        </Typography>
      )}

      {/* Hidden rather than removed during a conversion, so the page layout doesn't jump. */}
      <div className={`mt-4 ${!isConverting ? 'block' : 'hidden'}`}>
        <Button variant="contained" onClick={onConvertClicked}>Convert</Button>
      </div>
    </>
  );
};

export default Homepage;
