// Lint rules for the web app (yarn lint). TypeScript already checks types, so these catch
// mistakes it can't, above all React hooks used in ways that misbehave at runtime.
import { registerHooks } from 'node:module';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// typescript-eslint needs TypeScript's JavaScript API, which TypeScript 7 (used by `tsc` here)
// doesn't have. Microsoft publishes TypeScript 6 as @typescript/typescript6 to run alongside
// it, so while ESLint runs, `typescript` means that package. Remove this once typescript-eslint
// supports TypeScript 7: https://github.com/typescript-eslint/typescript-eslint/issues/10940
registerHooks({
  resolve: (specifier, context, nextResolve) =>
    nextResolve(specifier === 'typescript' ? '@typescript/typescript6' : specifier, context),
});
// Imported only now, so the hook above is in place when it loads TypeScript.
const { default: tseslint } = await import('typescript-eslint');

export default tseslint.config(
  { ignores: ['build/', 'vendor/', 'public/', 'logging/', 'node_modules/'] },
  {
    files: ['**/*.{ts,tsx,js,mjs}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
);
