/**
 * The converter's settings for the Video output type, which re-encodes the video with one of
 * VIDEO_ENCODERS (see src/videoEncoders.tsx). Homepage.tsx shows these when Video is picked.
 */
import React, { useEffect, useRef } from 'react';
import type { FormatSettings, SetSetting } from '../formats';
import { videoHasAudio } from '../utils/createFFmpegArgs';
import {
  CONTAINERS, VIDEO_AUDIO_FORMATS, VIDEO_ENCODERS, containerHoldsAudio, videoAudioEncodingOf, videoContainerOf, videoEncoderOf,
} from '../videoEncoders';
import ChoiceGroup from './ChoiceGroup';
import DownmixControl from './DownmixControl';
import SelectField from './SelectField';
import SettingNote from './SettingNote';

interface Props {
  settings: FormatSettings;
  set: SetSetting;
}

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

/**
 * Picking a container sets the audio to its default: not re-encoded for MKV and NUT, which
 * hold almost any audio format, else re-encoded. A choice to remove the audio is kept.
 * Switching the output type to Video counts as picking its container. It isn't called on the
 * first render, so settings restored from the last visit aren't overwritten by defaults.
 */
export const useVideoAudioDefault = (settings: FormatSettings, set: SetSetting) => {
  const isVideo = settings.outputType === 'video';
  const container = videoContainerOf(settings);
  const value = isVideo ? container : '';
  const previous = useRef(value);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    if (isVideo && settings.videoAudio !== 'none') set('videoAudio', CONTAINERS[container].defaultAudio ?? 'encode');
  }, [value, isVideo, container, settings.videoAudio, set]);
};

/** The "Video encoder" and "Container" dropdowns, in the "Pick a format" step. */
export const VideoFormatPicker = ({ settings, set }: Props) => {
  const encoderName = videoEncoderOf(settings);
  return <>
    {/* Every video encoder in FFmpeg's WebAssembly build, in groups. */}
    <SelectField id="video_encoder" label="Video encoder" value={encoderName}
      onChange={value => set('videoEncoder', value)} options={VIDEO_ENCODER_OPTIONS} />
    {/* Only the containers this encoder can be written to. */}
    <SelectField id="video_container" label="Container" value={videoContainerOf(settings)}
      onChange={value => set('videoContainer', value)}
      options={VIDEO_ENCODERS[encoderName].containers.map(name => [name, CONTAINERS[name].label] as const)} />
  </>;
};

/** The "Encoder settings" step for video: the encoder's own settings, frame rate and size, and audio. */
export const VideoEncoderSettings = ({ settings, set, audioTrackPicker }: Props & {
  /** The audio track picker, when the file has several audio tracks. */
  audioTrackPicker: React.ReactNode;
}) => {
  const encoder = VIDEO_ENCODERS[videoEncoderOf(settings)];
  const container = CONTAINERS[videoContainerOf(settings)];
  // Whether the audio is re-encoded, rather than kept as it is or left out.
  const reencodesAudio = videoHasAudio(settings) && (settings.videoAudio === 'encode' || Boolean(container.noAudioCopy));
  // How the audio is encoded then: the container's fixed audio, or the chosen audio format.
  const audioEncoder = reencodesAudio ? videoAudioEncodingOf(settings) : undefined;
  // The chosen audio format's settings, when it's one the user picks.
  const AudioPanel = audioEncoder?.format && VIDEO_AUDIO_FORMATS[audioEncoder.format].Panel;
  // Downmixing is offered when the audio is encoded, unless the container sets the channels
  // itself (DV is always stereo, AMV always mono).
  const offersDownmix = Boolean(audioEncoder && !audioEncoder.args.includes('-ac'));

  return <>
    {/* The video encoder's own controls and note, from videoEncoders.tsx. */}
    {encoder.Panel && <encoder.Panel settings={settings} set={set} />}
    {encoder.note && <SettingNote>{encoder.note}</SettingNote>}
    {!encoder.Panel && !encoder.note && <SettingNote>This encoder has no settings.</SettingNote>}

    {/* Frame rate and size, for every encoder. Left at Original, the input's are kept. */}
    <Subsection title="Frame rate and size">
      <SelectField id="video_fps" label="Frame rate" value={settings.videoFps}
        onChange={value => set('videoFps', value)} options={FPS_OPTIONS} />
      <SelectField id="video_width" label="Width" value={settings.videoWidth}
        onChange={value => set('videoWidth', value)} options={WIDTH_OPTIONS} />
      <SelectField id="video_height" label="Height" value={settings.videoHeight}
        onChange={value => set('videoHeight', value)} options={HEIGHT_OPTIONS} />
      <SettingNote>
        Set only the width or the height to keep the video's shape; setting both can stretch it.
        A lower frame rate makes a smaller file (10 to 15 fps is typical for GIFs); a higher
        one than the video's own repeats frames rather than making it smoother.
      </SettingNote>
    </Subsection>

    {/* The audio settings, unless the container can't hold audio (e.g. GIF). */}
    {containerHoldsAudio(videoContainerOf(settings)) && (
      <Subsection title="Audio">
        {/* Re-encode, keep as it is (where the container allows it), or remove the audio. */}
        <ChoiceGroup ariaLabel="Audio" name="video_audio"
          // Containers that can't keep the audio as it is always re-encode it.
          value={settings.videoAudio === 'copy' && container.noAudioCopy ? 'encode' : settings.videoAudio}
          onChange={value => set('videoAudio', value)}
          options={[
            // A container with only one audio format names it here; others offer a choice below.
            ['encode', container.fixedAudio ? `Re-encode (${container.fixedAudio.label})` : 'Re-encode'],
            ...(!container.noAudioCopy ? [['copy', 'Do not re-encode'] as const] : []),
            ['none', 'Remove the audio'],
          ]} />
        {settings.videoAudio === 'copy' && !container.noAudioCopy && (
          <SettingNote>This fails if the container can't hold the audio's format; re-encoding always works.</SettingNote>
        )}
        {/* The audio format, from those the container can hold (AAC where it can), and its settings. */}
        {audioEncoder?.format && <>
          <SelectField id="video_audio_format" label="Audio format" value={audioEncoder.format}
            onChange={value => set('videoAudioFormat', value)}
            options={container.audioFormats!.map(name => [name, VIDEO_AUDIO_FORMATS[name].label] as const)} />
          {AudioPanel && <AudioPanel settings={settings} set={set} />}
        </>}
        {videoHasAudio(settings) && audioTrackPicker}
        {offersDownmix && <DownmixControl stereoOnly={Boolean(audioEncoder?.stereoOnly)}
          value={settings.downmixToStereo} onChange={value => set('downmixToStereo', value)} />}
      </Subsection>
    )}
  </>;
};
