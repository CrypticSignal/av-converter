import { describe, expect, it } from 'vitest';
import { parseProbeOutput } from './probeFile';

const PROBE_JSON = JSON.stringify({
  streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, bit_rate: '4000000' },
    { index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 6, channel_layout: '5.1', bit_rate: '384000' },
    { index: 2, codec_type: 'audio', codec_name: 'opus', sample_rate: '48000', channels: 2 },
    { codec_type: 'subtitle' },
  ],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', format_long_name: 'QuickTime / MOV', duration: '125.5' },
});

describe('parseProbeOutput', () => {
  it('includes track language and title when present and ignores malformed tags', () => {
    const info = parseProbeOutput(JSON.stringify({ streams: [
      { codec_type: 'audio', tags: { language: 'fra', title: 'Commentary' } },
      { codec_type: 'audio', tags: { language: 123, title: '' } },
    ] }));
    expect(info.streams.map(stream => stream.details)).toEqual([['fra', 'Commentary'], []]);
  });
  it('summarises the format, duration and each stream', () => {
    expect(parseProbeOutput(PROBE_JSON)).toEqual({
      duration: 125.5,
      format: 'QuickTime / MOV',
      streams: [
        { index: 0, type: 'video', codec: 'h264', details: ['1920x1080', '4000 kbps'] },
        { index: 1, type: 'audio', codec: 'aac', details: ['48000 Hz', '5.1', '384 kbps'] },
        { index: 2, type: 'audio', codec: 'opus', details: ['48000 Hz', '2 channels'] },
        { index: 3, type: 'subtitle', codec: undefined, details: [] },
      ],
    });
  });
  it('tolerates missing sections and unknown durations', () => {
    expect(parseProbeOutput(JSON.stringify({ format: { duration: 'N/A', format_name: 'wav' } })))
      .toEqual({ duration: undefined, format: 'wav', streams: [] });
  });
});
