/** Render an Ink tree into a fake terminal of a given size (ink-testing-library is fixed at 100 columns). */
import { EventEmitter } from 'node:events';
import { render } from 'ink';
import stringWidth from 'string-width';
import type { ReactElement } from 'react';

class FakeStdout extends EventEmitter {
  isTTY = true;
  frames: string[] = [];
  constructor(
    public columns: number,
    public rows: number,
  ) {
    super();
  }
  write = (frame: string) => {
    this.frames.push(frame);
    return true;
  };
}

class FakeStdin extends EventEmitter {
  isTTY = true;
  private data: string | null = null;
  write = (d: string) => {
    this.data = d;
    this.emit('readable');
    this.emit('data', d);
  };
  read = () => {
    const d = this.data;
    this.data = null;
    return d;
  };
  setEncoding() {}
  setRawMode() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
}

export function renderSized(tree: ReactElement, columns: number, rows: number) {
  const stdout = new FakeStdout(columns, rows);
  const stdin = new FakeStdin();
  const inst = render(tree, {
    stdout: stdout as any,
    stderr: new FakeStdout(columns, rows) as any,
    stdin: stdin as any,
    debug: true,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  return { stdin, lastFrame: () => stdout.frames.at(-1) ?? '', unmount: () => inst.unmount() };
}

/** Widest line of a frame, in terminal columns. */
export function widest(frame: string): number {
  return Math.max(0, ...frame.split('\n').map((l) => stringWidth(l)));
}
