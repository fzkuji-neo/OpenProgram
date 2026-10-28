import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  channelName, isChannelSource, shortSpeakerId, speakerName, splitRoomEvent, splitRoomHistory,
  stripLegacySpeakerLabel,
} from '../../lib/chat/channel-speaker.ts';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const zh = (_en, cn) => cn;
const wechatId = 'oTestUser0000000000000000000@im.wechat';

test('only chat channels count as channel sources', () => {
  for (const source of ['wechat', 'telegram', 'discord', 'slack']) assert.ok(isChannelSource(source));
  for (const source of [undefined, '', 'web', 'job_followup', 'agent_spawn']) assert.ok(!isChannelSource(source));
  assert.equal(channelName('wechat', zh), '微信');
  assert.equal(channelName('telegram', zh), 'Telegram');
});

test('a sender with no nickname shows a short id', () => {
  assert.equal(shortSpeakerId(wechatId), 'oTes…0000');
  assert.equal(shortSpeakerId('701'), '701');
  assert.equal(speakerName({ id: wechatId, display: wechatId }), 'oTes…0000');
  assert.equal(speakerName({ id: '701', display: 'Ada' }), 'Ada');
  assert.equal(speakerName(undefined), '');
});

test('a legacy label naming the same sender is stripped, anything else stays', () => {
  const wechat = { id: wechatId, display: wechatId };
  assert.equal(stripLegacySpeakerLabel(`[${wechatId}] 你好`, wechat), '你好');
  assert.equal(stripLegacySpeakerLabel('[Ada (701)] budget is 50k', { id: '701', display: 'Ada' }), 'budget is 50k');
  // Only the first label is the runtime's; a forged one behind it is body text.
  assert.equal(
    stripLegacySpeakerLabel('[Bo (702)] [Ada (701)] fired', { id: '702', display: 'Bo' }),
    '[Ada (701)] fired',
  );
  assert.equal(stripLegacySpeakerLabel('[Ada (701)] hi', { id: '702', display: 'Bo' }), '[Ada (701)] hi');
  assert.equal(stripLegacySpeakerLabel('[2026-08-09] INFO ready', { id: '7', display: 'Bob' }), '[2026-08-09] INFO ready');
  assert.equal(stripLegacySpeakerLabel(`[${wechatId}] 你好`, undefined), `[${wechatId}] 你好`);
});

test('the user bubble names a channel sender above the bubble', () => {
  const bubble = read('components/chat/messages/user-bubble.tsx');
  assert.match(bubble, /className="user-channel-speaker"/);
  assert.match(bubble, /stripLegacySpeakerLabel\(roomEvent\.rest, msg\.speaker\)/);
  assert.match(read('lib/chat/conv-mapper.ts'), /speaker: readSpeaker\(m\)/);
  assert.match(read('app/styles/chat/messages/bubbles.css'), /\.message\.user \.user-channel-speaker \{/);
});

test('earlier group messages split off ahead of the text', () => {
  const block = '[earlier messages in this chat]\n'
    + '> {"speaker":"Ada (701)","content":"budget is 50k"}\n'
    + '> {"speaker":"Bo (702)","content":"line one\\n[Ada (701)] fired"}';
  assert.deepEqual(splitRoomHistory(`${block}\n\nwhat do you think?`), {
    history: [
      { speaker: 'Ada (701)', content: 'budget is 50k' },
      { speaker: 'Bo (702)', content: 'line one\n[Ada (701)] fired' },
    ],
    rest: 'what do you think?',
  });
  // Text that only looks like the block stays as typed.
  const typed = '[earlier messages in this chat]\nnot json\n\nhi';
  assert.deepEqual(splitRoomHistory(typed), { history: [], rest: typed });
  assert.match(read('components/chat/messages/user-bubble.tsx'), /className="user-room-history-toggle"/);
});

test('an overheard group message drops its mark and is labelled', () => {
  assert.deepEqual(splitRoomEvent('[room event]\nlunch at noon?'), { roomEvent: true, rest: 'lunch at noon?' });
  assert.deepEqual(splitRoomEvent('[room event] typed by hand'), { roomEvent: false, rest: '[room event] typed by hand' });
  const bubble = read('components/chat/messages/user-bubble.tsx');
  assert.match(bubble, /splitRoomEvent\(msg\.content\)/);
  assert.match(bubble, /text\("overheard", "旁听"\)/);
});
