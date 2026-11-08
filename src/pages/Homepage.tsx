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
import { convertFile, loadFFmpeg, OUT_OF_MEMORY_ADVICE, type ConvertedFile } from '../utils/convertFile';
import { markConversionEnded, markConversionStarted, takeUnfinishedConversion } from '../utils/unfinishedConversion';
import OperationStatus from '../components/OperationStatus';
import type { OperationProgress } from '../utils/progress';
import Button from '@mui/material/Button';
import { allowsAllAudioTracks, createFFmpegArgs, createVideoArgs, videoHasAudio, type AudioTrack, type Trim } from '../utils/createFFmpegArgs';
import { formatCommand } from '../utils/parseArgs';
import { manualCommandArgs, videoThreadArgs } from '../utils/manualCommand';
import { formatBytes } from '../utils/progress';
import { loadSettings, saveSettings } from '../utils/savedSettings';
import { probeFile, type StreamInfo } from '../utils/probeFile';
import MediaInfoPanel, { type MediaInfoState } from '../components/MediaInfoPanel';
import { FORMATS, type Codec, type FormatSettings, type SetSetting } from '../formats';
import {
  CONTAINERS, VIDEO_AUDIO_FORMATS, VIDEO_ENCODERS, containerHoldsAudio, videoAudioEncodingOf, videoContainerOf, videoEncoderOf,
} from '../videoEncoders';
// General Components
import FileInput from '../components/FileInput';
import VideoTrimmer from '../components/VideoTrimmer';
import SelectField from '../components/SelectField';
import SettingNote from '../components/SettingNote';
import YesNoRadio from '../components/YesNoRadio';
// Images
import ffmpegLogo from '../images/ffmpeg-25.png';
import webAssemblyLogo from '../images/webassembly-25.png';
// Material UI
import Alert, { AlertColor } from '@mui/material/Alert';
import Typography from '@mui/material/Typography';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import InputAdornment from '@mui/material/InputAdornment';
import TextField from '@mui/material/TextField';

/**
 * The device's RAM in GB, roughly: browsers round it to a power of two and cap it.
 * Only Chrome and Edge report it (undefined elsewhere).
 */
const deviceMemoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

/** "song.final.wav" -> "song.final". Used as the default output filename. */
const withoutExtension = (filename: string) =>
  filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;

/** An audio track's name in the track picker, e.g. "Stream 1 (aac) — eng, 48000 Hz, 5.1". */
const trackLabel = (stream: StreamInfo) =>
  `Stream ${stream.index}`
  + (stream.codec ? ` (${stream.codec})` : '')
  + (stream.details.length ? ` — ${stream.details.join(', ')}` : '');

/**
 * Call `onChange` whenever `value` changes, but not on the first render, so settings
 * restored from the last visit aren't overwritten by defaults.
 */
const useOnChange = (value: string, onChange: () => void) => {
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    onChange();
  });
};

/** A titled group of related settings within a step, e.g. a video's audio settings. */
const Subsection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mt-5 rounded-2xl bg-white/[0.03] ring-1 ring-white/[0.06] px-4 pt-3 pb-2">
    <h3 className="text-left text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</h3>
    {children}
  </section>
);

/** The frame rate and size options. Common values, all defaulting to the input's own. */
const withOriginal = (values: string[], unit: string) =>
  [['original', 'Original'] as const, ...values.map(value => [value, `${value} ${unit}`] as const)];
const FPS_OPTIONS = withOriginal(['60', '50', '30', '25', '24', '15', '12', '10', '5'], 'fps');
const WIDTH_OPTIONS = withOriginal(['3840', '2560', '1920', '1280', '1024', '854', '640', '480', '320'], 'px');
const HEIGHT_OPTIONS = withOriginal(['2160', '1440', '1080', '720', '576', '480', '360', '240'], 'px');

/** The "Video encoder" dropdown's options, grouped as in videoEncoders.tsx. */
const VIDEO_ENCODER_OPTIONS = Object.entries(VIDEO_ENCODERS).map(([value, { label, group }]) => [value, label, group] as const);

/** A numbered step in the converter card. */
const Step = ({ n, title, children }: { n: number; title: string; children: React.ReactNode }) => (
  <section className="py-6 first:pt-0 border-b border-white/[0.06] last:border-b-0">
    <h2 className="flex items-center gap-3 mb-4 text-left text-base font-semibold text-slate-100">
      <span className="grid place-items-center h-7 w-7 shrink-0 rounded-full text-xs font-bold text-white bg-gradient-to-br from-violet-500 to-cyan-500 shadow-md shadow-violet-500/30">
        {n}
      </span>
      {title}
    </h2>
    {children}
  </section>
);

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
  // The part of the video to convert, or null for all of it. Like the track, only for this file.
  const [trim, setTrim] = useState<Trim | null>(null);
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

  // If the tab crashed during a conversion (almost always from running out of memory), say so
  // when it's reloaded. Leaving the page normally clears the mark; see unfinishedConversion.ts.
  useEffect(() => {
    const crashedDuring = takeUnfinishedConversion();
    if (crashedDuring) {
      setAlert({ severity: 'error', message:
        `The conversion of ${crashedDuring} stopped because the browser ran out of memory. ${OUT_OF_MEMORY_ADVICE}` });
    }
    window.addEventListener('pagehide', markConversionEnded);
    return () => window.removeEventListener('pagehide', markConversionEnded);
  }, []);

  // Remember the format and settings for next time, whenever they change.
  useEffect(() => saveSettings({ codec, settings }), [codec, settings]);

  // ---------------------------------------------------------------------------
  // Values worked out from the state on every render.
  // ---------------------------------------------------------------------------

  const inputFilename = file?.name ?? '';
  // The selected format's entry in formats.tsx: its label, extension, args, Panel and flags.
  const format = FORMATS[codec];
  // Whether the video is re-encoded with one of VIDEO_ENCODERS, rather than converting the audio.
  const isVideo = settings.outputType === 'video';
  // The chosen video encoder's entry in videoEncoders.tsx, and the container it's written to.
  const videoEncoderName = videoEncoderOf(settings);
  const videoEncoder = VIDEO_ENCODERS[videoEncoderName];
  const videoContainer = videoContainerOf(settings);
  // The selected file's audio tracks, once ffprobe has read it.
  const audioStreams = mediaInfo?.status === 'ready'
    ? mediaInfo.info.streams.filter(stream => stream.type === 'audio') : [];
  // Whether the output can hold every audio track (MKA, or when keeping the video).
  const allowsAll = allowsAllAudioTracks(codec, settings);
  // Keeping the video makes the output about as large as the input, and the converted file is
  // held in memory until it's saved (about twice over at the peak), so warn when it's large
  // for this device's memory.
  const largeForDevice = !manualMode && !isVideo && file !== undefined && Boolean(format.keepVideo && settings.isKeepVideo)
    && deviceMemoryGB !== undefined && file.size > deviceMemoryGB * 1024 ** 3 / 4;
  // The audio track that will be converted: the user's choice, else all tracks for MKA and the
  // first track for every other format. "All" falls back to the first track if the user then
  // switches to a format that holds only one.
  const audioTrack: AudioTrack = chosenTrack === 'all' && !allowsAll ? 0
    : chosenTrack ?? (!isVideo && format.allAudioTracks ? 'all' : 0);
  // Whether to offer trimming: for video outputs, unless ffprobe found no video in the file.
  const offersTrim = isVideo && file !== undefined
    && !(mediaInfo?.status === 'ready' && !mediaInfo.info.streams.some(stream => stream.type === 'video'));
  // The steps after "Pick a format" move down one when the Trim step is shown.
  const afterTrim = offersTrim ? 1 : 0;
  // Whether there's audio in the output to pick a track for.
  const hasAudio = !isVideo || videoHasAudio(settings);
  // Whether a video's audio is re-encoded, rather than kept as it is or left out.
  const reencodesVideoAudio = isVideo && hasAudio
    && (settings.videoAudio === 'encode' || Boolean(CONTAINERS[videoContainer].noAudioCopy));
  // How a video's audio is encoded then: the container's fixed audio, or the chosen audio format.
  const videoAudioEncoder = reencodesVideoAudio ? videoAudioEncodingOf(settings) : undefined;
  // Downmix to stereo is offered when the audio is encoded, unless the container sets the
  // channels itself (DV is always stereo, AMV always mono).
  const offersDownmix = isVideo
    ? Boolean(videoAudioEncoder && !videoAudioEncoder.args.includes('-ac'))
    : !format.copiesAudio;
  // Whether the audio encoder can't write more than two channels (e.g. MP3), so it's always downmixed.
  const stereoOnly = isVideo ? Boolean(videoAudioEncoder?.stereoOnly) : Boolean(format.stereoOnly);
  // Change one setting, e.g. update('mp3Bitrate', '256'). It copies the settings object
  // rather than editing it, because React only notices a change when it gets a new object.
  const update: SetSetting = (key, value) => setSettings(previous => ({ ...previous, [key]: value }));

  // Picking a container sets the audio to its default: not re-encoded for MKV and NUT, which
  // hold almost any audio format, else re-encoded. A choice to remove the audio is kept.
  useOnChange(isVideo ? videoContainer : '', () => {
    if (isVideo && settings.videoAudio !== 'none') update('videoAudio', CONTAINERS[videoContainer].defaultAudio ?? 'encode');
  });

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
    setTrim(null);
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
    markConversionEnded();
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
        : isVideo
          ? createVideoArgs(file.name, settings, outputName.trim(), audioTrack, videoThreadArgs(), offersTrim ? trim ?? undefined : undefined)
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
    markConversionStarted(file.name);
    // Run the conversion in the background. convertFile reports back through these callbacks.
    void convertFile(ffmpeg, {
      file,
      ffmpegArgs,
      outputFilename,
      // A manual command might change the output's length (e.g. by trimming), so the
      // input's duration can't be used to show a percentage.
      knownTimeline: !manualMode,
      // When trimmed, a percentage is of the trimmed part.
      outputDuration: !manualMode && isVideo && offersTrim && trim ? trim.end - trim.start : undefined,
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
      markConversionEnded();
      session.current = null;
      setIsConverting(false);
      // If FFmpeg stopped responding, convertFile stopped its worker: start a fresh one next time.
      if (!ffmpeg.loaded) ffmpegRef.current = null;
    });
  };

  // ---------------------------------------------------------------------------
  // What's shown on the page.
  // ---------------------------------------------------------------------------

  // Audio track picker. Shown when ffprobe has found more than one audio track.
  // Otherwise (or before ffprobe finishes, or if it fails) the default is used.
  const audioTrackPicker = hasAudio && audioStreams.length > 1 && (
    <SelectField id="audio_track" label="Audio track" value={String(audioTrack)}
      onChange={value => setChosenTrack(value === 'all' ? 'all' : Number(value))}
      options={[
        ...(allowsAll ? [['all', 'All audio tracks'] as const] : []),
        // The value is the track's position among the audio tracks (0 is the first): -map 0:a:<position>.
        ...audioStreams.map((stream, position) => [String(position), trackLabel(stream)] as const),
      ]} />
  );

  // The chosen audio format's settings, when a video's audio is re-encoded to a format the user picks.
  const VideoAudioPanel = videoAudioEncoder?.format && VIDEO_AUDIO_FORMATS[videoAudioEncoder.format].Panel;

  // Downmix to stereo, only when the audio is encoded (see offersDownmix). Formats that can't
  // hold more than two channels are always downmixed, so they get a note instead of the choice.
  const downmixControl = offersDownmix && (stereoOnly ? (
    <SettingNote>This audio format holds at most two channels, so audio with more will be downmixed to stereo.</SettingNote>
  ) : (
    <div>
      <YesNoRadio name="downmix" label="Downmix to stereo?" value={settings.downmixToStereo}
        onChange={value => update('downmixToStereo', value)} />
    </div>
  ));
  return (
    <div className="max-w-2xl mx-auto">
      {/* Page header. */}
      <header className="pt-12 pb-10 sm:pt-16">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
          <span className="gradient-text">Audio / Video</span> Converter
        </h1>
        <p className="mt-4 text-slate-400 max-w-lg mx-auto">
          Convert audio and video right in your browser. Fast, private, and your file is not uploaded.
        </p>
        <div className="mt-5 flex items-center justify-center gap-2 text-xs">
          <a href="https://ffmpeg.org/" target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 ring-1 ring-white/10 text-slate-300 hover:bg-white/10 transition-colors">
            <img src={ffmpegLogo} alt="" className="h-4 w-4" /> Powered by FFmpeg
          </a>
          <a href="https://webassembly.org/" target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/5 ring-1 ring-white/10 text-slate-300 hover:bg-white/10 transition-colors">
            <img src={webAssemblyLogo} alt="" className="h-4 w-4" /> WebAssembly
          </a>
        </div>
      </header>

      <div className="glass-card float-in rounded-3xl p-5 sm:p-8">
        {/* All the inputs. A disabled <fieldset> disables every control inside it, so nothing can
            change during a conversion. Status and Cancel are outside it, so Cancel stays usable. */}
        <fieldset disabled={isConverting} aria-label="Conversion settings" className="border-0 m-0 p-0 min-w-0">
          {/* File picker, and the file's duration and streams once ffprobe has read them. */}
          <Step n={1} title="Choose a file">
            <FileInput onFile={onFile} filename={inputFilename} disabled={isConverting} />
            {mediaInfo && <MediaInfoPanel state={mediaInfo} />}
            <div className="mt-3 text-left">
              <FormControlLabel
                control={<Checkbox size="small" checked={manualMode} onChange={(_, checked) => setManualMode(checked)} />}
                label={<span className="text-sm text-slate-300">Write my own FFmpeg command</span>}
              />
            </div>
          </Step>

          {manualMode ? (
            // Manual mode: one text box for the rest of the command. The fixed start,
            // "ffmpeg -i <input>", is shown in front of it.
            <Step n={2} title="Enter FFmpeg command">
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
                  htmlInput: { style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' } },
                  input: {
                    startAdornment: (
                      <InputAdornment position="start" title={`ffmpeg -i ${inputFilename || 'input.mp4'}`}
                        sx={{ maxWidth: '50%', flexShrink: 0, overflow: 'hidden', fontFamily: 'monospace' }}>
                        <span className="block whitespace-nowrap overflow-hidden text-ellipsis font-mono text-violet-300">
                          ffmpeg -i {inputFilename || 'input.mp4'}
                        </span>
                      </InputAdornment>
                    ),
                  },
                }}
              />
            </Step>
          ) : (
            // Normal mode: choose a format and its settings.
            <>
              <Step n={2} title="Pick a format">
                {/* Audio: convert to one of FORMATS. Video: re-encode the video with one of VIDEO_ENCODERS. */}
                <FormControl sx={{ display: 'block', mb: 0.5 }}>
                  <RadioGroup row aria-label="Output type" name="output_type" value={settings.outputType}
                    onChange={(_, value) => update('outputType', value as FormatSettings['outputType'])}
                    sx={{ justifyContent: 'center' }}>
                    <FormControlLabel value="audio" control={<Radio />} label="Audio" />
                    <FormControlLabel value="video" control={<Radio />} label="Video" />
                  </RadioGroup>
                </FormControl>

                {isVideo ? <>
                  {/* "Video encoder" dropdown: every video encoder in FFmpeg's WebAssembly build, in groups. */}
                  <SelectField id="video_encoder" label="Video encoder" value={videoEncoderName}
                    onChange={value => update('videoEncoder', value)} options={VIDEO_ENCODER_OPTIONS} />
                  {/* Only the containers this encoder can be written to. */}
                  <SelectField id="video_container" label="Container" value={videoContainer}
                    onChange={value => update('videoContainer', value)}
                    options={videoEncoder.containers.map(name => [name, CONTAINERS[name].label] as const)} />
                </> : (
                  // "Desired format" dropdown, with one option per entry in FORMATS, e.g. ['MP3', 'MP3 (.mp3)'].
                  <SelectField id="codecs" label="Desired format" value={codec}
                    onChange={value => setCodec(value as Codec)}
                    options={Object.entries(FORMATS).map(([value, { label }]) => [value, label] as const)} />
                )}

                {/* For video, the track picker is in the Audio subsection of "Encoder settings" instead. */}
                {!isVideo && audioTrackPicker}
              </Step>

              {/* Video only: a preview with start and end handles, to convert part of the video. */}
              {offersTrim && (
                <Step n={3} title="Trim (optional)">
                  <VideoTrimmer file={file} trim={trim} onChange={setTrim}
                    duration={mediaInfo?.status === 'ready' ? mediaInfo.info.duration : undefined}
                    // Failed, or read the file but found no duration.
                    probeFailed={mediaInfo?.status === 'failed' || (mediaInfo?.status === 'ready' && !mediaInfo.info.duration)} />
                </Step>
              )}

              <Step n={3 + afterTrim} title="Encoder settings">
                {isVideo ? <>
                  {/* The video encoder's own controls and note, from videoEncoders.tsx. */}
                  {videoEncoder.Panel && <videoEncoder.Panel settings={settings} set={update} />}
                  {videoEncoder.note && <SettingNote>{videoEncoder.note}</SettingNote>}
                  {!videoEncoder.Panel && !videoEncoder.note && <SettingNote>This encoder has no settings.</SettingNote>}

                  {/* Frame rate and size, for every encoder. Left at Original, the input's are kept. */}
                  <Subsection title="Frame rate and size">
                    <SelectField id="video_fps" label="Frame rate" value={settings.videoFps}
                      onChange={value => update('videoFps', value)} options={FPS_OPTIONS} />
                    <SelectField id="video_width" label="Width" value={settings.videoWidth}
                      onChange={value => update('videoWidth', value)} options={WIDTH_OPTIONS} />
                    <SelectField id="video_height" label="Height" value={settings.videoHeight}
                      onChange={value => update('videoHeight', value)} options={HEIGHT_OPTIONS} />
                    <SettingNote>
                      Set only the width or the height to keep the video's shape; setting both can stretch it.
                      A lower frame rate makes a smaller file (10 to 15 fps is typical for GIFs); a higher
                      one than the video's own repeats frames rather than making it smoother.
                    </SettingNote>
                  </Subsection>

                  {/* The audio settings, unless the container can't hold audio (e.g. GIF). */}
                  {containerHoldsAudio(videoContainer) && (
                    <Subsection title="Audio">
                      {/* Re-encode, keep as it is (where the container allows it), or remove the audio. */}
                      <FormControl sx={{ display: 'flex', alignItems: 'center', my: 1 }}>
                        <RadioGroup aria-label="Audio" name="video_audio"
                          // Containers that can't keep the audio as it is always re-encode it.
                          value={settings.videoAudio === 'copy' && CONTAINERS[videoContainer].noAudioCopy ? 'encode' : settings.videoAudio}
                          onChange={(_, value) => update('videoAudio', value as FormatSettings['videoAudio'])}>
                          {/* A container with only one audio format names it here; others offer a choice below. */}
                          <FormControlLabel value="encode" control={<Radio />}
                            label={CONTAINERS[videoContainer].fixedAudio ? `Re-encode (${CONTAINERS[videoContainer].fixedAudio.label})` : 'Re-encode'} />
                          {!CONTAINERS[videoContainer].noAudioCopy && (
                            <FormControlLabel value="copy" control={<Radio />} label="Do not re-encode" />
                          )}
                          <FormControlLabel value="none" control={<Radio />} label="Remove the audio" />
                        </RadioGroup>
                      </FormControl>
                      {settings.videoAudio === 'copy' && !CONTAINERS[videoContainer].noAudioCopy && (
                        <SettingNote>This fails if the container can't hold the audio's format; re-encoding always works.</SettingNote>
                      )}
                      {/* The audio format, from those the container can hold (AAC where it can), and its settings. */}
                      {videoAudioEncoder?.format && <>
                        <SelectField id="video_audio_format" label="Audio format" value={videoAudioEncoder.format}
                          onChange={value => update('videoAudioFormat', value)}
                          options={CONTAINERS[videoContainer].audioFormats!.map(name => [name, VIDEO_AUDIO_FORMATS[name].label] as const)} />
                        {VideoAudioPanel && <VideoAudioPanel settings={settings} set={update} />}
                      </>}
                      {hasAudio && audioTrackPicker}
                      {downmixControl}
                    </Subsection>
                  )}
                </> : <format.Panel settings={settings} set={update} />}

                {/* Options every format shares, shown only where they apply. */}
                {/* Keep the input's video: only for formats that can go into a video file (keepVideo). */}
                {!isVideo && format.keepVideo && (
                  <div>
                    <YesNoRadio name="keep_video" label="Output" value={settings.isKeepVideo}
                      onChange={value => update('isKeepVideo', value)}
                      yesLabel="Keep the video (if applicable)" noLabel="I want an audio file" />
                  </div>
                )}

                {!isVideo && downmixControl}
              </Step>

              <Step n={4 + afterTrim} title="Name the output">
                {/* Output filename, without the extension; createFFmpegArgs adds the format's or container's. */}
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
              </Step>
            </>
          )}
        </fieldset>

        {largeForDevice && !isConverting && (
          <Alert severity="warning" sx={{ my: 2 }}>
            This file is large for this device's memory (about {deviceMemoryGB} GB). Keeping the video
            makes the converted file about as large, and the browser may run out of memory while saving it.
            Closing other tabs can help.
          </Alert>
        )}

        {/* Hidden rather than removed during a conversion, so the page layout doesn't jump. */}
        <div className={`mt-6 ${!isConverting ? 'block' : 'hidden'}`}>
          <Button variant="contained" size="large" fullWidth onClick={onConvertClicked}
            sx={{ py: 1.5, fontSize: '1.05rem' }}>
            Convert
          </Button>
        </div>

        {/* The command being run, shown only while converting. */}
        <div className={`mt-6 text-left ${isConverting ? 'block' : 'hidden'}`}>
          {ffmpegCommand && (
            <div className="rounded-xl bg-black/50 ring-1 ring-white/10 p-3 font-mono text-xs text-slate-300 break-all">
              <span className="text-slate-500">Running </span>
              <span className="text-violet-300">$</span> {ffmpegCommand}
            </div>
          )}
        </div>

        {/* Progress (stage, percentage, speed, ETA) and the FFmpeg log. */}
        <OperationStatus progress={status} busy={isConverting} logs={logs} />
        {isConverting && (
          <div className="mt-4">
            <Button variant="outlined" color="inherit" onClick={cancel}
              sx={{ borderColor: 'rgba(255,255,255,0.2)', color: 'text.secondary' }}>
              Cancel
            </Button>
          </div>
        )}

        {alert && <Alert severity={alert.severity} sx={{ mt: 2 }}>{alert.message}</Alert>}

        {/* A link to download the converted file again, in case the automatic download was blocked. */}
        {output && !isConverting && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            If the download didn't start,{' '}
            <a href={output.url} download={output.filename} className="underline text-cyan-300 hover:text-cyan-200">
              download {output.filename}
            </a>{' '}
            ({formatBytes(output.size)}).
          </Typography>
        )}
      </div>
    </div>
  );
};

export default Homepage;
