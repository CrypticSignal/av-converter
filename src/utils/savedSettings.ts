import { DEFAULT_SETTINGS, FORMATS, type Codec, type FormatSettings } from '../formats';

const STORAGE_KEY = 'av-converter:settings';

export interface SavedSettings {
  codec: Codec;
  settings: FormatSettings;
}

/** The format and settings the visitor last used, or the defaults. */
export const loadSettings = (): SavedSettings => {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    return {
      codec: Object.hasOwn(FORMATS, saved.codec) ? saved.codec : 'MP3',
      settings: { ...DEFAULT_SETTINGS, ...saved.settings },
    };
  } catch {
    // Storage can be unavailable (private windows, blocked site data) or hold bad JSON.
    return { codec: 'MP3', settings: DEFAULT_SETTINGS };
  }
};

export const saveSettings = (saved: SavedSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Remembering settings is a convenience; carry on without it.
  }
};
