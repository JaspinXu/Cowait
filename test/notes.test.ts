import { describe, it, expect, beforeEach } from 'vitest';
import { handleHook } from '../src/hook.js';
import { addNote, pendingNotes } from '../src/feedback.js';
import { applyEvents } from '../src/engine/reducer.js';
import { newState, recordNote, waitingNotes } from '../src/engine/state.js';
import { tempHome } from './helpers.js';

beforeEach(() => {
  tempHome();
});

const tool = (cwd: string, t: number) => handleHook(JSON.stringify({ session_id: 'x', cwd, hook_event_name: 'PostToolUse', tool_name: 'Read' }), t);

describe('note routing', () => {
  it('hands a note only to a Claude session working in that project', () => {
    addNote({ id: 'a', t: 1, text: 'for project A', cwd: '/work/projA' });
    addNote({ id: 'b', t: 2, text: 'for whoever is next' });

    const elsewhere = tool('/work/projB', 10);
    expect(elsewhere).toContain('for whoever is next');
    expect(elsewhere).not.toContain('for project A');
    expect(pendingNotes().map((n) => n.id)).toEqual(['a']);

    // A session inside the project (Claude cd'd into a subfolder) still counts.
    expect(tool('/work/projA/src', 11)).toContain('for project A');
    expect(pendingNotes()).toEqual([]);
  });

  it('does not treat a folder that merely shares a name prefix as the same project', () => {
    addNote({ id: 'a', t: 1, text: 'for app', cwd: '/work/app' });
    expect(tool('/work/app-v2', 10)).toBeNull();
    expect(pendingNotes()).toHaveLength(1);
  });

  it('a session in a parent folder (or at the root) does not take a project’s note', () => {
    addNote({ id: 'p', t: 1, text: 'for shop-api', cwd: '/home/dev/shop-api' });
    expect(tool('/home/dev', 10)).toBeNull();
    expect(tool('/', 11)).toBeNull();
    expect(pendingNotes()).toHaveLength(1);
  });

  it('the session a note was written for gets it, whichever folder it is in now', () => {
    addNote({ id: 's', t: 1, text: 'for this session', cwd: '/home/dev/shop-api/src', sid: 'abc' });
    const out = handleHook(JSON.stringify({ session_id: 'abc', cwd: '/home/dev/shop-api', hook_event_name: 'PostToolUse', tool_name: 'Read' }), 10);
    expect(out).toContain('for this session');
  });

  it('compares Windows folders without caring about case or slash style', () => {
    addNote({ id: 'w', t: 1, text: 'from the panel', cwd: 'G:\\Cowait' });
    expect(handleHook(JSON.stringify({ session_id: 'x', cwd: 'g:/cowait/src', hook_event_name: 'UserPromptSubmit' }), 10)).toContain('from the panel');
  });
});

describe('note tracking in the panel', () => {
  it('knows which notes still wait, and signals when Claude receives them', () => {
    const s = newState();
    recordNote(s, { id: 'n1', t: 1, text: 'keep the 200' });
    recordNote(s, { id: 'n2', t: 2, text: 'use pnpm' });
    expect(waitingNotes(s).map((n) => n.id)).toEqual(['n1', 'n2']);

    const sig = applyEvents(s, [{ t: 5, k: 'delivered', sid: 's', ids: ['n2'] }]);
    expect(sig).toContainEqual({ type: 'delivered', t: 5, count: 1 });
    expect(waitingNotes(s).map((n) => n.id)).toEqual(['n1']);
  });

  it('keeps only the most recent notes', () => {
    const s = newState();
    for (let i = 0; i < 45; i++) recordNote(s, { id: `n${i}`, t: i, text: 'x' });
    expect(s.notes).toHaveLength(30);
    expect(s.notes[0].id).toBe('n15');
  });
});
