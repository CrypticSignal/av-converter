/**
 * Detects a conversion that was cut off because the browser tab crashed.
 *
 * When the browser runs out of memory, it kills the tab's process: the page gets no error
 * it could catch and simply disappears. So a mark is stored in sessionStorage (kept by the
 * browser per tab, so it survives the crash) while a conversion runs. On a normal reload or
 * navigation, `pagehide` clears it; a crash doesn't fire `pagehide`, so the mark is still
 * there when the tab is reloaded.
 */
const KEY = 'av-converter:unfinished-conversion';

/** Call when a conversion starts, with the input file's name. */
export const markConversionStarted = (filename: string) => {
  try {
    sessionStorage.setItem(KEY, filename);
  } catch {
    // Storage can be unavailable (e.g. blocked site data); the message after a crash is a nicety.
  }
};

/** Call when a conversion ends, however it ended, and when the page is left normally. */
export const markConversionEnded = () => {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // See above.
  }
};

/** The input filename of a conversion the tab crashed during, if any. Clears the mark. */
export const takeUnfinishedConversion = (): string | null => {
  try {
    const filename = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return filename;
  } catch {
    return null;
  }
};
