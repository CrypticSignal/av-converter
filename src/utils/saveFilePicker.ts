/**
 * The browser's "Save as" dialog (the File System Access API), which lets the converter write a
 * converted file straight to disk, a chunk at a time, instead of holding it whole in memory to
 * download it. Desktop Chrome, Edge and Opera have it; other browsers download the file instead.
 */

type SaveFilePicker = (options: {
  suggestedName?: string;
  /** Remembers the folder last chosen with this id. */
  id?: string;
  startIn?: 'downloads';
}) => Promise<FileSystemFileHandle>;

const picker = () => (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;

/** Whether converted files are saved with the dialog (rather than downloaded). */
export const canPickSaveFile = () => typeof picker() === 'function';

/**
 * Ask where to save a file. Browsers only show the dialog straight after a click, so call this
 * from the click handler before any long wait.
 *
 * Returns the chosen file, 'cancelled' if the visitor closed the dialog, or undefined if the
 * browser has no dialog or refused to show it, in which case the file should be downloaded.
 */
export const pickSaveFile = async (suggestedName: string): Promise<FileSystemFileHandle | 'cancelled' | undefined> => {
  const show = picker();
  if (!show) return undefined;
  try {
    return await show.call(window, { suggestedName, id: 'converted-file', startIn: 'downloads' });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    // E.g. inside a cross-origin frame, or a name the browser won't save under.
    console.warn('The save dialog could not be shown, so the file will be downloaded.', error);
    return undefined;
  }
};
