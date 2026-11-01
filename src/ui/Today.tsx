import React from 'react';
import { Box, Text } from 'ink';
import { levelInfo, levelTitle, questProgress, streak, QUEST_ENERGY } from '../engine/progress.js';
import type { State } from '../engine/state.js';
import { t, type Lang } from '../i18n.js';
import { Meter, Para, padTo } from './common.js';

/** Level, streak and today's quests: the "come back tomorrow" block (review empty state, Me tab). */
export function Today({ st, lang, width, now }: { st: State; lang: Lang; width: number; now: number }) {
  const lv = levelInfo(st.xp);
  const sk = streak(st, now);
  const quests = questProgress(st, now);
  const head = t(lang, 'me_level', { l: lv.level, title: levelTitle(lv.level)[lang] });
  const nums = `${lv.into}/${lv.need}`;
  const barW = Math.max(6, Math.min(24, width - head.length * 2 - nums.length - 6));
  const doneN = quests.filter((q) => q.done).length;
  return (
    <Box flexDirection="column">
      <Text wrap="truncate-end">
        <Text bold>{head}</Text> <Meter value={lv.into} max={lv.need} width={barW} color="magenta" /> <Text color="gray">{nums} XP</Text>
      </Text>
      {sk.days > 0 ? (
        <Text wrap="truncate-end">
          <Text color={sk.today ? 'yellow' : 'gray'} bold={sk.today}>
            {t(lang, 'me_streak', { n: sk.days })}
          </Text>
          <Text color={sk.today ? 'green' : 'yellow'}> · {t(lang, sk.today ? 'me_streak_kept' : 'me_streak_todo')}</Text>
          {st.bestStreak > sk.days ? <Text color="gray"> · {t(lang, 'me_streak_best', { n: st.bestStreak })}</Text> : null}
        </Text>
      ) : (
        <Para text={t(lang, 'me_streak_zero')} width={width} color="gray" />
      )}
      <Text> </Text>
      <Text>
        <Text bold>{t(lang, 'me_quests')}</Text>
        <Text color="gray"> {doneN}/3</Text>
      </Text>
      {quests.map(({ def, value, done }) => {
        const right = done ? `+${QUEST_ENERGY}⚡` : def.goal > 1 ? `${value}/${def.goal}` : '';
        const labelW = Math.max(10, width - 4 - 7);
        return (
          <Text key={def.id} wrap="truncate-end">
            <Text color={done ? 'green' : 'gray'}>{done ? ' ✓ ' : ' ○ '}</Text>
            <Text color={done ? 'gray' : undefined} strikethrough={false}>
              {padTo(def.label[lang], labelW)}
            </Text>
            <Text color={done ? 'green' : 'cyan'}>{right.padStart(6)}</Text>
          </Text>
        );
      })}
    </Box>
  );
}
