// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Homepage from './Homepage';
import { convertFile } from '../utils/convertFile';

const instances = vi.hoisted(() => [] as { terminate: ReturnType<typeof vi.fn> }[]);
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    terminate = vi.fn();
    constructor() { instances.push(this); }
  },
}));
vi.mock('../redux/hooks', () => ({ useAppSelector: () => 192, useAppDispatch: () => vi.fn() }));
vi.mock('../utils/convertFile', () => ({ convertFile: vi.fn() }));
beforeEach(() => {
  instances.length = 0;
  vi.mocked(convertFile).mockReset().mockResolvedValue(undefined);
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
  expect(old[9]!()).toBe(true);
  fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
  expect(instances[0].terminate).toHaveBeenCalledOnce();
  expect(old[9]!()).toBe(false);
  fireEvent.click(view.getByRole('button', { name: /^convert/i }));
  expect(instances).toHaveLength(2);
  const current = vi.mocked(convertFile).mock.calls[1];
  act(() => {
    old[10]!.status({ stage: 'Stale progress' });
    old[10]!.log('stale log');
    current[10]!.status({ stage: 'Converting', percent: 25 });
    current[10]!.log('x'.repeat(100_100));
  });
  await act(async () => endings[0]());
  expect(current[9]!()).toBe(true);
  expect(view.getByRole('status').textContent).toContain('25.0%');
  expect(view.getByRole('status').textContent).not.toContain('Stale');
  expect(view.getByLabelText('Operation logs').textContent).toHaveLength(100_000);
  expect(view.getByRole('button', { name: 'Cancel' })).toBeTruthy();
  view.unmount();
  expect(instances[1].terminate).toHaveBeenCalledOnce();
  expect(current[9]!()).toBe(false);
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
    expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Object),
  );
  view.unmount();
});
