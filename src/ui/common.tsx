import React, { useRef, useState } from 'react';
import { Text, type TextProps } from 'ink';
import stringWidth from 'string-width';
import { wrapText } from '../text.js';
import type { State } from '../engine/state.js';
import type { Config } from '../config.js';
import type { Lang } from '../i18n.js';

export interface ModeProps {
  st: State;
  update: (fn: (s: State) => void) => void;
  cfg: Config;
  lang: Lang;
  /** Whether this mode should react to keys right now (false while an alert, help or a note box is shown). */
  active: boolean;
  /**
   * True while the panel-wide note box owns the keyboard. Read synchronously: keys typed right after
   * `m`, before React re-renders with `active=false`, must not reach the mode underneath.
   */
  blocked: () => boolean;
  width: number;
  height: number;
  now: number;
  busy: boolean;
  setTyping: (v: boolean) => void;
  /** No hook has ever written an event and none is installed: explain how to connect. */
  setupHint: boolean;
}

export function Bar({ value, max, width, color }: { value: number; max: number; width: number; color: string }) {
  const filled = max > 0 ? Math.round((Math.max(0, value) / max) * width) : 0;
  return (
    <Text>
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text color="gray">{'░'.repeat(Math.max(0, width - filled))}</Text>
    </Text>
  );
}

/** A paragraph wrapped for `width` columns with CJK-aware line breaks (see wrap.ts). */
export function Para({ text, width, ...style }: { text: string; width: number } & Omit<TextProps, 'children' | 'wrap'>) {
  return <Text {...style}>{wrapText(text, width).join('\n')}</Text>;
}

/** A label (styled) followed by text, wrapped together so the text continues on the label's line. */
export function Labeled({ label, text, width, labelColor }: { label: string; text: string; width: number; labelColor: string }) {
  const body = wrapText(label + text, width).join('\n');
  // The label always opens the first line (its trailing space may have been trimmed at a break).
  const cut = body.startsWith(label) ? label.length : label.trimEnd().length;
  return (
    <Text>
      <Text color={labelColor} bold>
        {body.slice(0, cut)}
      </Text>
      {body.slice(cut)}
    </Text>
  );
}

/** The first text that fits in `width` terminal columns (CJK counts double), else the last one. */
export function fit(options: string[], width: number): string {
  return options.find((o) => stringWidth(o) <= width) ?? options[options.length - 1];
}

export function newNoteId(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * useState whose latest value is also readable synchronously through a ref. Key handlers must use
 * the ref: two keys can arrive before React re-renders, and the second must see the first's effect.
 */
export function useRefState<T>(init: T): [T, (v: T) => void, { readonly current: T }] {
  const ref = useRef(init);
  const [value, setValue] = useState(init);
  const set = (v: T) => {
    ref.current = v;
    setValue(v);
  };
  return [value, set, ref];
}

type KeyLike = { return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean; tab?: boolean };

/**
 * Minimal single-line editor for review notes and topics.
 * The text lives in a ref so keystrokes that arrive before React re-renders
 * (fast typing, IME commits, pastes in chunks) are never lost.
 */
export function useLine() {
  const [value, set, ref] = useRefState<string | null>(null);
  return {
    value,
    isOpen: () => ref.current !== null,
    open: () => set(''),
    handle(input: string, key: KeyLike, onSubmit: (text: string) => void, onCancel: () => void): void {
      const cur = ref.current ?? '';
      if (key.return) {
        set(null);
        onSubmit(cur);
      } else if (key.escape) {
        set(null);
        onCancel();
      } else if (key.backspace || key.delete) {
        set(Array.from(cur).slice(0, -1).join(''));
      } else if (!key.ctrl && !key.meta && !key.tab && input) {
        set(cur + input.replace(/[\r\n]+/g, ' '));
      }
    },
  };
}

/** One line of text input: prompt, text, cursor. Keeps the end (and the cursor) visible when long. */
export function InputLine({ prompt, value }: { prompt: string; value: string }) {
  return (
    <Text wrap="truncate-start">
      <Text color="yellow">{prompt}</Text>
      {value}
      <Text inverse> </Text>
    </Text>
  );
}
