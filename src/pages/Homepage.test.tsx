// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Homepage, { MAX_FILE_BYTES } from './Homepage';
import { canUseThreads, convertFile, loadFFmpeg } from '../utils/convertFile';
import { probeFile, type MediaInfo } from '../utils/probeFile';

const instances = vi.hoisted(() => [] as { terminate: ReturnType<typeof vi.fn> }[]);
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    terminate = vi.fn();
    constructor() { instances.push(this); }
  },
}));
vi.mock('../utils/convertFile', () => ({ convertFile: vi.fn(), loadFFmpeg: vi.fn(), canUseThreads: vi.fn() }));
vi.mock('../utils/probeFile', () => ({ probeFile: vi.fn() }));
beforeEach(() => {
  localStorage.clear();
  instances.length = 0;
  vi.mocked(convertFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(loadFFmpeg).mockReset().mockResolvedValue(undefined);
  vi.mocked(canUseThreads).mockReset().mockReturnValue(true);
  vi.mocked(probeFile).mockReset().mockReturnValue(new Promise(() => {}));
});
afterEach(cleanup);
/** The job passed to the nth convertFile call (the latest by default). */
const job = (call = -1) => vi.mocked(convertFile).mock.calls.at(call)![1];

it('terminates each effect-owned worker on StrictMode cleanup and unmount, not rerender', () => {
  const view = render(<StrictMode><Homepage /></StrictMode>);
  expect(instances).toHaveLength(2);
  expect(instances[0].terminate).toHaveBeenCalledOnce();
  expect(instances[1].terminate).not.toHaveBeenCalled();
  view.rerender(<StrictMode><Homepage /></StrictMode>);
  expect(instances).toHaveLength(2);
  view.unmount();
  expect(instances[1].terminate).toHaveBeenCalledOnce();
});

it('cancels, replaces the worker on restart, and ignores old callbacks/finalizers', async () => {
  const endings: (() => void)[] = [];
  vi.mocked(convertFile).mockImplementation(() => new Promise<void>(resolve => endings.push(resolve)));
  const view = render(<Homepage />);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(['audio'], 'input.wav')] },
  });
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  const old = job(0);
  expect(old.isActive()).toBe(true);
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  expect(instances[0].terminate).toHaveBeenCalledOnce();
  expect(old.isActive()).toBe(false);
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(instances).toHaveLength(2);
  const current = job(1);
  act(() => {
    current.onStatus({ stage: 'Converting', percent: 25 });
    current.onLog('x'.repeat(100_100));
  });
  await act(async () => endings[0]());
  expect(current.isActive()).toBe(true);
  expect(view.getByRole('status').textContent).toContain('25.0%');
  expect(view.getByLabelText('Operation logs').textContent).toHaveLength(100_000);
  expect(view.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  view.unmount();
  expect(instances[1].terminate).toHaveBeenCalledOnce();
  expect(current.isActive()).toBe(false);
  await act(async () => endings[1]());
});

it('passes the selected MP3 stereo downmix setting into conversion arguments', () => {
  const view = render(<Homepage />);
  const file = new File(['audio'], 'input.wav');
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  fireEvent.click(view.container.querySelector('input[name="downmix"][value="yes"]')!);
  fireEvent.click(view.getByRole('button', { name: /convert/i }));
  expect(job()).toMatchObject({
    file,
    ffmpegArgs: ['-i', 'input.wav', '-c:a', 'libmp3lame', '-b:a', '192k', '-ac', '2', 'input.mp3'],
    outputFilename: 'input.mp3',
    knownTimeline: true,
  });
  view.unmount();
});

const startManual = (command: string) => {
  const view = render(<Homepage />);
  const file = new File(['audio'], 'input.wav');
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  fireEvent.click(view.getByLabelText('Manual FFmpeg Command'));
  fireEvent.change(view.getByPlaceholderText('-c:v libx264 output.mp4'), { target: { value: command } });
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  return { view, file };
};

it('passes quoted manual-mode arguments through intact', () => {
  const { view, file } = startManual('-metadata  title="My Song" "my output.mp3"');
  expect(job()).toMatchObject({
    file,
    ffmpegArgs: ['-i', 'input.wav', '-metadata', 'title=My Song', 'my output.mp3'],
    outputFilename: 'my output.mp3',
    knownTimeline: false,
  });
  view.unmount();
});

it.each([
  ['   ', 'Please enter the rest of the command.'],
  ['-metadata title="My Song out.mp3', 'Unterminated " quote in command.'],
  ['-c:v libx264 out.mp4 -y', 'must end with the output filename (e.g. output.mp4), not the option -y'],
  ['-c:a libmp3lame music/out.mp3', "can't include a folder"],
  ["-c:a libmp3lame '..\\out.mp3'", "can't include a folder"],
  ['-c:a libmp3lame "out?.mp3"', "characters that aren't allowed"],
  ['-c:a libmp3lame out', 'needs an extension'],
])('rejects the manual command %j', (command, message) => {
  const { view } = startManual(command);
  expect(convertFile).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toContain(message);
  view.unmount();
});

it('accepts an output without an extension when the command names its format', () => {
  const { view } = startManual('-f mp3 out');
  expect(job()).toMatchObject({ outputFilename: 'out' });
  view.unmount();
});

it('limits video encoder threads right after the input, outside Firefox only', () => {
  const userAgent = vi.spyOn(navigator, 'userAgent', 'get');
  userAgent.mockReturnValue('Mozilla/5.0 Chrome/130.0');
  let { view } = startManual('-c:v libx264 -y out.mp4');
  expect(job(0).ffmpegArgs).toEqual(['-i', 'input.wav', '-threads', '4', '-c:v', 'libx264', '-y', 'out.mp4']);
  view.unmount();
  userAgent.mockReturnValue('Mozilla/5.0 Firefox/130.0');
  ({ view } = startManual('-vcodec libx264 out.mp4'));
  expect(job(1).ffmpegArgs).toEqual(['-i', 'input.wav', '-vcodec', 'libx264', 'out.mp4']);
  view.unmount();
  // The single-threaded core, used when the page is not cross-origin isolated.
  userAgent.mockReturnValue('Mozilla/5.0 Chrome/130.0');
  vi.mocked(canUseThreads).mockReturnValue(false);
  ({ view } = startManual('-c:v libx264 out.mp4'));
  expect(job(2).ffmpegArgs).toEqual(['-i', 'input.wav', '-c:v', 'libx264', 'out.mp4']);
  view.unmount();
  userAgent.mockRestore();
});

it('uses each format\'s own default bitrate and remembers changes per format', () => {
  const view = render(<Homepage />);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['audio'], 'input.wav')] } });
  const select = view.container.querySelector('#codecs')!;
  const slider = () => view.container.querySelector<HTMLInputElement>('#bitrate_slider')!;
  const convert = () => {
    fireEvent.click(view.getByRole('button', { name: /^convert/i }));
    const args = job().ffmpegArgs;
    return args[args.indexOf('-b:a') + 1];
  };
  fireEvent.change(select, { target: { value: 'DTS' } });
  expect(slider().value).toBe('768');
  fireEvent.change(slider(), { target: { value: '1024' } });
  fireEvent.change(select, { target: { value: 'AAC' } });
  expect(slider().value).toBe('192');
  expect(convert()).toBe('192k');
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  fireEvent.change(select, { target: { value: 'DTS' } });
  expect(slider().value).toBe('1024');
  expect(convert()).toBe('1024k');
  view.unmount();
});

it('starts loading FFmpeg when a file is selected and ignores preload failures', async () => {
  vi.mocked(loadFFmpeg).mockRejectedValue(new Error('offline'));
  const view = render(<Homepage />);
  expect(loadFFmpeg).not.toHaveBeenCalled();
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['audio'], 'input.wav')] } });
  expect(loadFFmpeg).toHaveBeenCalledWith(instances[0], expect.any(Function));
  const isActive = vi.mocked(loadFFmpeg).mock.calls[0][1]!;
  expect(isActive()).toBe(true);
  await act(async () => {});
  view.unmount();
  expect(isActive()).toBe(false);
});

const selectFile = (view: ReturnType<typeof render>, name: string) => {
  const file = new File(['media'], name);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  return file;
};

it('offers keeping the video for AAC', () => {
  const view = render(<Homepage />);
  selectFile(view, 'clip.mp4');
  fireEvent.change(view.container.querySelector('#codecs')!, { target: { value: 'AAC' } });
  fireEvent.click(view.getByLabelText('Keep the video (if applicable)'));
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(job().ffmpegArgs).toEqual(['-i', 'clip.mp4', '-c:V', 'copy', '-c:a', 'aac', '-b:a', '192k', 'clip.mp4']);
  view.unmount();
});

it('prefills an editable output name and requires one', () => {
  const view = render(<Homepage />);
  selectFile(view, 'no-extension');
  const outputName = view.container.querySelector<HTMLInputElement>('#output_name')!;
  expect(outputName.value).toBe('no-extension');
  fireEvent.change(outputName, { target: { value: '  renamed  ' } });
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(job().outputFilename).toBe('renamed.mp3');
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  fireEvent.change(outputName, { target: { value: ' ' } });
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(convertFile).toHaveBeenCalledTimes(1);
  expect(view.getByRole('alert').textContent).toContain('Please enter an output filename.');
  view.unmount();
});

it('hides the stereo downmix option for formats that copy the audio unchanged', () => {
  const view = render(<Homepage />);
  expect(view.container.querySelector('input[name="downmix"]')).not.toBeNull();
  fireEvent.change(view.container.querySelector('#codecs')!, { target: { value: 'MKA' } });
  expect(view.container.querySelector('input[name="downmix"]')).toBeNull();
  expect(view.queryByText('Downmix to stereo?')).toBeNull();
  fireEvent.change(view.container.querySelector('#codecs')!, { target: { value: 'FLAC' } });
  expect(view.container.querySelector('input[name="downmix"]')).not.toBeNull();
  view.unmount();
});

it('rejects files over the size limit when they are selected', () => {
  const view = render(<Homepage />);
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  const big = new File(['video'], 'big.mkv');
  Object.defineProperty(big, 'size', { value: MAX_FILE_BYTES + 1 });
  fireEvent.change(input, { target: { files: [big] } });
  expect(view.getByRole('alert').textContent).toBe('big.mkv is 2.0 GiB. The maximum file size is 2.0 GiB.');
  expect(view.getByText('Select file')).toBeTruthy();
  expect(loadFFmpeg).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(convertFile).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toBe('You must select an input file.');

  const small = new File(['audio'], 'small.wav');
  Object.defineProperty(small, 'size', { value: MAX_FILE_BYTES });
  fireEvent.change(input, { target: { files: [small] } });
  expect(view.queryByRole('alert')).toBeNull();
  expect(view.getByText('small.wav')).toBeTruthy();
  view.unmount();
});

it('shows the running command with arguments quoted for a shell', () => {
  vi.mocked(convertFile).mockImplementation(() => new Promise<void>(() => {}));
  const view = render(<Homepage />);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(['audio'], 'my song.wav')] },
  });
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(view.getByText(/^Running:/).textContent)
    .toBe("Running: ffmpeg -i 'my song.wav' -c:a libmp3lame -b:a 192k 'my song.mp3'...");
  view.unmount();
});

it('converts a dropped file', () => {
  const view = render(<Homepage />);
  const file = new File(['audio'], 'dropped.flac');
  fireEvent.drop(view.getByTestId('file-drop-zone'), { dataTransfer: { files: [file] } });
  expect(view.getByText('dropped.flac')).toBeTruthy();
  expect(view.container.querySelector<HTMLInputElement>('#output_name')!.value).toBe('dropped');
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(job()).toMatchObject({ file, outputFilename: 'dropped.mp3' });
  view.unmount();
});

it('remembers the chosen format and settings for the next visit', () => {
  let view = render(<Homepage />);
  fireEvent.change(view.container.querySelector('#codecs')!, { target: { value: 'FLAC' } });
  fireEvent.click(view.container.querySelector('input[name="downmix"][value="yes"]')!);
  view.unmount();
  view = render(<Homepage />);
  expect(view.container.querySelector<HTMLSelectElement>('#codecs')!.value).toBe('FLAC');
  expect(view.container.querySelector<HTMLInputElement>('input[name="downmix"][value="yes"]')!.checked).toBe(true);
  view.unmount();
});

it('offers the converted file again and revokes its URL when replaced or unmounted', async () => {
  const revoke = vi.fn();
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
  const view = render(<Homepage />);
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [new File(['a'], 'in.wav')] } });
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  await act(async () => job().onOutput!({ url: 'blob:first', filename: 'in.mp3', size: 2048 }));
  const link = view.getByRole('link', { name: 'download in.mp3' });
  expect(link.getAttribute('href')).toBe('blob:first');
  expect(link.getAttribute('download')).toBe('in.mp3');
  expect(view.getByText(/2\.0 KiB/)).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(revoke).toHaveBeenCalledWith('blob:first');
  expect(view.queryByRole('link', { name: /download in\.mp3/ })).toBeNull();
  await act(async () => job().onOutput!({ url: 'blob:second', filename: 'in.mp3', size: 1 }));
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:second');
});

it('shows the selected file\'s duration and streams, ignoring results for an older file', async () => {
  let finishFirst!: (info: MediaInfo) => void;
  vi.mocked(probeFile)
    .mockReturnValueOnce(new Promise<MediaInfo>(resolve => { finishFirst = resolve; }))
    .mockResolvedValueOnce({
      duration: 65, format: 'WAV / WAVE (Waveform Audio)',
      streams: [{ index: 0, type: 'audio', codec: 'pcm_s16le', details: ['44100 Hz', 'stereo'] }],
    })
    .mockRejectedValueOnce(new Error('unreadable'));
  const view = render(<Homepage />);
  const input = view.container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files: [new File(['a'], 'first.wav')] } });
  expect(view.getByText('Reading file information…')).toBeTruthy();
  await act(async () => { fireEvent.change(input, { target: { files: [new File(['b'], 'second.wav')] } }); });
  const info = view.getByLabelText('File information');
  expect(info.textContent).toContain('Duration: 1m 05s · Format: WAV / WAVE (Waveform Audio)');
  expect(info.textContent).toContain('Stream 0: Audio (pcm_s16le) — 44100 Hz, stereo');
  await act(async () => finishFirst({ duration: 1, streams: [] }));
  expect(view.getByLabelText('File information').textContent).toContain('1m 05s');
  await act(async () => { fireEvent.change(input, { target: { files: [new File(['c'], 'third.bin')] } }); });
  expect(view.getByText("Couldn't read this file's information.")).toBeTruthy();
  view.unmount();
});

it('selects an audio stream, explains format defaults, and resets selection for a new input', async () => {
  vi.mocked(probeFile).mockResolvedValue({ streams: [
    { index: 0, type: 'video', codec: 'h264', details: [] },
    { index: 1, type: 'audio', codec: 'aac', details: ['English'] },
    { index: 3, type: 'audio', codec: 'aac', details: ['French'] },
  ] });
  const view = render(<Homepage />);
  await act(async () => { selectFile(view, 'first.mkv'); });
  const track = view.getByLabelText('Audio track') as HTMLSelectElement;
  expect(Array.from(track.options, option => option.value)).toEqual(['', '1', '3']);
  expect(view.getByText(/FFmpeg automatically selects one audio track/)).toBeTruthy();
  fireEvent.change(view.container.querySelector('#codecs')!, { target: { value: 'MKA' } });
  expect(view.getByText(/This format maps all audio tracks by default/)).toBeTruthy();
  fireEvent.change(track, { target: { value: '3' } });
  expect(view.getByText('Only the selected audio track will be included.')).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(job().ffmpegArgs).toEqual(['-i', 'first.mkv', '-map', '0:3', '-c:a', 'copy', 'first.mka']);
  await act(async () => {});
  await act(async () => { selectFile(view, 'second.mkv'); });
  expect((view.getByLabelText('Audio track') as HTMLSelectElement).value).toBe('');
  view.unmount();
});

it('leaves stream mapping to the user in manual command mode', async () => {
  vi.mocked(probeFile).mockResolvedValue({ streams: [{ index: 2, type: 'audio', details: [] }] });
  const view = render(<Homepage />);
  await act(async () => { selectFile(view, 'input.mkv'); });
  fireEvent.change(view.getByLabelText('Audio track'), { target: { value: '2' } });
  fireEvent.click(view.getByLabelText('Manual FFmpeg Command'));
  expect(view.queryByLabelText('Audio track')).toBeNull();
  fireEvent.change(view.getByPlaceholderText('-c:v libx264 output.mp4'), { target: { value: '-map 0:1 -c:a copy out.mka' } });
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(job().ffmpegArgs).toEqual(['-i', 'input.mkv', '-map', '0:1', '-c:a', 'copy', 'out.mka']);
  view.unmount();
});

it.each(['cancel', 'complete'])('locks settings and file drops while converting and unlocks on %s', async ending => {
  let finish!: () => void;
  vi.mocked(convertFile).mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<Homepage />);
  selectFile(view, 'original.wav');
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  const settings = view.getByRole('group', { name: 'Conversion settings' }) as HTMLFieldSetElement;
  expect(settings.disabled).toBe(true);
  const controls = settings.querySelectorAll('input, select, textarea, button');
  expect(controls.length).toBeGreaterThan(4);
  for (const control of controls) expect(control.matches(':disabled')).toBe(true);
  expect(view.getByRole('button', { name: 'Cancel' }).matches(':disabled')).toBe(false);
  fireEvent.drop(view.getByTestId('file-drop-zone'), { dataTransfer: { files: [new File(['new'], 'replacement.wav')] } });
  expect(job().file.name).toBe('original.wav');
  expect(view.queryByText('replacement.wav')).toBeNull();
  if (ending === 'cancel') fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  await act(async () => finish());
  expect(settings.disabled).toBe(false);
  fireEvent.change(view.getByLabelText('Output filename'), { target: { value: 'renamed' } });
  expect((view.getByLabelText('Output filename') as HTMLInputElement).value).toBe('renamed');
  selectFile(view, 'next.wav');
  expect(view.getByText('next.wav')).toBeTruthy();
  view.unmount();
});
