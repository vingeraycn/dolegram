import { resolve } from 'node:path';
import { runDoctor } from '../src/doctor.mjs';

const args = process.argv.slice(2);
const options = { configPath: resolve(process.env.DOTG_CONFIG ?? 'config.local.json'), healthFile: null };
let json = false;
try {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--json') json = true;
    else if (['--config', '--tunnel-health-file'].includes(arg) && args[index + 1] && !args[index + 1].startsWith('--')) {
      options[arg === '--config' ? 'configPath' : 'healthFile'] = resolve(args[++index]);
    } else throw new Error('usage');
  }
  const report = await runDoctor(options);
  console.log(json ? JSON.stringify(report, null, 2) : [
    `dotg doctor: ${report.level.toUpperCase()}`,
    ...report.checks.flatMap(check => [`[${check.level.toUpperCase()}] ${check.summary}`, ...(check.action ? [`  Next: ${check.action}`] : [])]),
    report.scope,
  ].join('\n'));
  process.exitCode = report.level === 'fail' ? 2 : report.level === 'warn' ? 1 : 0;
} catch {
  console.error('Usage: npm run doctor -- [--config PATH] [--tunnel-health-file PATH] [--json]');
  process.exitCode = 2;
}
