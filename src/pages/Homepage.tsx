/**
 * The converter page. The user picks a file and either a format with its settings, or types
 * their own FFmpeg command. FFmpeg (compiled to WebAssembly) then converts the file inside
 * the browser and the result is downloaded. Nothing is uploaded to a server.
 *
 * The formats and their settings are defined in src/formats.tsx; this page only shows
 * whichever format is selected.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { convertFile, loadFFmpeg, OUT_OF_MEMORY_ADVICE, type ConvertedFile } from '../utils/convertFile';
import { markConversionEnded, markConversionStarted, takeUnfinishedConversion } from '../utils/unfinishedConversion';
import OperationStatus from '../components/OperationStatus';
import type { OperationProgress } from '../utils/progress';
import { allowsAllAudioTracks, createFFmpegArgs, createVideoArgs, videoHasAudio, type AudioTrack, type Trim } from '../utils/createFFmpegArgs';
import { formatCommand } from '../utils/parseArgs';
import { manualCommandArgs, videoThreadArgs } from '../utils/manualCommand';
import { formatBytes } from '../utils/progress';
import { loadSettings, saveSettings } from '../utils/savedSettings';
import { probeFile, type StreamInfo } from '../utils/probeFile';
import { isVideoFile } from '../utils/isVideoFile';
import { freeOutputSpace, removeAbandonedOutputs } from '../utils/outputStorage';
import MediaInfoPanel, { type MediaInfoState } from '../components/MediaInfoPanel';
import { FORMATS, type Codec, type FormatSettings, type SetSetting } from '../formats';
import { VideoEncoderSettings, VideoFormatPicker, useVideoAudioDefault } from '../components/VideoSettings';
// General Components
import Alert, { type AlertSeverity } from '../components/Alert';
import Button from '../components/Button';
import ChoiceGroup from '../components/ChoiceGroup';
import DownmixControl from '../components/DownmixControl';
import FileInput from '../components/FileInput';
import VideoTrimmer from '../components/VideoTrimmer';
import SelectField from '../components/SelectField';
import TextField from '../components/TextField';
import YesNoRadio from '../components/YesNoRadio';
// Images
import ffmpegLogo from '../images/ffmpeg-25.png';
import webAssemblyLogo from '../images/webassembly-25.png';

/**
 * The device's RAM in GB, roughly: browsers round it to a power of two and cap it.
 * Only Chrome and Edge report it (undefined elsewhere).
 */
const deviceMemoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;

/**
 * The input filename of a conversion the tab crashed during (almost always from running out
 * of memory), read once when the page loads. Leaving the page normally clears the mark; see
 * unfinishedConversion.ts. Cleared here once the converter has shown it.
 */
let crashedDuring = takeUnfinishedConversion();

/** "song.final.wav" -> "song.final". Used as the default output filename. */
const withoutExtension = (filename: string) =>
  filename.includes('.') ? filename.slice(0, filename.lastIndexOf('.')) : filename;

/** An audio track's name in the track picker, e.g. "Stream 1 (aac) — eng, 48000 Hz, 5.1". */
const trackLabel = (stream: StreamInfo) =>
  `Stream ${stream.index}`
  + (stream.codec ? ` (${stream.codec})` : '')
  + (stream.details.length ? ` — ${stream.details.join(', ')}` : '');

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
  // It starts by saying so if the tab crashed during a conversion (see crashedDuring).
  const [alert, setAlert] = useState<{ severity: AlertSeverity; message: string } | null>(() => crashedDuring
    ? { severity: 'error', message: `The conversion of ${crashedDuring} stopped because the browser ran out of memory. ${OUT_OF_MEMORY_ADVICE}` }
    : null);

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
  // Only set when the file was held in memory: one written to disk, in the browser's private
  // storage, is deleted once its download has started (see DELETE_DELAY_MS in convertFile.ts).
  // The file is held in memory behind an object URL. Free it when it's replaced or the page
  // closes. (The function an effect returns runs before the next effect, and on unmount.)
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

  // The crash has been reported, so coming back to this page later doesn't report it again.
  // Then clear the mark whenever the visitor leaves the page normally.
  useEffect(() => {
    crashedDuring = null;
    window.addEventListener('pagehide', markConversionEnded);
    return () => window.removeEventListener('pagehide', markConversionEnded);
  }, []);

  // How much the browser says this site may still store on disk, in bytes, which is where
  // converted files are kept (see outputStorage.ts). 0 if it can't keep them there, and until
  // it's known, and Infinity if the browser only says it's plenty (Chrome never reports more than
  // 10 GiB, however much it really allows; see freeOutputSpace). It's only used for the warning
  // below (see largeForDevice).
  const [outputSpace, setOutputSpace] = useState(0);
  // When the page opens: find that out, and delete the converted files left on disk by tabs
  // that have since closed (nothing can be relied on to run when a tab closes).
  useEffect(() => {
    void removeAbandonedOutputs();
    void freeOutputSpace().then(setOutputSpace);
  }, []);

  // Remember the format and settings for next time, whenever they change.
  useEffect(() => saveSettings({ codec, settings }), [codec, settings]);

  // ---------------------------------------------------------------------------
  // Values worked out from the state on every render.
  // ---------------------------------------------------------------------------

  const inputFilename = file?.name ?? '';
  // The selected format's entry in formats.tsx: its label, extension, args, Panel and flags.
  const format = FORMATS[codec];
  // Whether the video is re-encoded with one of VIDEO_ENCODERS (see VideoSettings.tsx), rather
  // than converting the audio.
  const isVideo = settings.outputType === 'video';
  // The selected file's audio tracks, once ffprobe has read it.
  const audioStreams = mediaInfo?.status === 'ready'
    ? mediaInfo.info.streams.filter(stream => stream.type === 'audio') : [];
  // False when ffprobe found no video stream: then "Keep the video" isn't offered and the
  // conversion behaves as if "I want an audio file" is selected.
  const hasVideoStream = !(mediaInfo?.status === 'ready' && !mediaInfo.info.streams.some(stream => stream.type === 'video'));
  const keepsVideo = Boolean(format.keepVideo && settings.isKeepVideo && hasVideoStream);
  // Settings with that applied, for working out the arguments.
  const effectiveSettings = hasVideoStream || !settings.isKeepVideo ? settings : { ...settings, isKeepVideo: false };
  // Whether the output can hold every audio track (MKA, or when keeping the video).
  const allowsAll = allowsAllAudioTracks(codec, effectiveSettings, file?.name);
  // Keeping the video makes the output about as large as the input. The converted file is
  // written to disk, in the browser's private storage, so its size doesn't matter to memory.
  // But where the browser can't keep it there, or says it hasn't the space for it (as in a
  // private window), it's held in memory until it's downloaded, so warn when it's large for
  // this device's memory. (A browser that only says it has plenty of space, however large the
  // file, never gets the warning: outputSpace is then Infinity.) Keeping the video of a 600 MB MP4 in Chromium took about 3.8 times
  // the output's size in memory at the peak (see "File size and memory" in the README).
  const largeForDevice = !manualMode && !isVideo && file !== undefined && keepsVideo
    && file.size > outputSpace
    && deviceMemoryGB !== undefined && file.size > deviceMemoryGB * 1024 ** 3 / 4;
  // The audio track that will be converted: the user's choice, else all tracks for MKA and the
  // first track for every other format. "All" falls back to the first track if the user then
  // switches to a format that holds only one.
  const audioTrack: AudioTrack = chosenTrack === 'all' && !allowsAll ? 0
    : chosenTrack ?? (!isVideo && format.allAudioTracks ? 'all' : 0);
  // Whether to offer trimming: for video outputs, unless ffprobe found no video in the file.
  const offersTrim = isVideo && file !== undefined && hasVideoStream;
  // The steps after "Pick a format" move down one when the Trim step is shown.
  const afterTrim = offersTrim ? 1 : 0;
  // Whether there's audio in the output to pick a track for.
  const hasAudio = !isVideo || videoHasAudio(settings);
  // Change one setting, e.g. update('mp3Bitrate', '256'). It copies the settings object
  // rather than editing it, because React only notices a change when it gets a new object.
  const update = useCallback<SetSetting>((key, value) => setSettings(previous => ({ ...previous, [key]: value })), []);

  // Picking a video container sets its default audio handling.
  useVideoAudioDefault(settings, update);

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
    // Default to converting the video for a video file, else to converting the audio.
    update('outputType', isVideoFile(currentFile) ? 'video' : 'audio');
    // Suggest the input's name as the output name, e.g. "song.wav" -> "song".
    setOutputName(withoutExtension(currentFile.name));
    // Start downloading FFmpeg (about 12 MB compressed) while the user picks settings. If it fails,
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
          : createFFmpegArgs(file.name, codec, effectiveSettings, outputName.trim(), audioTrack));
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
            <div className="mt-4 text-left">
              <label className="inline-flex cursor-pointer items-center gap-2.5 text-sm text-slate-300 hover:text-white">
                <input type="checkbox" className="checkbox" checked={manualMode}
                  onChange={event => setManualMode(event.target.checked)} />
                Write my own FFmpeg command
              </label>
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
                prefix={`ffmpeg -i ${inputFilename || 'input.mp4'}`}
                autoComplete="off"
                spellCheck={false}
                className="[&_input]:font-mono [&_input]:text-sm"
              />
            </Step>
          ) : (
            // Normal mode: choose a format and its settings.
            <>
              <Step n={2} title="Pick a format">
                {/* Audio: convert to one of FORMATS. Video: re-encode the video with one of VIDEO_ENCODERS. */}
                <ChoiceGroup ariaLabel="Output type" name="output_type" value={settings.outputType}
                  onChange={value => update('outputType', value)}
                  options={[['audio', 'Audio'], ['video', 'Video']]} className="mt-0 mb-4" />

                {isVideo ? <VideoFormatPicker settings={settings} set={update} /> : (
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
                {isVideo
                  ? <VideoEncoderSettings settings={settings} set={update} audioTrackPicker={audioTrackPicker} />
                  : <format.Panel settings={settings} set={update} />}

                {/* Options every format shares, shown only where they apply. */}
                {/* Keep the input's video: only for formats that can go into a video file (keepVideo). */}
                {!isVideo && format.keepVideo && hasVideoStream && (
                  <div>
                    <YesNoRadio name="keep_video" label="Output" value={settings.isKeepVideo}
                      onChange={value => update('isKeepVideo', value)}
                      yesLabel="Keep the video (if applicable)" noLabel="I want an audio file" />
                  </div>
                )}

                {/* Downmix to stereo, when the audio is encoded rather than copied. */}
                {!isVideo && !format.copiesAudio && <DownmixControl stereoOnly={Boolean(format.stereoOnly)}
                  value={settings.downmixToStereo} onChange={value => update('downmixToStereo', value)} />}
              </Step>

              <Step n={4 + afterTrim} title="Name the output">
                {/* Output filename, without the extension; createFFmpegArgs adds the format's or container's. */}
                <TextField
                  id="output_name"
                  label="Output filename"
                  value={outputName}
                  onChange={e => setOutputName(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={200}
                  className="mx-auto my-3 max-w-80"
                />
              </Step>
            </>
          )}
        </fieldset>

        {largeForDevice && !isConverting && (
          <Alert severity="warning" className="my-4">
            This file is large for this device's memory (about {deviceMemoryGB} GB). Keeping the video
            makes the converted file about as large, and the browser may run out of memory while saving it.
            Closing other tabs can help.
          </Alert>
        )}

        {/* Hidden rather than removed during a conversion, so the page layout doesn't jump. */}
        <div className={`mt-6 ${!isConverting ? 'block' : 'hidden'}`}>
          <Button onClick={onConvertClicked} className="w-full py-3 text-[1.05rem]">
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
            <Button variant="outline" onClick={cancel}>
              Cancel
            </Button>
          </div>
        )}

        {alert && <Alert severity={alert.severity} className="mt-4">{alert.message}</Alert>}

        {/* A link to download the converted file again, in case the automatic download was blocked.
            Only for a file held in memory: one written to disk has been deleted by now. */}
        {output && !isConverting && (
          <p className="mt-4 text-sm text-slate-400">
            If the download didn't start,{' '}
            <a href={output.url} download={output.filename} className="underline text-cyan-300 hover:text-cyan-200">
              download {output.filename}
            </a>{' '}
            ({formatBytes(output.size)}).
          </p>
        )}
      </div>
    </div>
  );
};

export default Homepage;
