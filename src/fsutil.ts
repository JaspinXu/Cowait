import fs from 'node:fs';
import path from 'node:path';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Write JSON via temp file + rename so readers never see a half-written file. */
export function writeJsonAtomic(file: string, data: unknown, pretty = false): void {
  ensureDir(path.dirname(file));
  const body = pretty ? JSON.stringify(data, null, 2) + '\n' : JSON.stringify(data);
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, body);
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows can refuse the rename if another process holds the file open.
    fs.writeFileSync(file, body);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

export function appendLine(file: string, line: string): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, line + '\n');
}
