import { describe, expect, it } from 'vitest';
import { isVideoFile } from './isVideoFile';

describe('isVideoFile', () => {
  it('uses the MIME type when there is one', () => {
    expect(isVideoFile({ name: 'clip.mp4', type: 'video/mp4' })).toBe(true);
    expect(isVideoFile({ name: 'song.mp3', type: 'audio/mpeg' })).toBe(false);
    expect(isVideoFile({ name: 'song.m4a', type: 'audio/mp4' })).toBe(false);
  });

  it('falls back to the extension without a MIME type', () => {
    expect(isVideoFile({ name: 'movie.MKV', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'track.flac', type: '' })).toBe(false);
    expect(isVideoFile({ name: 'noextension', type: '' })).toBe(false);
  });
});
