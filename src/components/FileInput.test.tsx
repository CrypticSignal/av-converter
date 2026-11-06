// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FileInput from './FileInput';

afterEach(cleanup);

it('passes a dropped file and ignores empty drops', () => {
  const onFile = vi.fn();
  const view = render(<FileInput onFile={onFile} filename="" />);
  const zone = view.getByTestId('file-drop-zone');
  fireEvent.drop(zone, { dataTransfer: { files: [] } });
  expect(onFile).not.toHaveBeenCalled();
  const file = new File(['audio'], 'dropped.flac');
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });
  expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
});

it('passes a picked file', () => {
  const onFile = vi.fn();
  const view = render(<FileInput onFile={onFile} filename="" />);
  const file = new File(['video'], 'clip.m4v');
  fireEvent.change(view.container.querySelector('input[type="file"]')!, { target: { files: [file] } });
  expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
});

it('ignores file drops while disabled', () => {
  const onFile = vi.fn();
  const view = render(<FileInput onFile={onFile} filename="current.wav" disabled />);
  const file = new File(['audio'], 'replacement.wav');
  expect(view.container.querySelector<HTMLInputElement>('input[type="file"]')!.disabled).toBe(true);
  fireEvent.drop(view.getByTestId('file-drop-zone'), { dataTransfer: { files: [file] } });
  expect(onFile).not.toHaveBeenCalled();
});
