import React from 'react';
import BitrateSlider, { type BitrateSliderProps } from './components/BitrateSlider';
import AC3 from './components/AC3';
import DTS from './components/Dts';
import FLAC from './components/Flac';
import MP3EncodingTypeSelector from './components/MP3/EncodingTypeSelector';
import NoSettingsApplicable from './components/NoSettingsApplicable';
import Opus from './components/Opus';
import VorbisEncodingType from './components/Vorbis/EncodingType';
import WavBitDepthSelector from './components/WavBitDepthSelector';

export type Codec = 'AAC' | 'AC3' | 'ALAC' | 'CAF' | 'DTS' | 'FLAC' | 'MKA' | 'MP3' | 'Opus' | 'Vorbis' | 'WAV';

export interface FormatSettings {
  ac3Bitrate: string;
  /** Bitrates the user chose, per format; formats fall back to their default. */
  bitrates: Partial<Record<Codec, string>>;
  downmixToStereo: boolean;
  flacCompression: string;
  isKeepVideo: boolean;
  mp3EncodingType: string;
  mp3VbrSetting: string;
  opusEncodingType: string;
  qValue: string;
  vorbisEncodingType: string;
  wavBitDepth: string;
}

export const DEFAULT_SETTINGS: FormatSettings = {
  ac3Bitrate: '640',
  bitrates: {},
  downmixToStereo: false,
  flacCompression: '5',
  isKeepVideo: false,
  mp3EncodingType: 'cbr',
  mp3VbrSetting: '0',
  opusEncodingType: 'vbr',
  qValue: '6',
  vorbisEncodingType: 'abr',
  wavBitDepth: '16',
};

export type StringSetting = {
  [K in keyof FormatSettings]: FormatSettings[K] extends string ? K : never
}[keyof FormatSettings];

interface PanelProps {
  settings: FormatSettings;
  onChange: (key: StringSetting) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  /** Present exactly for formats with a bitrate range. */
  bitrate?: BitrateSliderProps;
}

interface Format {
  label: string;
  /** Output extension for an audio-only file. */
  extension: string;
  bitrate?: { initial: string; min: string; max: string; step: string };
  /**
   * Set when the format can be muxed alongside the input's copied video:
   * 'mp4' keeps an MP4 or MOV input's container (other inputs get MKV), 'mkv' always uses MKV.
   */
  keepVideo?: 'mp4' | 'mkv';
  /** Audio arguments; `bitrate` is the slider value for formats with a bitrate range. */
  args: (settings: FormatSettings, bitrate: string) => string[];
  Panel: (props: PanelProps) => React.ReactNode;
}

export const FORMATS: Record<Codec, Format> = {
  AAC: {
    label: 'AAC',
    extension: '.aac',
    bitrate: { initial: '192', min: '32', max: '256', step: '32' },
    keepVideo: 'mp4',
    args: (_, bitrate) => ['-c:a', 'aac', '-b:a', `${bitrate}k`],
    Panel: ({ bitrate }) => <BitrateSlider {...bitrate!} />,
  },
  AC3: {
    label: 'AC3 (Dolby Digital)',
    extension: '.ac3',
    keepVideo: 'mp4',
    args: ({ ac3Bitrate }) => ['-c:a', 'ac3', '-b:a', `${ac3Bitrate}k`],
    Panel: ({ settings, onChange }) =>
      <AC3 onAc3BitrateChange={onChange('ac3Bitrate')} ac3Bitrate={settings.ac3Bitrate} />,
  },
  ALAC: {
    label: 'ALAC (.m4a)',
    extension: '.m4a',
    keepVideo: 'mp4',
    args: () => ['-c:a', 'alac'],
    Panel: () => <NoSettingsApplicable />,
  },
  CAF: {
    label: 'CAF (.caf)',
    extension: '.caf',
    args: () => ['-c:a', 'alac'],
    Panel: () => <NoSettingsApplicable />,
  },
  DTS: {
    label: 'DTS (.dts)',
    extension: '.dts',
    bitrate: { initial: '768', min: '384', max: '1536', step: '128' },
    keepVideo: 'mkv',
    args: (_, bitrate) => ['-c:a', 'dca', '-b:a', `${bitrate}k`, '-strict', '-2'],
    Panel: ({ bitrate }) => <DTS bitrate={bitrate!} />,
  },
  FLAC: {
    label: 'FLAC (.flac)',
    extension: '.flac',
    keepVideo: 'mkv',
    // With the video, keep every stream (including subtitles); otherwise only the audio streams.
    args: ({ isKeepVideo, flacCompression }) => [
      ...(isKeepVideo ? ['-map', '0', '-c:s', 'copy'] : ['-map', '0:a']),
      '-c:a', 'flac', '-compression_level', flacCompression,
    ],
    Panel: ({ settings, onChange }) =>
      <FLAC onFlacCompressionChange={onChange('flacCompression')} flacCompression={settings.flacCompression} />,
  },
  MKA: {
    label: 'MKA (.mka)',
    extension: '.mka',
    args: () => ['-map', '0:a', '-c:a', 'copy'],
    Panel: () => <NoSettingsApplicable />,
  },
  MP3: {
    label: 'MP3 (.mp3)',
    extension: '.mp3',
    bitrate: { initial: '192', min: '64', max: '320', step: '64' },
    keepVideo: 'mp4',
    args: ({ mp3EncodingType, mp3VbrSetting }, bitrate) => ['-c:a', 'libmp3lame',
      ...(mp3EncodingType === 'cbr' ? ['-b:a', `${bitrate}k`]
        : mp3EncodingType === 'abr' ? ['-abr', '1', '-b:a', `${bitrate}k`]
        : ['-q:a', mp3VbrSetting]),
    ],
    Panel: ({ settings, onChange, bitrate }) => (
      <MP3EncodingTypeSelector
        onEncodingTypeChange={onChange('mp3EncodingType')}
        encodingType={settings.mp3EncodingType}
        onVbrSettingChange={onChange('mp3VbrSetting')}
        vbrSetting={settings.mp3VbrSetting}
        bitrate={bitrate!}
      />
    ),
  },
  Opus: {
    label: 'Opus (.opus)',
    extension: '.opus',
    bitrate: { initial: '192', min: '16', max: '512', step: '16' },
    args: ({ opusEncodingType }, bitrate) =>
      ['-c:a', 'libopus', ...(opusEncodingType === 'cbr' ? ['-vbr', 'off'] : []), '-b:a', `${bitrate}k`],
    Panel: ({ settings, onChange, bitrate }) => (
      <Opus onOpusEncodingTypeChange={onChange('opusEncodingType')} encodingType={settings.opusEncodingType} bitrate={bitrate!} />
    ),
  },
  Vorbis: {
    label: 'Vorbis (.ogg)',
    extension: '.ogg',
    bitrate: { initial: '192', min: '32', max: '480', step: '32' },
    args: ({ vorbisEncodingType, qValue }, bitrate) => ['-map', '0:a', '-c:a', 'libvorbis',
      ...(vorbisEncodingType === 'abr' ? ['-b:a', `${bitrate}k`] : ['-q:a', qValue])],
    Panel: ({ settings, onChange, bitrate }) => (
      <VorbisEncodingType
        onVorbisEncodingTypeChange={onChange('vorbisEncodingType')}
        vorbisEncodingType={settings.vorbisEncodingType}
        onQualitySliderMoved={onChange('qValue')}
        qValue={settings.qValue}
        bitrate={bitrate!}
      />
    ),
  },
  WAV: {
    label: 'WAV (.wav)',
    extension: '.wav',
    args: ({ wavBitDepth }) => ['-c:a', `pcm_s${wavBitDepth}le`],
    Panel: ({ settings, onChange }) =>
      <WavBitDepthSelector onBitDepthChange={onChange('wavBitDepth')} bitDepth={settings.wavBitDepth} />,
  },
};

/** The bitrate slider's value for a format: the user's choice, else the format's default. */
export const bitrateFor = (codec: Codec, settings: FormatSettings): string =>
  settings.bitrates[codec] ?? FORMATS[codec].bitrate?.initial ?? '';
