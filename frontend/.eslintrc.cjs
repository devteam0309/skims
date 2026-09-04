/*
 * Added after `<PageBtn>` — a component that was never defined or imported — shipped to the panel
 * and crashed the programs page for super_admin and provincial_admin.
 *
 * Nothing in the pipeline could have caught it. `vite build` compiles an undefined identifier
 * happily, because it is a runtime ReferenceError rather than a build error, and the Vitest suite
 * never renders that branch. `npm run lint` was already declared in package.json but had no config
 * file to run against, so it failed rather than ran.
 *
 * The rule that matters here is `react/jsx-no-undef`. The rest is kept deliberately narrow: this
 * is a correctness gate on an existing codebase, not a restyling. Stylistic rules stay off so the
 * gate can be enforced at `--max-warnings 0` without a formatting sweep first.
 */
module.exports = {
  root: true,
  env: { browser: true, es2022: true, node: true },
  extends: ['eslint:recommended', 'plugin:react/recommended', 'plugin:react-hooks/recommended'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
  settings: { react: { version: 'detect' } },
  plugins: ['react-refresh'],
  ignorePatterns: ['dist', 'coverage', 'node_modules', '*.cjs'],
  overrides: [
    {
      files: ['src/tests/**/*.{js,jsx}', '**/*.test.{js,jsx}'],
      globals: { describe: 'readonly', it: 'readonly', expect: 'readonly', vi: 'readonly', beforeEach: 'readonly', afterEach: 'readonly', beforeAll: 'readonly', afterAll: 'readonly' },
    },
  ],
  rules: {
    // The two that would have caught the crash.
    'react/jsx-no-undef': 'error',
    'no-undef': 'error',

    // JSX runtime is automatic under @vitejs/plugin-react, so neither of these applies.
    'react/react-in-jsx-scope': 'off',
    'react/jsx-uses-react': 'off',

    // Prop types are not used in this codebase; Zod schemas carry the contracts instead.
    'react/prop-types': 'off',

    // Deliberate no-op catches exist for fire-and-forget email and Cloudinary cleanup.
    'no-empty': ['error', { allowEmptyCatch: true }],

    'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  },
};
