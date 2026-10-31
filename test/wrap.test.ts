import { describe, it, expect } from 'vitest';
import { wrapText } from '../src/text.js';

describe('wrapText', () => {
  it.each([
    ['English wraps at spaces', 'the quick brown fox', 10, ['the quick', 'brown fox']],
    ['Chinese can break between any two characters', '一二三四五六', 4, ['一二', '三四', '五六']],
    ['an English word inside Chinese stays whole and stays on the line it starts', '用 Claude 刚写的代码出题', 12, ['用 Claude 刚', '写的代码出题']],
    ['closing punctuation never starts a line', '一二三四。', 8, ['一二三', '四。']],
    ['an opening bracket never ends a line', '一二三（四）', 8, ['一二三', '（四）']],
    ['a word longer than the line is split', 'abcdefghij', 4, ['abcd', 'efgh', 'ij']],
    ['explicit newlines are kept', 'ab\ncd', 10, ['ab', 'cd']],
    ['no space is left at the start of a wrapped line', 'aaa bbb', 3, ['aaa', 'bbb']],
  ])('%s', (_name, text, width, want) => {
    expect(wrapText(text, width)).toEqual(want);
  });
});
