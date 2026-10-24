export default [{
  files: ['src/**/*.mjs', 'test/**/*.mjs'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }], 'no-constant-condition': 'error' },
}];
