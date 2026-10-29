/**
 * Split a command line into arguments like a POSIX shell: whitespace separates
 * arguments, quotes group them, and a backslash escapes the next character
 * (inside double quotes, only `"` and `\`). Throws on an unterminated quote.
 */
export const parseArgs = (command: string): string[] => {
  const args: string[] = [];
  let current = '';
  // Distinguishes an empty quoted argument ("") from no argument at all.
  let inArg = false;
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote === "'") {
      if (char === "'") quote = null;
      else current += char;
    } else if (quote === '"') {
      if (char === '"') quote = null;
      else if (char === '\\' && (command[i + 1] === '"' || command[i + 1] === '\\')) current += command[++i];
      else current += char;
    } else if (char === '"' || char === "'") {
      quote = char;
      inArg = true;
    } else if (char === '\\' && i + 1 < command.length) {
      current += command[++i];
      inArg = true;
    } else if (/\s/.test(char)) {
      if (inArg) args.push(current);
      current = '';
      inArg = false;
    } else {
      current += char;
      inArg = true;
    }
  }

  if (quote) throw new Error(`Unterminated ${quote} quote in command.`);
  if (inArg) args.push(current);
  return args;
};
