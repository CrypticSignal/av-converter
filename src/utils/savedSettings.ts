import { DEFAULT_SETTINGS, FORMATS, type Codec, type FormatSettings } from '../formats';

const STORAGE_KEY = 'av-converter:settings';

export interface SavedSettings {
  codec: Codec;
  settings: FormatSettings;
}

const isCodec = (value: unknown): value is Codec =>
  typeof value === 'string' && Object.hasOwn(FORMATS, value);

/**
 * Keep each saved value only if it has the default's type, so a value saved by an
 * older version of the page, or edited by hand, can't break the form.
 */
const parseSettings = (value: unknown): FormatSettings => {
  const settings = { ...DEFAULT_SETTINGS, bitrates: {} } as FormatSettings;
  if (typeof value !== 'object' || value === null) return settings;
  const saved = value as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof FormatSettings)[]) {
    if (key === 'bitrates') continue;
    if (typeof saved[key] === typeof DEFAULT_SETTINGS[key]) {
      (settings as unknown as Record<string, unknown>)[key] = saved[key];
    }
  }
  if (typeof saved.bitrates === 'object' && saved.bitrates !== null) {
    for (const [codec, bitrate] of Object.entries(saved.bitrates)) {
      if (isCodec(codec) && typeof bitrate === 'string') settings.bitrates[codec] = bitrate;
    }
  }
  return settings;
};

/** The format and settings the visitor last used, or the defaults. */
export const loadSettings = (): SavedSettings => {
  const defaults: SavedSettings = { codec: 'MP3', settings: DEFAULT_SETTINGS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw);
    return {
      codec: isCodec(saved?.codec) ? saved.codec : defaults.codec,
      settings: parseSettings(saved?.settings),
    };
  } catch {
    // Storage can be unavailable (private windows, blocked site data) or hold bad JSON.
    return defaults;
  }
};

export const saveSettings = (saved: SavedSettings) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    // Remembering settings is a convenience; carry on without it.
  }
};
