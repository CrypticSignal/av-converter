// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FileInput from './FileInput';

afterEach(cleanup);

it('passes a dropped file and highlights the zone while dragging', () => {
  const onFile = vi.fn();
  const view = render(<FileInput onFile={onFile} filename="" />);
  const zone = view.getByTestId('file-drop-zone');
  const file = new File(['audio'], 'dropped.flac');

  fireEvent.dragEnter(zone, { dataTransfer: { files: [] } });
  expect(view.getByText('Drop to select this file')).toBeTruthy();
  fireEvent.dragOver(zone, { dataTransfer: { files: [], dropEffect: 'none' } });
  fireEvent.drop(zone, { dataTransfer: { files: [file] } });

  expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
  expect(view.getByText('or drag and drop a file here')).toBeTruthy();
});

it('ignores drops without files and clears the highlight when the drag leaves', () => {
  const onFile = vi.fn();
  const view = render(<FileInput onFile={onFile} filename="" />);
  const zone = view.getByTestId('file-drop-zone');
  fireEvent.dragEnter(zone, { dataTransfer: { files: [] } });
  fireEvent.dragLeave(zone, { relatedTarget: document.body });
  expect(view.getByText('or drag and drop a file here')).toBeTruthy();
  fireEvent.drop(zone, { dataTransfer: { files: [] } });
  expect(onFile).not.toHaveBeenCalled();
});

it('passes a picked file, resets the input, and accepts any audio or video type', () => {
  const onFile = vi.fn();
  const view = render(<FileInput onFile={onFile} filename="" />);
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  expect(input.accept.split(',')).toEqual(expect.arrayContaining(['audio/*', 'video/*', '.m4v', '.ts', '.mkv']));
  const file = new File(['video'], 'clip.m4v');
  fireEvent.change(input, { target: { files: [file] } });
  expect(onFile).toHaveBeenCalledExactlyOnceWith(file);
  expect(input.value).toBe('');
});
