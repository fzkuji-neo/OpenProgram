/** Who sent a message that came in through a chat channel (WeChat,
 *  Telegram, Discord, Slack). The worker keeps the sender beside the
 *  text, never inside it; turns stored before that carried a
 *  "[name (id)] " label at the head of the text, which is stripped here
 *  for display. */

type Text = (en: string, zh: string) => string;

const CHANNEL_NAMES: Record<string, string> = {
  telegram: "Telegram", slack: "Slack", discord: "Discord", wechat: "WeChat",
};

export function isChannelSource(source: string | undefined): source is string {
  return Boolean(source && source in CHANNEL_NAMES);
}

export function channelName(channel: string, text: Text): string {
  return channel === "wechat" ? text("WeChat", "微信") : CHANNEL_NAMES[channel] ?? channel;
}

export interface ChannelSpeaker {
  id?: string;
  display?: string;
}

/** A platform id with no nickname behind it reads as noise
 *  ("o9cq80y8K9j5JBUISailVBX4ZvkE@im.wechat"): drop the account suffix
 *  and keep both ends, enough to tell two senders apart. */
export function shortSpeakerId(id: string): string {
  const bare = id.replace(/@im\.wechat$/, "");
  return bare.length > 12 ? `${bare.slice(0, 4)}…${bare.slice(-4)}` : bare;
}

export function speakerName(speaker: ChannelSpeaker | undefined): string {
  const display = speaker?.display?.trim();
  const id = speaker?.id?.trim();
  if (display && display !== id) return display;
  return id ? shortSpeakerId(id) : "";
}

/** The text without a leading "[label] " that names this same sender. */
export function stripLegacySpeakerLabel(content: string, speaker: ChannelSpeaker | undefined): string {
  const match = /^\[([^\]\n]+)\] /.exec(content);
  if (!match || !speaker) return content;
  const label = match[1];
  const { id, display } = speaker;
  const known = [display, id, display && id ? `${display} (${id})` : undefined];
  return known.includes(label) ? content.slice(match[0].length) : content;
}
