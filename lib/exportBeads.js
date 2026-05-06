import { execSync } from 'child_process';

export function exportBeads(cwd = process.cwd()) {
  try {
    const result = execSync('bd export --no-memories', { cwd, encoding: 'utf8' });
    const issues = result.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    return JSON.stringify(issues);
  } catch (e) {
    console.error('[beadflow] export failed:', e.message);
    return '[]';
  }
}
