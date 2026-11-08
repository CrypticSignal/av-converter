/**
 * Every video encoder in the FFmpeg WebAssembly cores (vendor/ffmpeg-core), for the
 * "Video" output type. Each entry says how the encoder appears in the dropdown, which
 * containers it can be written to, any extra FFmpeg arguments it needs, and its settings.
 *
 * The container lists were found by encoding a 720p H.264 MP4 with each encoder into each
 * container with the cores themselves: only the containers that worked are offered. The
 * first one is the default.
 */
import React from 'react';
import LabeledSlider from './components/LabeledSlider';
import SelectField from './components/SelectField';
import SettingNote from './components/SettingNote';
import { FORMATS, type Codec, type FormatSettings, type SetSetting } from './formats';

export type Container =
  | 'mp4' | 'webm' | 'mkv' | 'mov' | 'avi' | 'nut' | 'flv' | 'wmv' | 'mpg' | 'ts' | 'ogv'
  | '3gp' | 'dv' | 'mxf' | 'rm' | 'amv' | 'roq' | 'a64' | 'gif' | 'apng' | 'webp';

/** The audio formats a video's audio can be re-encoded to. Most are the "Audio" output type's formats. */
export type VideoAudioFormat = 'AAC' | 'AC3' | 'ALAC' | 'DTS' | 'FLAC' | 'MP3' | 'Opus' | 'Vorbis' | 'PCM' | 'WMA' | 'MP2';

interface AudioEncoding {
  /** Shown on the page. */
  label: string;
  /** The FFmpeg arguments that encode the audio. */
  args: (settings: FormatSettings) => string[];
  /** The format's controls, shown under the "Audio format" dropdown. */
  Panel: (props: { settings: FormatSettings; set: SetSetting }) => React.ReactNode;
  /** Set when the format can't hold more than two channels, so audio with more is always downmixed. */
  stereoOnly?: true;
}

/** Reuse an "Audio" output type format's arguments, settings panel and channel limit. */
const fromFormat = (label: string, codec: Codec): AudioEncoding =>
  ({ label, args: FORMATS[codec].args, Panel: FORMATS[codec].Panel, stereoOnly: FORMATS[codec].stereoOnly });

/** For formats only used in videos, whose only setting is the bitrate. */
const withBitrateSlider = (key: 'wmaBitrate' | 'mp2Bitrate', min: number, max: number, step: number) =>
  ({ settings, set }: { settings: FormatSettings; set: SetSetting }) =>
    <LabeledSlider id={key} label="Bitrate" unit="kbps" value={settings[key]} onChange={v => set(key, v)} min={min} max={max} step={step} />;

export const VIDEO_AUDIO_FORMATS: Record<VideoAudioFormat, AudioEncoding> = {
  AAC: fromFormat('AAC', 'AAC'),
  AC3: fromFormat('AC3 (Dolby Digital)', 'AC3'),
  ALAC: fromFormat('ALAC (Apple Lossless)', 'ALAC'),
  DTS: fromFormat('DTS', 'DTS'),
  FLAC: fromFormat('FLAC', 'FLAC'),
  MP3: fromFormat('MP3', 'MP3'),
  Opus: fromFormat('Opus', 'Opus'),
  Vorbis: fromFormat('Vorbis', 'Vorbis'),
  PCM: fromFormat('PCM (uncompressed)', 'WAV'),
  WMA: {
    label: 'WMA (Windows Media Audio)',
    args: s => ['-c:a', 'wmav2', '-b:a', `${s.wmaBitrate}k`],
    Panel: withBitrateSlider('wmaBitrate', 64, 320, 32),
    stereoOnly: true,
  },
  MP2: {
    label: 'MP2 (MPEG audio layer II)',
    args: s => ['-c:a', 'mp2', '-b:a', `${s.mp2Bitrate}k`],
    Panel: withBitrateSlider('mp2Bitrate', 64, 384, 32),
    stereoOnly: true,
  },
};

interface ContainerInfo {
  label: string;
  /**
   * The audio formats the audio can be re-encoded to; the first is the default. Found by
   * encoding 48 kHz 5.1 audio into each container with the cores, leaving out pairings that
   * FFmpeg writes but players don't support (such as FLAC in MPEG-TS).
   */
  audioFormats?: VideoAudioFormat[];
  /** For containers that hold only one audio format, with fixed settings: the audio is always encoded this way. */
  fixedAudio?: { label: string; args: string[]; stereoOnly?: true };
  /** The audio choice when this container is picked. Re-encoding, unless set. */
  defaultAudio?: 'copy';
  /** Set when the audio can't be copied into this container as it is, so it's always re-encoded. */
  noAudioCopy?: true;
  /** Set when the container can hold only one audio track. */
  singleAudioTrack?: true;
}

export const CONTAINERS: Record<Container, ContainerInfo> = {
  mp4: { label: 'MP4 (.mp4)', audioFormats: ['AAC', 'AC3', 'ALAC', 'DTS', 'MP3', 'Opus', 'MP2'] },
  webm: { label: 'WebM (.webm)', audioFormats: ['Opus', 'Vorbis'] },
  // Matroska and NUT hold almost any audio format, so the audio is kept as it is by default.
  mkv: { label: 'Matroska (.mkv)', audioFormats: ['AAC', 'AC3', 'ALAC', 'DTS', 'FLAC', 'MP3', 'Opus', 'Vorbis', 'PCM', 'WMA', 'MP2'],
    defaultAudio: 'copy' },
  mov: { label: 'QuickTime (.mov)', audioFormats: ['AAC', 'AC3', 'ALAC', 'DTS', 'MP3', 'PCM', 'MP2'] },
  avi: { label: 'AVI (.avi)', audioFormats: ['AAC', 'AC3', 'DTS', 'MP3', 'PCM', 'WMA', 'MP2'] },
  nut: { label: 'NUT (.nut)', audioFormats: ['AAC', 'AC3', 'DTS', 'FLAC', 'MP3', 'Opus', 'Vorbis', 'PCM', 'WMA', 'MP2'],
    defaultAudio: 'copy' },
  flv: { label: 'Flash Video (.flv)', audioFormats: ['AAC', 'MP3'], singleAudioTrack: true },
  // AAC and the rest also go into WMV, but Windows' own players expect WMA.
  wmv: { label: 'Windows Media (.wmv)', audioFormats: ['WMA', 'MP3', 'AC3', 'PCM'] },
  // MPEG program streams (as on DVDs) can't hold AAC.
  mpg: { label: 'MPEG program stream (.mpg)', audioFormats: ['MP2', 'AC3', 'MP3', 'DTS'] },
  ts: { label: 'MPEG transport stream (.ts)', audioFormats: ['AAC', 'AC3', 'DTS', 'MP3', 'Opus', 'MP2'] },
  ogv: { label: 'Ogg (.ogv)', audioFormats: ['Vorbis', 'Opus', 'FLAC'] },
  '3gp': { label: '3GP (.3gp)', audioFormats: ['AAC'] },
  rm: { label: 'RealMedia (.rm)', audioFormats: ['AAC', 'AC3'], singleAudioTrack: true },
  // DV holds 16-bit PCM at 48 kHz only.
  dv: { label: 'DV (.dv)', fixedAudio: { label: '16-bit PCM, 48 kHz stereo', args: ['-c:a', 'pcm_s16le', '-ar', '48000', '-ac', '2'] },
    noAudioCopy: true, singleAudioTrack: true },
  // MXF takes 16- or 24-bit PCM, but not 32-bit, so it isn't offered the PCM format's settings.
  mxf: { label: 'MXF (.mxf)', fixedAudio: { label: '16-bit PCM, 48 kHz', args: ['-c:a', 'pcm_s16le', '-ar', '48000'] } },
  // AMV holds mono 22050 Hz IMA ADPCM audio only, in blocks of one video frame each (22050 / 30 fps).
  amv: { label: 'AMV (.amv)', fixedAudio: { label: 'IMA ADPCM, 22 kHz mono',
    args: ['-c:a', 'adpcm_ima_amv', '-ar', '22050', '-ac', '1', '-block_size', '735'] }, noAudioCopy: true, singleAudioTrack: true },
  // RoQ holds mono or stereo 22050 Hz RoQ DPCM audio only.
  roq: { label: 'id RoQ (.roq)', fixedAudio: { label: 'RoQ DPCM, 22 kHz', args: ['-c:a', 'roq_dpcm', '-ar', '22050'], stereoOnly: true },
    noAudioCopy: true, singleAudioTrack: true },
  a64: { label: 'Commodore 64 (.a64)' },
  gif: { label: 'GIF (.gif)' },
  apng: { label: 'Animated PNG (.apng)' },
  webp: { label: 'Animated WebP (.webp)' },
};

/** Whether the container can hold audio at all (GIF, for one, can't). */
export const containerHoldsAudio = (container: Container): boolean =>
  Boolean(CONTAINERS[container].audioFormats || CONTAINERS[container].fixedAudio);

type Group = 'Popular' | 'Lossless and editing' | 'Older and specialised' | 'Uncompressed' | 'Image codecs';

interface VideoEncoder {
  /** Shown in the "Video encoder" dropdown. */
  label: string;
  group: Group;
  /** The containers this encoder can be written to; the first is the default. */
  containers: Container[];
  /** FFmpeg arguments after `-c:v <encoder>`, e.g. its quality setting. */
  args?: (settings: FormatSettings) => string[];
  /** The encoder's own controls, if it has any. */
  Panel?: (props: { settings: FormatSettings; set: SetSetting }) => React.ReactNode;
  /** Shown under the encoder's settings, e.g. a size it always outputs. */
  note?: string;
}

// ---------------------------------------------------------------------------
// Settings shared by several encoders.
// ---------------------------------------------------------------------------

const X26X_PRESETS = ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow']
  .map(preset => [preset, preset] as const);

const PresetSelect = ({ value, onChange }: { value: string; onChange: (value: string) => void }) =>
  <SelectField id="video_preset" label="Preset" value={value} onChange={onChange} options={X26X_PRESETS}
    helperText="Slower presets make a smaller file at the same quality, but take longer. Encoding in a browser is slow, so a fast preset is the default." />;

/** -q:v for FFmpeg's own MPEG-style encoders: 1 is the best quality, 31 the worst. */
const qscale = (s: FormatSettings) => ['-q:v', s.videoQscale];
const QscalePanel = ({ settings, set }: { settings: FormatSettings; set: SetSetting }) => <>
  <LabeledSlider id="video_qscale" label="Quality scale" value={settings.videoQscale}
    onChange={v => set('videoQscale', v)} min={1} max={31} step={1} />
  <SettingNote>A lower value means higher quality and a larger file. 2 to 5 is usually a good range.</SettingNote>
</>;

/** For encoders whose quality depends only on the bitrate. */
const bitrate = (s: FormatSettings) => ['-b:v', `${s.videoBitrate}k`];
const BitratePanel = ({ settings, set }: { settings: FormatSettings; set: SetSetting }) => <>
  <LabeledSlider id="video_bitrate" label="Bitrate" unit="kbps" value={settings.videoBitrate}
    onChange={v => set('videoBitrate', v)} min={500} max={20000} step={500} />
  <SettingNote>A higher bitrate allows for higher quality, at the expense of a larger file size.</SettingNote>
</>;

const LOSSLESS = 'This encoder is lossless, so it has no quality settings. Expect a large file.';
const UNCOMPRESSED = 'This stores the video uncompressed, so the file will be very large.';
const IMAGE = 'Each frame is stored as a separate image, so the file will be large.';

const lossless = (label: string, containers: Container[], args?: VideoEncoder['args']): VideoEncoder =>
  ({ label, group: 'Lossless and editing', containers, args, note: LOSSLESS });
const uncompressed = (label: string, containers: Container[]): VideoEncoder =>
  ({ label, group: 'Uncompressed', containers, note: UNCOMPRESSED });
const image = (label: string, containers: Container[], args?: VideoEncoder['args']): VideoEncoder =>
  ({ label, group: 'Image codecs', containers, args, note: IMAGE });
const older = (label: string, containers: Container[], extra: Partial<VideoEncoder> = {}): VideoEncoder =>
  ({ label, group: 'Older and specialised', containers, ...extra });
const withQscale = { args: qscale, Panel: QscalePanel };
const withBitrate = { args: bitrate, Panel: BitratePanel };

/** Scale to fit within width x height, keeping the aspect ratio, and pad to exactly that size. */
const fitInto = (width: number, height: number) =>
  `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

const COMMON_VIDEO = ['mkv', 'mov', 'avi', 'nut'] as const satisfies Container[];
const AVI_ONLY = ['avi'] as const satisfies Container[];

// ---------------------------------------------------------------------------
// The encoders, keyed by FFmpeg's name for them (-c:v <name>).
// ---------------------------------------------------------------------------

export const VIDEO_ENCODERS: Record<string, VideoEncoder> = {
  // Popular ------------------------------------------------------------------
  libx264: {
    label: 'H.264 / AVC (libx264)',
    group: 'Popular',
    containers: ['mp4', 'mkv', 'mov', 'ts', 'flv', 'avi', 'nut'],
    // yuv420p is the only pixel format most players can decode.
    args: s => ['-crf', s.x264Crf, '-preset', s.x264Preset, '-pix_fmt', 'yuv420p'],
    Panel: ({ settings, set }) => <>
      <LabeledSlider id="x264_crf" label="CRF" value={settings.x264Crf} onChange={v => set('x264Crf', v)} min={0} max={51} step={1} />
      <SettingNote>A lower CRF means higher quality and a larger file. 18 to 28 is the usual range, and 23 is the default.</SettingNote>
      <PresetSelect value={settings.x264Preset} onChange={v => set('x264Preset', v)} />
    </>,
  },
  libx265: {
    label: 'H.265 / HEVC (libx265)',
    group: 'Popular',
    containers: ['mp4', 'mkv', 'mov', 'ts', 'nut'],
    // hvc1 is the tag Apple's players need to play HEVC in MP4 or MOV.
    args: s => ['-crf', s.x265Crf, '-preset', s.x265Preset, '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'],
    // x265 always starts its own threads, which never run in the single-threaded core, so it hangs there.
    note: 'H.265 needs multi-threaded FFmpeg. In browsers that don\'t allow it here, the conversion won\'t finish.',
    Panel: ({ settings, set }) => <>
      <LabeledSlider id="x265_crf" label="CRF" value={settings.x265Crf} onChange={v => set('x265Crf', v)} min={0} max={51} step={1} />
      <SettingNote>A lower CRF means higher quality and a larger file. 28 is the default, and gives about the same quality as H.264 at CRF 23.</SettingNote>
      <PresetSelect value={settings.x265Preset} onChange={v => set('x265Preset', v)} />
    </>,
  },
  'libvpx-vp9': {
    label: 'VP9 (libvpx-vp9)',
    group: 'Popular',
    containers: ['webm', 'mkv', 'mp4', 'nut'],
    // -b:v 0 makes the CRF a constant quality rather than a quality with a bitrate cap.
    args: s => ['-crf', s.vpxCrf, '-b:v', '0', '-deadline', 'good', '-cpu-used', s.vpxSpeed, '-row-mt', '1', '-pix_fmt', 'yuv420p'],
    Panel: ({ settings, set }) => <>
      <LabeledSlider id="vpx_crf" label="CRF" value={settings.vpxCrf} onChange={v => set('vpxCrf', v)} min={0} max={63} step={1} />
      <SettingNote>A lower CRF means higher quality and a larger file. 15 to 35 is the usual range.</SettingNote>
      <LabeledSlider id="vpx_speed" label="Speed" value={settings.vpxSpeed} onChange={v => set('vpxSpeed', v)} min={0} max={5} step={1} />
      <SettingNote>A higher speed encodes faster, at a slightly lower quality for the size.</SettingNote>
    </>,
  },
  'libaom-av1': {
    label: 'AV1 (libaom)',
    group: 'Popular',
    containers: ['webm', 'mkv', 'mp4'],
    note: 'Works with or without multi-threading. AV1 makes smaller files than H.264 or VP9 at the same quality, '
      + 'but takes longer to encode.',
    // The cores' libaom is built for realtime mode only: in WebAssembly its "good" mode took about
    // 13 times as long for about 1 dB more quality. Even so, it beat SVT-AV1 here: at speed 6 it
    // matched SVT-AV1 preset 10's file size at about 1.5 dB more quality, in half the time.
    // -b:v 0 makes the CRF a constant quality.
    args: s => ['-usage', 'realtime', '-cpu-used', s.aomSpeed, '-crf', s.aomCrf, '-b:v', '0', '-row-mt', '1', '-pix_fmt', 'yuv420p'],
    Panel: ({ settings, set }) => <>
      <LabeledSlider id="aom_crf" label="CRF" value={settings.aomCrf} onChange={v => set('aomCrf', v)} min={0} max={63} step={1} />
      <SettingNote>A lower CRF means higher quality and a larger file. 32 is the default; 25 to 40 is the usual range.</SettingNote>
      <LabeledSlider id="aom_speed" label="Speed" value={settings.aomSpeed} onChange={v => set('aomSpeed', v)} min={5} max={8} step={1} />
      <SettingNote>
        A higher speed encodes faster, at a lower quality for the size. Speed 6 takes about three times as long as
        speed 8, for noticeably better quality.
      </SettingNote>
    </>,
  },
  libsvtav1: {
    label: 'AV1 (SVT-AV1)',
    group: 'Popular',
    containers: ['webm', 'mkv', 'mp4'],
    // SVT-AV1 always encodes with threads, so it's only in the multi-threaded core. lp=1 keeps
    // it to the fewest: with more, it starts more threads than the core's fixed pool of web
    // workers and waits forever for one at the first frame.
    args: s => ['-crf', s.av1Crf, '-preset', s.av1Preset, '-svtav1-params', 'lp=1', '-pix_fmt', 'yuv420p'],
    note: 'SVT-AV1 needs multi-threaded FFmpeg. In a browser it\'s slower than the libaom AV1 encoder for the '
      + 'same quality, as it can only run with its fewest threads here, so libaom is usually the better choice.',
    Panel: ({ settings, set }) => <>
      <LabeledSlider id="av1_crf" label="CRF" value={settings.av1Crf} onChange={v => set('av1Crf', v)} min={0} max={63} step={1} />
      <SettingNote>A lower CRF means higher quality and a larger file. 35 is the default; 25 to 40 is the usual range.</SettingNote>
      <LabeledSlider id="av1_preset" label="Speed" value={settings.av1Preset} onChange={v => set('av1Preset', v)} min={4} max={12} step={1} />
      <SettingNote>A higher speed encodes faster, at a lower quality for the size. Encoding in a browser is slow, so a fast speed is the default.</SettingNote>
    </>,
  },
  libvpx: {
    label: 'VP8 (libvpx)',
    group: 'Popular',
    containers: ['webm', 'mkv', 'avi', 'nut'],
    // VP8 needs a bitrate with a CRF; it's then the most the CRF may use.
    args: s => ['-crf', s.vp8Crf, '-b:v', '20M', '-deadline', 'good', '-cpu-used', s.vpxSpeed, '-pix_fmt', 'yuv420p'],
    Panel: ({ settings, set }) => <>
      <LabeledSlider id="vp8_crf" label="CRF" value={settings.vp8Crf} onChange={v => set('vp8Crf', v)} min={4} max={63} step={1} />
      <SettingNote>A lower CRF means higher quality and a larger file. 10 is a good starting point.</SettingNote>
      <LabeledSlider id="vpx_speed" label="Speed" value={settings.vpxSpeed} onChange={v => set('vpxSpeed', v)} min={0} max={5} step={1} />
      <SettingNote>A higher speed encodes faster, at a slightly lower quality for the size.</SettingNote>
    </>,
  },
  mpeg4: { label: 'MPEG-4 part 2 (mpeg4)', group: 'Popular', containers: ['mp4', 'mkv', 'mov', 'avi', 'nut'], ...withQscale },
  libtheora: {
    label: 'Theora (libtheora)',
    group: 'Popular',
    containers: ['ogv', 'mkv', 'mov', 'avi', 'nut'],
    args: s => ['-q:v', s.theoraQuality],
    Panel: ({ settings, set }) => <>
      <LabeledSlider id="theora_quality" label="Quality" value={settings.theoraQuality}
        onChange={v => set('theoraQuality', v)} min={0} max={10} step={1} />
      <SettingNote>Quality range is from 0 (lowest) to 10 (highest).</SettingNote>
    </>,
  },
  gif: {
    label: 'GIF (gif)',
    group: 'Popular',
    containers: ['gif', 'mkv', 'mov', 'avi', 'nut'],
    // A palette made from the video itself looks far better than GIF's default one. It's made
    // for each frame (stats_mode=single, new=1): one palette for the whole video can't be made
    // until the last frame is read, so every frame would be held in memory until then, and
    // anything but a short clip would run out of memory.
    args: () => ['-vf', 'split[a][b];[a]palettegen=stats_mode=single[p];[b][p]paletteuse=new=1'],
    note: 'GIF has no audio, and holds at most 256 colours per frame. Long or large videos make very large GIFs.',
  },
  libwebp_anim: {
    label: 'Animated WebP (libwebp_anim)',
    group: 'Popular',
    containers: ['webp'],
    args: s => ['-quality', s.webpQuality, '-loop', '0'],
    Panel: ({ settings, set }) => <>
      <LabeledSlider id="webp_quality" label="Quality" value={settings.webpQuality}
        onChange={v => set('webpQuality', v)} min={0} max={100} step={5} />
      <SettingNote>Quality range is from 0 (lowest) to 100 (highest). Animated WebP has no audio.</SettingNote>
    </>,
  },
  apng: {
    label: 'Animated PNG (apng)',
    group: 'Popular',
    containers: ['apng', 'avi'],
    args: () => ['-plays', '0'],
    note: 'Animated PNG is lossless and has no audio, so files are large.',
  },

  // Lossless and editing ------------------------------------------------------
  prores_ks: {
    label: 'Apple ProRes (prores_ks)',
    group: 'Lossless and editing',
    containers: ['mov', 'mkv', 'avi', 'nut'],
    args: s => ['-profile:v', s.proresProfile],
    Panel: ({ settings, set }) =>
      <SelectField id="prores_profile" label="Profile" value={settings.proresProfile} onChange={v => set('proresProfile', v)}
        options={[['0', 'Proxy'], ['1', 'LT'], ['2', 'Standard'], ['3', 'HQ'], ['4', '4444'], ['5', '4444 XQ']]}
        helperText="Higher profiles keep more detail and make larger files." />,
  },
  prores: { label: 'Apple ProRes (prores)', group: 'Lossless and editing', containers: ['mov', 'mkv', 'avi', 'nut'] },
  prores_aw: { label: 'Apple ProRes (prores_aw)', group: 'Lossless and editing', containers: ['mov', 'mkv', 'avi', 'nut'] },
  dnxhd: {
    label: 'Avid DNxHR (dnxhd)',
    group: 'Lossless and editing',
    containers: ['mov', 'mxf', 'mkv', 'avi', 'nut'],
    // DNxHR (unlike DNxHD) works at any frame size. Each profile takes one pixel format.
    args: s => ['-profile:v', s.dnxhrProfile, '-pix_fmt', s.dnxhrProfile === 'dnxhr_444' ? 'yuv444p10le'
      : s.dnxhrProfile === 'dnxhr_hqx' ? 'yuv422p10le' : 'yuv422p'],
    Panel: ({ settings, set }) =>
      <SelectField id="dnxhr_profile" label="Profile" value={settings.dnxhrProfile} onChange={v => set('dnxhrProfile', v)}
        options={[['dnxhr_lb', 'LB (low bandwidth)'], ['dnxhr_sq', 'SQ (standard quality)'], ['dnxhr_hq', 'HQ (high quality)'],
          ['dnxhr_hqx', 'HQX (10-bit)'], ['dnxhr_444', '444 (10-bit 4:4:4)']]}
        helperText="Higher profiles keep more detail and make larger files." />,
  },
  cfhd: { label: 'GoPro CineForm HD (cfhd)', group: 'Lossless and editing', containers: [...COMMON_VIDEO] },
  ffv1: lossless('FFV1 (ffv1)', [...COMMON_VIDEO]),
  ffvhuff: lossless('Huffyuv FFmpeg variant (ffvhuff)', [...COMMON_VIDEO]),
  huffyuv: lossless('Huffyuv (huffyuv)', ['avi', 'mkv', 'mov', 'nut']),
  utvideo: lossless('Ut Video (utvideo)', ['avi', 'mkv', 'mov', 'nut']),
  magicyuv: lossless('MagicYUV (magicyuv)', ['avi', 'mkv', 'mov', 'nut']),
  libx264rgb: lossless('H.264 RGB, lossless (libx264rgb)', ['mkv', 'mp4', 'mov', 'avi', 'nut'], () => ['-qp', '0', '-preset', 'veryfast']),
  png: lossless('PNG (png)', ['mov', 'mkv', 'mp4', 'avi', 'nut']),
  qtrle: lossless('QuickTime Animation (qtrle)', ['mov', 'mkv', 'avi']),
  zlib: lossless('LCL ZLIB (zlib)', ['avi', 'mkv', 'mov', 'nut']),
  zmbv: lossless('Zip Motion Blocks Video (zmbv)', ['avi', 'mkv', 'mov', 'nut']),
  // Limited-range YUV (what most video uses) is non-standard in lossless JPEG, so it needs -strict -1.
  ljpeg: lossless('Lossless JPEG (ljpeg)', ['avi', 'mkv', 'mov', 'nut'], () => ['-strict', '-1']),
  jpegls: lossless('JPEG-LS (jpegls)', ['avi', 'mkv', 'mov', 'nut']),
  vc2: { label: 'SMPTE VC-2 / Dirac (vc2)', group: 'Lossless and editing', containers: ['mkv', 'mp4', 'mov', 'avi', 'nut'], ...withBitrate },
  speedhq: { label: 'NewTek SpeedHQ (speedhq)', group: 'Lossless and editing', containers: [...COMMON_VIDEO], ...withQscale },
  mjpeg: { label: 'Motion JPEG (mjpeg)', group: 'Lossless and editing', containers: ['avi', 'mkv', 'mov', 'mp4', 'nut'], ...withQscale },
  jpeg2000: { label: 'JPEG 2000 (jpeg2000)', group: 'Lossless and editing', containers: ['mov', 'mkv', 'avi', 'mxf', 'nut'], ...withQscale },
  dvvideo: older('DV (dvvideo)', ['dv', 'mov', 'avi', 'mkv'], {
    group: 'Lossless and editing',
    // DV is PAL (720x576, 25 fps) or NTSC; PAL is used here.
    args: () => ['-vf', fitInto(720, 576), '-r', '25', '-pix_fmt', 'yuv420p'],
    note: 'DV is always 720x576 (PAL) at 25 fps, so the video is resized to fit.',
  }),
  avui: older('Avid Meridien Uncompressed (avui)', ['mov'], {
    group: 'Uncompressed',
    // The encoder is marked experimental. It's only for 720x486 (NTSC) or 720x576 (PAL).
    args: () => ['-vf', fitInto(720, 576), '-strict', '-2'],
    note: `${UNCOMPRESSED} It's always 720x576, so the video is resized to fit.`,
  }),

  // Older and specialised -----------------------------------------------------
  mpeg2video: older('MPEG-2 (mpeg2video)', ['mpg', 'ts', 'mkv', 'mov', 'mp4', 'avi', 'nut'], withQscale),
  mpeg1video: older('MPEG-1 (mpeg1video)', ['mpg', 'mkv', 'mov', 'mp4', 'avi', 'nut'], withQscale),
  h263p: older('H.263+ (h263p)', ['mkv', 'mov', 'avi', 'nut'], withQscale),
  h263: older('H.263 (h263)', ['3gp', 'mkv', 'mov', 'avi', 'nut'], {
    // H.263 only allows a few frame sizes; 4CIF is the largest common one.
    args: s => ['-vf', fitInto(704, 576), ...qscale(s)],
    Panel: QscalePanel,
    note: 'H.263 only allows a few frame sizes, so the video is resized to fit 704x576.',
  }),
  h261: older('H.261 (h261)', ['avi', 'mkv', 'mov', 'nut'], {
    args: s => ['-vf', fitInto(352, 288), ...qscale(s)],
    Panel: QscalePanel,
    note: 'H.261 only allows 176x144 and 352x288, so the video is resized to fit 352x288.',
  }),
  flv: older('Sorenson H.263 / Flash Video (flv)', ['flv', 'mkv', 'mov', 'avi', 'nut'], withQscale),
  msmpeg4: older('MPEG-4 part 2 Microsoft variant v3 (msmpeg4)', ['avi', 'mkv', 'mov', 'nut'], withQscale),
  msmpeg4v2: older('MPEG-4 part 2 Microsoft variant v2 (msmpeg4v2)', ['avi', 'mkv', 'mov', 'nut'], withQscale),
  wmv2: older('Windows Media Video 8 (wmv2)', ['wmv', 'avi', 'mkv', 'mov', 'nut'], withQscale),
  wmv1: older('Windows Media Video 7 (wmv1)', ['wmv', 'avi', 'mkv', 'mov', 'nut'], withQscale),
  rv20: older('RealVideo 2.0 (rv20)', ['rm', 'avi'], withQscale),
  rv10: older('RealVideo 1.0 (rv10)', ['rm', 'avi'], {
    // RealVideo 1.0's frame size must be a multiple of 16, so a few edge pixels may be cropped.
    args: s => ['-vf', 'crop=trunc(iw/16)*16:trunc(ih/16)*16', ...qscale(s)],
    Panel: QscalePanel,
  }),
  svq1: older('Sorenson Video 1 (svq1)', ['mov', 'mkv', 'avi', 'nut']),
  snow: older('Snow (snow)', ['avi', 'mkv', 'nut'], withQscale),
  cinepak: older('Cinepak (cinepak)', ['avi', 'mov', 'mkv', 'nut'], { note: 'Cinepak encodes very slowly.' }),
  msvideo1: older('Microsoft Video-1 (msvideo1)', ['avi', 'mkv', 'mov', 'nut']),
  rpza: older('QuickTime video RPZA (rpza)', ['mov', 'mkv', 'avi']),
  smc: older('QuickTime Graphics SMC (smc)', ['mov', 'mkv', 'avi']),
  flashsv: older('Flash Screen Video (flashsv)', ['flv', 'mkv', 'mov', 'avi', 'nut']),
  flashsv2: older('Flash Screen Video 2 (flashsv2)', ['flv', 'avi']),
  asv1: older('ASUS V1 (asv1)', ['avi', 'mkv', 'mov', 'nut'], withBitrate),
  asv2: older('ASUS V2 (asv2)', ['avi', 'mkv', 'mov', 'nut'], withBitrate),
  amv: older('AMV video (amv)', ['amv', 'avi', 'mkv', 'mov', 'nut'], {
    // AMV players expect a small frame at a fixed rate; the muxer needs -strict -1 for the audio.
    args: s => ['-vf', fitInto(320, 240), '-r', '30', '-pix_fmt', 'yuvj420p', '-strict', '-1', ...qscale(s)],
    Panel: QscalePanel,
    note: 'AMV video is resized to fit 320x240, at 30 fps.',
  }),
  roqvideo: older('id RoQ (roqvideo)', ['roq', 'avi'], {
    // RoQ's frame size must be a multiple of 16; 30 fps is what RoQ players expect.
    args: () => ['-vf', fitInto(640, 352), '-r', '30'],
    note: 'RoQ video is resized to fit 640x352, at 30 fps.',
  }),
  a64multi: older('Commodore 64 multicolor charset (a64multi)', ['a64', ...COMMON_VIDEO], {
    args: () => ['-vf', fitInto(320, 200)],
    note: 'Commodore 64 video is resized to fit 320x200.',
  }),
  a64multi5: older('Commodore 64 multicolor charset, 5th color (a64multi5)', ['a64', ...COMMON_VIDEO], {
    args: () => ['-vf', fitInto(320, 200)],
    note: 'Commodore 64 video is resized to fit 320x200.',
  }),
  cljr: older('Cirrus Logic AccuPak (cljr)', [...COMMON_VIDEO]),
  xface: older('X-Face (xface)', ['avi'], {
    // X-Face images are always 48x48, black and white.
    args: () => ['-vf', fitInto(48, 48)],
    note: 'X-Face is always 48x48 in black and white, so the video is resized to fit.',
  }),

  // Uncompressed ---------------------------------------------------------------
  rawvideo: uncompressed('Raw video (rawvideo)', [...COMMON_VIDEO]),
  v210: uncompressed('10-bit 4:2:2 (v210)', ['mov', 'mkv', 'avi', 'nut']),
  v308: uncompressed('Packed 4:4:4 (v308)', ['mov', 'mkv', 'avi', 'nut']),
  v408: uncompressed('Packed QT 4:4:4:4 (v408)', ['mov', 'mkv', 'avi', 'nut']),
  v410: uncompressed('10-bit 4:4:4 (v410)', ['mov', 'mkv', 'avi', 'nut']),
  ayuv: uncompressed('Packed MS 4:4:4:4 (ayuv)', ['avi', 'mkv', 'mov', 'nut']),
  y41p: uncompressed('YUV 4:1:1 12-bit (y41p)', ['avi', 'mkv', 'mov', 'nut']),
  yuv4: uncompressed('Packed 4:2:0 (yuv4)', ['avi', 'mkv', 'mov', 'nut']),
  r210: uncompressed('10-bit RGB (r210)', ['mov', 'mkv', 'avi', 'nut']),
  r10k: uncompressed('AJA Kona 10-bit RGB (r10k)', ['mov', 'mkv', 'avi', 'nut']),
  avrp: uncompressed('Avid 1:1 10-bit RGB Packer (avrp)', ['mov', 'mkv', 'avi']),
  bitpacked: uncompressed('Bitpacked (bitpacked)', ['avi']),

  // Image codecs -------------------------------------------------------------
  libwebp: image('WebP (libwebp)', ['avi']),
  bmp: image('BMP (bmp)', AVI_ONLY.slice()),
  tiff: image('TIFF (tiff)', ['mov', 'mkv', 'avi']),
  targa: image('Truevision Targa (targa)', [...COMMON_VIDEO]),
  dpx: image('DPX (dpx)', [...COMMON_VIDEO]),
  exr: image('OpenEXR (exr)', ['mkv', 'mov', 'avi']),
  sgi: image('SGI (sgi)', ['mov', 'mkv', 'avi']),
  qoi: image('QOI (qoi)', AVI_ONLY.slice()),
  pcx: image('PC Paintbrush PCX (pcx)', AVI_ONLY.slice()),
  pam: image('PAM (pam)', AVI_ONLY.slice()),
  pbm: image('PBM, black and white (pbm)', AVI_ONLY.slice()),
  pgm: image('PGM, greyscale (pgm)', AVI_ONLY.slice()),
  pgmyuv: image('PGMYUV (pgmyuv)', AVI_ONLY.slice()),
  ppm: image('PPM (ppm)', AVI_ONLY.slice()),
  pfm: image('PFM (pfm)', AVI_ONLY.slice()),
  phm: image('PHM (phm)', AVI_ONLY.slice()),
  fits: image('FITS (fits)', AVI_ONLY.slice()),
  sunrast: image('Sun Rasterfile (sunrast)', AVI_ONLY.slice()),
  alias_pix: image('Alias/Wavefront PIX (alias_pix)', AVI_ONLY.slice()),
  xbm: image('X BitMap, black and white (xbm)', AVI_ONLY.slice()),
  xwd: image('X Window Dump (xwd)', AVI_ONLY.slice()),
  // Its default DXT compression only takes RGBA.
  vbn: image('Vizrt Binary Image (vbn)', AVI_ONLY.slice(), () => ['-pix_fmt', 'rgba']),
};

export const DEFAULT_VIDEO_ENCODER = 'libx264';

/** The chosen encoder, or the default if the saved one no longer exists. */
export const videoEncoderOf = (settings: FormatSettings): string =>
  Object.hasOwn(VIDEO_ENCODERS, settings.videoEncoder) ? settings.videoEncoder : DEFAULT_VIDEO_ENCODER;

/** The chosen container if the encoder supports it, else the encoder's default. */
export const videoContainerOf = (settings: FormatSettings): Container => {
  const { containers } = VIDEO_ENCODERS[videoEncoderOf(settings)];
  return containers.includes(settings.videoContainer as Container) ? settings.videoContainer as Container : containers[0];
};

/**
 * How a re-encoded video's audio is encoded: the container's fixed audio, or the chosen audio
 * format if the container takes it, else the container's default. Undefined if it holds no audio.
 */
export const videoAudioEncodingOf = (settings: FormatSettings):
  { format?: VideoAudioFormat; label: string; args: string[]; stereoOnly?: true } | undefined => {
  const container = CONTAINERS[videoContainerOf(settings)];
  if (container.fixedAudio) return container.fixedAudio;
  if (!container.audioFormats) return undefined;
  const format = container.audioFormats.includes(settings.videoAudioFormat as VideoAudioFormat)
    ? settings.videoAudioFormat as VideoAudioFormat : container.audioFormats[0];
  const { label, args, stereoOnly } = VIDEO_AUDIO_FORMATS[format];
  return { format, label, args: args(settings), stereoOnly };
};
