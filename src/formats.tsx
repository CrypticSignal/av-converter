/**
 * Every output format the converter offers. Each entry in FORMATS says how the format
 * appears in the dropdown, which FFmpeg arguments it uses, and which settings it shows.
 */
import React from 'react';
import LabeledSlider from './components/LabeledSlider';
import SelectField from './components/SelectField';
import SettingNote from './components/SettingNote';

export type Codec = 'AAC' | 'AC3' | 'ALAC' | 'CAF' | 'DTS' | 'FLAC' | 'MKA' | 'MP3' | 'Opus' | 'Vorbis' | 'WAV';

/**
 * Every setting on the page, for all formats. Each format reads only its own
 * (e.g. MP3 reads mp3Bitrate, mp3EncodingType and mp3VbrSetting). Values are strings
 * because they come straight from form controls.
 */
export interface FormatSettings {
  // Shared by all formats; the homepage shows these controls itself.
  isKeepVideo: boolean;
  downmixToStereo: boolean;

  aacBitrate: string;
  ac3Bitrate: string;
  dtsBitrate: string;
  flacCompression: string;
  mp3Bitrate: string;
  mp3EncodingType: string;
  mp3VbrSetting: string;
  opusBitrate: string;
  opusEncodingType: string;
  vorbisBitrate: string;
  vorbisEncodingType: string;
  vorbisQuality: string;
  wavBitDepth: string;

  // The "Video" output type (see videoEncoders.tsx).
  /** 'audio' converts to one of FORMATS; 'video' re-encodes the video with one of VIDEO_ENCODERS. */
  outputType: 'audio' | 'video';
  videoEncoder: string;
  /** The container's extension, e.g. 'mp4'. Ignored if the encoder can't be written to it. */
  videoContainer: string;
  /** What happens to the audio: re-encoded to suit the container, copied as it is, or left out. */
  videoAudio: 'encode' | 'copy' | 'none';
  /** The audio format when the audio is re-encoded (see VIDEO_AUDIO_FORMATS). Ignored if the container can't hold it. */
  videoAudioFormat: string;
  /** 'original', or frames per second. */
  videoFps: string;
  /** 'original', or pixels. With only one of width and height set, the other keeps the aspect ratio. */
  videoWidth: string;
  videoHeight: string;
  wmaBitrate: string;
  mp2Bitrate: string;
  x264Crf: string;
  x264Preset: string;
  x265Crf: string;
  x265Preset: string;
  av1Crf: string;
  av1Preset: string;
  aomCrf: string;
  aomSpeed: string;
  vpxCrf: string;
  vp8Crf: string;
  vpxSpeed: string;
  theoraQuality: string;
  webpQuality: string;
  proresProfile: string;
  dnxhrProfile: string;
  /** -q:v for FFmpeg's own MPEG-style encoders. */
  videoQscale: string;
  /** In kbps, for encoders whose quality depends only on the bitrate. */
  videoBitrate: string;
}

export const DEFAULT_SETTINGS: FormatSettings = {
  isKeepVideo: false,
  downmixToStereo: false,
  aacBitrate: '192',
  ac3Bitrate: '640',
  dtsBitrate: '768',
  flacCompression: '5',
  mp3Bitrate: '192',
  mp3EncodingType: 'cbr',
  mp3VbrSetting: '0',
  opusBitrate: '192',
  opusEncodingType: 'vbr',
  vorbisBitrate: '192',
  vorbisEncodingType: 'abr',
  vorbisQuality: '6',
  wavBitDepth: '16',
  outputType: 'audio',
  videoEncoder: 'libx264',
  videoContainer: 'mp4',
  videoAudio: 'encode',
  videoAudioFormat: 'AAC',
  videoFps: 'original',
  videoWidth: 'original',
  videoHeight: 'original',
  wmaBitrate: '192',
  mp2Bitrate: '224',
  x264Crf: '23',
  x264Preset: 'veryfast',
  x265Crf: '28',
  x265Preset: 'veryfast',
  av1Crf: '35',
  av1Preset: '10',
  aomCrf: '32',
  aomSpeed: '8',
  vpxCrf: '31',
  vp8Crf: '10',
  vpxSpeed: '4',
  theoraQuality: '7',
  webpQuality: '75',
  proresProfile: '2',
  dnxhrProfile: 'dnxhr_hq',
  videoQscale: '3',
  videoBitrate: '5000',
};

/** Changes one setting, e.g. set('mp3Bitrate', '256'). */
export type SetSetting = <K extends keyof FormatSettings>(key: K, value: FormatSettings[K]) => void;

interface Format {
  /** Shown in the "Desired format" dropdown. */
  label: string;
  /** Extension of the output file when it's audio only. */
  extension: string;
  /**
   * Set when the format can keep the input's video alongside the new audio:
   * 'mp4' keeps an MP4 or MOV input's container (other inputs become MKV); 'mkv' always uses MKV.
   */
  keepVideo?: 'mp4' | 'mkv';
  /** Set when the audio is copied unchanged, so it can't be downmixed to stereo. */
  copiesAudio?: true;
  /** Set when the format can't hold more than two channels, so audio with more is always downmixed. */
  stereoOnly?: true;
  /** Set when the format keeps every audio track unless the user picks one. */
  allAudioTracks?: true;
  /**
   * The FFmpeg arguments that encode the audio. createFFmpegArgs adds the input, the output,
   * which streams to include (-map), and the shared options.
   */
  args: (settings: FormatSettings) => string[];
  /** The format's controls, shown under "Encoder settings". */
  Panel: (props: { settings: FormatSettings; set: SetSetting }) => React.ReactNode;
}

/** A bitrate slider, in kbps. */
const BitrateSlider = ({ value, onChange, min, max, step }: {
  value: string; onChange: (value: string) => void; min: number; max: number; step: number;
}) => <LabeledSlider id="bitrate" label="Bitrate" unit="kbps" value={value} onChange={onChange} min={min} max={max} step={step} />;

const MAX_6_CHANNELS = 'The maximum number of output channels is 6, so audio with more channels (such as 7.1 surround) will be downmixed to 5.1.';
const BITRATE_NOTE = 'A higher bitrate allows for potentially higher audio quality, at the expense of a larger file size.';
const NoSettings = () => <SettingNote>This format has no encoder settings.</SettingNote>;

export const FORMATS: Record<Codec, Format> = {
  AAC: {
    label: 'AAC',
    extension: '.aac',
    keepVideo: 'mp4',
    args: s => ['-c:a', 'aac', '-b:a', `${s.aacBitrate}k`],
    Panel: ({ settings, set }) =>
      <BitrateSlider value={settings.aacBitrate} onChange={v => set('aacBitrate', v)} min={32} max={256} step={32} />,
  },

  AC3: {
    label: 'AC3 (Dolby Digital)',
    extension: '.ac3',
    keepVideo: 'mp4',
    args: s => ['-c:a', 'ac3', '-b:a', `${s.ac3Bitrate}k`],
    Panel: ({ settings, set }) => <>
      <SettingNote>{MAX_6_CHANNELS}</SettingNote>
      <SelectField id="ac3_bitrate" label="Bitrate" value={settings.ac3Bitrate} onChange={v => set('ac3Bitrate', v)}
        options={[['192', '192 kbps'], ['384', '384 kbps'], ['448', '448 kbps'], ['640', '640 kbps']]}
        helperText={BITRATE_NOTE} />
    </>,
  },

  ALAC: {
    label: 'ALAC (.m4a)',
    extension: '.m4a',
    keepVideo: 'mp4',
    args: () => ['-c:a', 'alac'],
    Panel: NoSettings,
  },

  CAF: {
    label: 'CAF (.caf)',
    extension: '.caf',
    args: () => ['-c:a', 'alac'],
    Panel: NoSettings,
  },

  DTS: {
    label: 'DTS (.dts)',
    extension: '.dts',
    keepVideo: 'mkv',
    // FFmpeg's DTS encoder is marked experimental, so it needs -strict -2.
    args: s => ['-c:a', 'dca', '-b:a', `${s.dtsBitrate}k`, '-strict', '-2'],
    Panel: ({ settings, set }) => <>
      <SettingNote>{MAX_6_CHANNELS}</SettingNote>
      <BitrateSlider value={settings.dtsBitrate} onChange={v => set('dtsBitrate', v)} min={384} max={1536} step={128} />
      <SettingNote>{BITRATE_NOTE}</SettingNote>
    </>,
  },

  FLAC: {
    label: 'FLAC (.flac)',
    extension: '.flac',
    keepVideo: 'mkv',
    args: s => ['-c:a', 'flac', '-compression_level', s.flacCompression],
    Panel: ({ settings, set }) => <>
      <LabeledSlider id="flac_compression" label="Compression level" value={settings.flacCompression}
        onChange={v => set('flacCompression', v)} min={0} max={12} step={1} />
      <SettingNote>A higher value means a slightly smaller file size, but a longer conversion time.</SettingNote>
    </>,
  },

  MKA: {
    label: 'MKA (.mka)',
    extension: '.mka',
    copiesAudio: true,
    // An MKA file is usually made to keep all of a video's audio tracks.
    allAudioTracks: true,
    args: () => ['-c:a', 'copy'],
    Panel: NoSettings,
  },

  MP3: {
    label: 'MP3 (.mp3)',
    extension: '.mp3',
    stereoOnly: true,
    keepVideo: 'mp4',
    args: s => {
      if (s.mp3EncodingType === 'vbr') return ['-c:a', 'libmp3lame', '-q:a', s.mp3VbrSetting];
      if (s.mp3EncodingType === 'abr') return ['-c:a', 'libmp3lame', '-abr', '1', '-b:a', `${s.mp3Bitrate}k`];
      return ['-c:a', 'libmp3lame', '-b:a', `${s.mp3Bitrate}k`]; // CBR
    },
    Panel: ({ settings, set }) => <>
      <SelectField id="mp3_encoding_type" label="Encoding type" value={settings.mp3EncodingType}
        onChange={v => set('mp3EncodingType', v)} options={[
          ['cbr', 'CBR (Constant Bitrate)'],
          ['abr', 'ABR (Average Bitrate)'],
          ['vbr', 'VBR (Variable Bitrate)'],
        ]} />
      {settings.mp3EncodingType === 'vbr' ? (
        <SelectField id="mp3_vbr_setting" label="VBR setting" value={settings.mp3VbrSetting}
          onChange={v => set('mp3VbrSetting', v)}
          options={[
            ['0', '-V 0 (~240 kbps)'],
            ['1', '-V 1 (~220 kbps)'],
            ['2', '-V 2 (~190 kbps)'],
            ['3', '-V 3 (~170 kbps)'],
            ['4', '-V 4 (~160 kbps)'],
            ['5', '-V 5 (~130 kbps)'],
            ['6', '-V 6 (~120 kbps)'],
          ]}
          helperText={<>
            For more details about the settings, see the{' '}
            <a target="_blank" rel="noreferrer" className="underline"
              href="https://wiki.hydrogenaud.io/index.php?title=LAME#Recommended_settings_details">
              LAME recommended settings
            </a>.
          </>} />
      ) : (
        <BitrateSlider value={settings.mp3Bitrate} onChange={v => set('mp3Bitrate', v)} min={64} max={320} step={64} />
      )}
    </>,
  },

  Opus: {
    label: 'Opus (.opus)',
    extension: '.opus',
    args: s => ['-c:a', 'libopus', ...(s.opusEncodingType === 'cbr' ? ['-vbr', 'off'] : []), '-b:a', `${s.opusBitrate}k`],
    Panel: ({ settings, set }) => <>
      <SelectField id="opus_encoding_type" label="Encoding type" value={settings.opusEncodingType}
        onChange={v => set('opusEncodingType', v)}
        options={[['vbr', 'VBR (with a target bitrate)'], ['cbr', 'CBR (Constant Bitrate)']]} />
      <BitrateSlider value={settings.opusBitrate} onChange={v => set('opusBitrate', v)} min={16} max={512} step={16} />
      <SettingNote>
        Opus supports at most 256 kbps per channel. For mono audio, choose 256 kbps or less, or the
        conversion will fail.
      </SettingNote>
    </>,
  },

  Vorbis: {
    label: 'Vorbis (.ogg)',
    extension: '.ogg',
    args: s => ['-c:a', 'libvorbis',
      ...(s.vorbisEncodingType === 'abr' ? ['-b:a', `${s.vorbisBitrate}k`] : ['-q:a', s.vorbisQuality])],
    Panel: ({ settings, set }) => <>
      <SelectField id="vorbis_encoding_type" label="Encoding type" value={settings.vorbisEncodingType}
        onChange={v => set('vorbisEncodingType', v)}
        options={[['abr', 'ABR (Average Bitrate)'], ['vbr', 'VBR (target a quality level)']]} />
      {settings.vorbisEncodingType === 'abr' ? <>
        <BitrateSlider value={settings.vorbisBitrate} onChange={v => set('vorbisBitrate', v)} min={32} max={480} step={32} />
        <SettingNote>For mono audio, choose 224 kbps or less, or the conversion will fail.</SettingNote>
      </> : <>
        <LabeledSlider id="vorbis_quality" label="Quality" value={settings.vorbisQuality}
          onChange={v => set('vorbisQuality', v)} min={0} max={10} step={1} />
        <SettingNote>
          Quality range is from 0 (lowest) to 10 (highest). For more details, see the{' '}
          <a target="_blank" rel="noreferrer" className="underline"
            href="https://wiki.hydrogenaud.io/index.php?title=Recommended_Ogg_Vorbis#Recommended_Encoder_Settings">
            recommended encoder settings
          </a>{' '}
          and refer to the rows for -q 0 to -q 10.
        </SettingNote>
      </>}
    </>,
  },

  WAV: {
    label: 'WAV (.wav)',
    extension: '.wav',
    args: s => ['-c:a', `pcm_s${s.wavBitDepth}le`],
    Panel: ({ settings, set }) =>
      <SelectField id="wav_bit_depth" label="Output bit depth (audio)" value={settings.wavBitDepth}
        onChange={v => set('wavBitDepth', v)} options={[['16', '16-bit'], ['24', '24-bit'], ['32', '32-bit']]} />,
  },
};
