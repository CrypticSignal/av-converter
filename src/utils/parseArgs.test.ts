import { expect, it } from 'vitest';
import { formatCommand, parseArgs, quoteArg } from './parseArgs';

it.each([
  ['', []],
  ['   ', []],
  ['-c:v libx264 output.mp4', ['-c:v', 'libx264', 'output.mp4']],
  ['  -c:a   copy\t out.mka  ', ['-c:a', 'copy', 'out.mka']],
  ['-metadata title="My Song" out.mp3', ['-metadata', 'title=My Song', 'out.mp3']],
  ["-metadata 'artist=A \"B\" C' out.mp3", ['-metadata', 'artist=A "B" C', 'out.mp3']],
  ['"my output.mp4"', ['my output.mp4']],
  ['-metadata comment="" out.mp3', ['-metadata', 'comment=', 'out.mp3']],
  ['"" out.mp3', ['', 'out.mp3']],
  ['my\\ output.mp4', ['my output.mp4']],
  ['"say \\"hi\\" \\\\ \\n"', ['say "hi" \\ \\n']],
  ["'C:\\path'", ['C:\\path']],
  ['-vf "scale=1280:-2,fps=30" out.mp4', ['-vf', 'scale=1280:-2,fps=30', 'out.mp4']],
])('parses %j', (command, expected) => {
  expect(parseArgs(command)).toEqual(expected);
});

it.each(['-metadata title="My Song', "'unterminated"])('rejects unterminated quotes in %j', (command) => {
  expect(() => parseArgs(command)).toThrow(/Unterminated/);
});

it.each([
  ['out.mp3', 'out.mp3'],
  ['-c:a', '-c:a'],
  ['scale=1280:-2,fps=30', 'scale=1280:-2,fps=30'],
  ['my input.webm', "'my input.webm'"],
  ['', "''"],
  ["it's", "'it'\\''s'"],
  ['$HOME', "'$HOME'"],
  ['a"b', `'a"b'`],
])('quotes %j as %j', (arg, expected) => {
  expect(quoteArg(arg)).toBe(expected);
});

it('formats commands that parse back to the same arguments', () => {
  const args = ['-i', 'my input.webm', '-metadata', `title=It's "quoted"`, '', 'back\\slash', 'tab\there', 'out file.mp3'];
  expect(parseArgs(formatCommand(args))).toEqual(args);
});
