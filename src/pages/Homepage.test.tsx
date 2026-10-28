// @vitest-environment jsdom
import React, { StrictMode } from 'react';
import { render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Homepage from './Homepage';

const instances = vi.hoisted(() => [] as { terminate: ReturnType<typeof vi.fn> }[]);
vi.mock('@ffmpeg/ffmpeg', () => ({
  FFmpeg: class {
    terminate = vi.fn();
    constructor() { instances.push(this); }
  },
}));
vi.mock('../redux/hooks', () => ({ useAppSelector: () => 192, useAppDispatch: () => vi.fn() }));

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
