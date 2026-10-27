// docs/talk-track.md is generated from the same data the UI reads (`npm run talk-track`); a test fails if they drift.
import { fillDeep } from './cast.js';
import { TALK_TRACK, VENDORS } from './exchangeData.js';

export const buildTalkTrack = (cast) => fillDeep(TALK_TRACK, cast);

export function renderTalkTrackMarkdown(cast) {
  const parts = ['# Talk track', '', '<!-- Generated from server/src/exchangeData.js by `npm run talk-track`. Do not edit by hand. -->', ''];
  for (const t of buildTalkTrack(cast)) parts.push(`## ${t.title}`, '', t.say, '');
  parts.push('## The issuers to try', '');
  VENDORS.forEach((v, i) => parts.push(`${i + 1}. **${v.name}.** ${v.note}`));
  return `${parts.join('\n')}\n`;
}
