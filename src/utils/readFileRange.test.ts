import { describe, expect, it } from 'vitest';
import { parseRange } from './readFileRange';

describe('parseRange', () => {
  it('reads a range', () => {
    expect(parseRange('range:0:33554432')).toEqual({ offset: 0, length: 33554432 });
    expect(parseRange('range:67108864:16')).toEqual({ offset: 67108864, length: 16 });
  });

  it('leaves normal encodings alone', () => {
    expect(parseRange(undefined)).toBeUndefined();
    expect(parseRange('binary')).toBeUndefined();
    expect(parseRange('utf8')).toBeUndefined();
  });

  it('rejects malformed ranges', () => {
    expect(parseRange('range:')).toBeUndefined();
    expect(parseRange('range:-1:5')).toBeUndefined();
    expect(parseRange('range:1:2:3')).toBeUndefined();
    expect(parseRange('range:1.5:2')).toBeUndefined();
  });
});
