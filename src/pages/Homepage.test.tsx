// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Homepage from './Homepage';
import { convertFile, loadFFmpeg } from '../utils/convertFile';

const instances = vi.hoisted(() => [] as { terminate: ReturnType<typeof vi.fn> }[]);
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    terminate = vi.fn();
    constructor() { instances.push(this); }
  },
}));
vi.mock('../redux/hooks', () => ({ useAppSelector: () => 192, useAppDispatch: () => vi.fn() }));
vi.mock('../utils/convertFile', () => ({ convertFile: vi.fn(), loadFFmpeg: vi.fn() }));
beforeEach(() => {
  instances.length = 0;
  vi.mocked(convertFile).mockReset().mockResolvedValue(undefined);
  vi.mocked(loadFFmpeg).mockReset().mockResolvedValue(undefined);
});
afterEach(cleanup);

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
  const old = vi.mocked(convertFile).mock.calls[0];
  expect(old[8]!()).toBe(true);
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  expect(instances[0].terminate).toHaveBeenCalledOnce();
  expect(old[8]!()).toBe(false);
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(instances).toHaveLength(2);
  const current = vi.mocked(convertFile).mock.calls[1];
  act(() => {
    old[9]!.status({ stage: 'Stale progress' });
    old[9]!.log('stale log');
    current[9]!.status({ stage: 'Converting', percent: 25 });
    current[9]!.log('x'.repeat(100_100));
  });
  await act(async () => endings[0]());
  expect(current[8]!()).toBe(true);
  expect(view.getByRole('status').textContent).toContain('25.0%');
  expect(view.getByRole('status').textContent).not.toContain('Stale');
  expect(view.getByLabelText('Operation logs').textContent).toHaveLength(100_000);
  expect(view.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  view.unmount();
  expect(instances[1].terminate).toHaveBeenCalledOnce();
  expect(current[8]!()).toBe(false);
  await act(async () => endings[1]());
});

it('passes the selected MP3 stereo downmix setting into conversion arguments', () => {
  const view = render(<Homepage />);
  const file = new File(['audio'], 'input.wav');
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  fireEvent.click(view.container.querySelector('input[name="downmix"][value="yes"]')!);
  fireEvent.click(view.getByRole('button', { name: /convert/i }));
  expect(convertFile).toHaveBeenCalledWith(
    expect.anything(), file,
    ['-i', 'input.wav', '-c:a', 'libmp3lame', '-b:a', '192k', '-ac', '2', 'input.mp3'],
    'input.wav', 'input.mp3',
    expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Object),
  );
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
  expect(convertFile).toHaveBeenCalledWith(
    expect.anything(), file, ['-i', 'input.wav', '-metadata', 'title=My Song', 'my output.mp3'],
    'input.wav', 'my output.mp3',
    expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Object),
  );
  view.unmount();
});

it.each([
  ['   ', 'Please enter the rest of the command.'],
  ['-metadata title="My Song out.mp3', 'Unterminated " quote in command.'],
])('rejects the manual command %j', (command, message) => {
  const { view } = startManual(command);
  expect(convertFile).not.toHaveBeenCalled();
  expect(view.getByRole('alert').textContent).toContain(message);
  view.unmount();
});

it('limits video encoder threads right after the input, outside Firefox only', () => {
  const userAgent = vi.spyOn(navigator, 'userAgent', 'get');
  userAgent.mockReturnValue('Mozilla/5.0 Chrome/130.0');
  let { view } = startManual('-c:v libx264 out.mp4 -y');
  expect(vi.mocked(convertFile).mock.calls[0][2]).toEqual(['-i', 'input.wav', '-threads', '4', '-c:v', 'libx264', 'out.mp4', '-y']);
  view.unmount();
  userAgent.mockReturnValue('Mozilla/5.0 Firefox/130.0');
  ({ view } = startManual('-vcodec libx264 out.mp4'));
  expect(vi.mocked(convertFile).mock.calls[1][2]).toEqual(['-i', 'input.wav', '-vcodec', 'libx264', 'out.mp4']);
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
    const args = vi.mocked(convertFile).mock.calls.at(-1)![2];
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
