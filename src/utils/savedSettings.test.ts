// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../formats';
import { loadSettings, saveSettings } from './savedSettings';

afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

describe('saved settings', () => {
  it('returns the defaults when nothing is saved', () => {
    expect(loadSettings()).toEqual({ codec: 'MP3', settings: DEFAULT_SETTINGS });
  });

  it('round-trips the codec and settings', () => {
    const settings = { ...DEFAULT_SETTINGS, flacCompression: '8', downmixToStereo: true, bitrates: { DTS: '1024' } };
    saveSettings({ codec: 'FLAC', settings });
    expect(loadSettings()).toEqual({ codec: 'FLAC', settings });
  });

  it('drops unknown codecs and values of the wrong type', () => {
    localStorage.setItem('av-converter:settings', JSON.stringify({
      codec: 'NotACodec',
      settings: { flacCompression: 7, downmixToStereo: 'yes', wavBitDepth: '24', extra: 1,
        bitrates: { AAC: '256', Nope: '1', MP3: 320 } },
    }));
    expect(loadSettings()).toEqual({
      codec: 'MP3',
      settings: { ...DEFAULT_SETTINGS, wavBitDepth: '24', bitrates: { AAC: '256' } },
    });
  });

  it('falls back to the defaults on bad JSON or unavailable storage', () => {
    localStorage.setItem('av-converter:settings', '{');
    expect(loadSettings().codec).toBe('MP3');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(loadSettings()).toEqual({ codec: 'MP3', settings: DEFAULT_SETTINGS });
    expect(() => saveSettings({ codec: 'AAC', settings: DEFAULT_SETTINGS })).not.toThrow();
  });
});
