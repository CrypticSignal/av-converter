import React from 'react';
import type { EncodingOptions } from './utils/createFFmpegArgs';
import BitrateSlider, { type BitrateSliderProps } from './components/BitrateSlider';
import AC3 from './components/AC3';
import DTS from './components/Dts';
import FLAC from './components/Flac';
import MP3EncodingTypeSelector from './components/MP3/EncodingTypeSelector';
import NoSettingsApplicable from './components/NoSettingsApplicable';
import Opus from './components/Opus';
import VorbisEncodingType from './components/Vorbis/EncodingType';
import WavBitDepthSelector from './components/WavBitDepthSelector';

export type Codec = EncodingOptions['codec'];

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
  bitrate?: { initial: string; min: string; max: string; step: string };
  /** Whether the format can be muxed alongside the input's video. */
  keepVideo: boolean;
  options: (settings: FormatSettings, bitrate: string) => EncodingOptions;
  Panel: (props: PanelProps) => React.ReactNode;
}

export const FORMATS: Record<Codec, Format> = {
  AAC: {
    label: 'AAC',
    bitrate: { initial: '192', min: '32', max: '256', step: '32' },
    keepVideo: true,
    options: ({ isKeepVideo, downmixToStereo }, bitrate) =>
      ({ codec: 'AAC', bitrateSliderValue: bitrate, isKeepVideo, downmixToStereo }),
    Panel: ({ bitrate }) => <BitrateSlider {...bitrate!} />,
  },
  AC3: {
    label: 'AC3 (Dolby Digital)',
    keepVideo: true,
    options: ({ ac3Bitrate, isKeepVideo, downmixToStereo }) =>
      ({ codec: 'AC3', ac3Bitrate, isKeepVideo, downmixToStereo }),
    Panel: ({ settings, onChange }) =>
      <AC3 onAc3BitrateChange={onChange('ac3Bitrate')} ac3Bitrate={settings.ac3Bitrate} />,
  },
  ALAC: {
    label: 'ALAC (.m4a)',
    keepVideo: true,
    options: ({ isKeepVideo, downmixToStereo }) => ({ codec: 'ALAC', isKeepVideo, downmixToStereo }),
    Panel: () => <NoSettingsApplicable />,
  },
  CAF: {
    label: 'CAF (.caf)',
    keepVideo: false,
    options: ({ downmixToStereo }) => ({ codec: 'CAF', downmixToStereo }),
    Panel: () => <NoSettingsApplicable />,
  },
  DTS: {
    label: 'DTS (.dts)',
    bitrate: { initial: '768', min: '384', max: '1536', step: '128' },
    keepVideo: true,
    options: ({ isKeepVideo, downmixToStereo }, bitrate) =>
      ({ codec: 'DTS', bitrateSliderValue: bitrate, isKeepVideo, downmixToStereo }),
    Panel: ({ bitrate }) => <DTS bitrate={bitrate!} />,
  },
  FLAC: {
    label: 'FLAC (.flac)',
    keepVideo: true,
    options: ({ flacCompression, isKeepVideo, downmixToStereo }) =>
      ({ codec: 'FLAC', flacCompression, isKeepVideo, downmixToStereo }),
    Panel: ({ settings, onChange }) =>
      <FLAC onFlacCompressionChange={onChange('flacCompression')} flacCompression={settings.flacCompression} />,
  },
  MKA: {
    label: 'MKA (.mka)',
    keepVideo: false,
    options: ({ downmixToStereo }) => ({ codec: 'MKA', downmixToStereo }),
    Panel: () => <NoSettingsApplicable />,
  },
  MP3: {
    label: 'MP3 (.mp3)',
    bitrate: { initial: '192', min: '64', max: '320', step: '64' },
    keepVideo: true,
    options: ({ isKeepVideo, mp3EncodingType, mp3VbrSetting, downmixToStereo }, bitrate) =>
      ({ codec: 'MP3', bitrateSliderValue: bitrate, isKeepVideo, mp3EncodingType, mp3VbrSetting, downmixToStereo }),
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
    bitrate: { initial: '192', min: '16', max: '512', step: '16' },
    keepVideo: false,
    options: ({ opusEncodingType, downmixToStereo }, bitrate) =>
      ({ codec: 'Opus', bitrateSliderValue: bitrate, opusEncodingType, downmixToStereo }),
    Panel: ({ settings, onChange, bitrate }) => (
      <Opus onOpusEncodingTypeChange={onChange('opusEncodingType')} encodingType={settings.opusEncodingType} bitrate={bitrate!} />
    ),
  },
  Vorbis: {
    label: 'Vorbis (.ogg)',
    bitrate: { initial: '192', min: '32', max: '480', step: '32' },
    keepVideo: false,
    options: ({ qValue, vorbisEncodingType, downmixToStereo }, bitrate) =>
      ({ codec: 'Vorbis', bitrateSliderValue: bitrate, qValue, vorbisEncodingType, downmixToStereo }),
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
    keepVideo: false,
    options: ({ wavBitDepth, downmixToStereo }) => ({ codec: 'WAV', wavBitDepth, downmixToStereo }),
    Panel: ({ settings, onChange }) =>
      <WavBitDepthSelector onBitDepthChange={onChange('wavBitDepth')} bitDepth={settings.wavBitDepth} />,
  },
};
