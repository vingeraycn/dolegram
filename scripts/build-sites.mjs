import { build } from 'esbuild';
import { copyFile } from 'node:fs/promises';

const result = await build({
  entryPoints: ['src/sites/worker.mjs'],
  outfile: 'dist/sites/server/index.js',
  bundle: true,
  platform: 'neutral',
  mainFields: ['module', 'main'],
  format: 'esm',
  external: ['node:crypto'],
  metafile: true,
  legalComments: 'inline',
});
for (const output of Object.values(result.metafile.outputs)) {
  if (output.imports.some(item => item.external && item.path !== 'node:crypto')) {
    throw new Error('Unexpected runtime dependency in Sites Worker bundle');
  }
}
await copyFile('THIRD_PARTY_NOTICES.md', 'dist/sites/server/THIRD_PARTY_NOTICES.md');
await copyFile('LICENSE', 'dist/sites/server/LICENSE');
console.log('Built Sites Worker source bundle. Production callback delivery remains disabled pending a verified transport contract. No Site was created or deployed.');
