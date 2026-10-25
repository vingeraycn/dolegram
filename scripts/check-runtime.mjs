const [major, minor] = process.versions.node.split('.').map(Number);
if (!((major === 22 && minor >= 16) || major === 24)) {
  console.error('dotg requires Node.js 22.16+ within 22.x, or 24.x. Select a supported Node LTS for this checkout and rerun the command; no global runtime change is needed.');
  process.exitCode = 1;
}
