import React, { useRef, useState } from 'react';
import { Text } from 'ink';
import type { State } from '../engine/state.js';
import type { Config } from '../config.js';
import type { Lang } from '../i18n.js';

export interface ModeProps {
  st: State;
  update: (fn: (s: State) => void) => void;
  cfg: Config;
  lang: Lang;
  /** Whether this mode should react to keys right now (false while an alert or help is shown). */
  active: boolean;
  width: number;
  height: number;
  now: number;
  busy: boolean;
  setTyping: (v: boolean) => void;
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

type KeyLike = { return?: boolean; escape?: boolean; backspace?: boolean; delete?: boolean; ctrl?: boolean; meta?: boolean; tab?: boolean };

/**
 * Minimal single-line editor for review notes and topics.
 * The text lives in a ref so keystrokes that arrive before React re-renders
 * (fast typing, IME commits, pastes in chunks) are never lost.
 */
export function useLine() {
  const ref = useRef<string | null>(null);
  const [value, setValue] = useState<string | null>(null);
  const set = (v: string | null) => {
    ref.current = v;
    setValue(v);
  };
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
