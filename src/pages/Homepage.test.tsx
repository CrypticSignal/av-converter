// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { fireEvent, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
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
    expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function), expect.any(Function),
  );
  view.unmount();
});
