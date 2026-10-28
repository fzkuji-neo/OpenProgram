import styles from "./agent-cursor.module.css";

/**
 * The agent's pointer: an accent arrow whose tip sits at the centre of its
 * 40px box, plus a one-shot click ripple. The box is placed centred on the
 * action point, so the tip lands exactly on it. Display only: it never takes
 * pointer events. The accent comes from `--agent-accent`.
 */
export function AgentCursor({
  play,
  playSeq = 0,
}: {
  play: "once" | "never";
  playSeq?: number;
}) {
  return (
    <span className={styles.agentCursor} data-agent-cursor="true" aria-hidden="true">
      {play === "once" ? <span key={playSeq} className={styles.ripple} data-agent-ripple="true" /> : null}
      <svg className={styles.arrow} viewBox="0 0 16 24" width={16} height={24} focusable="false">
        <path d="M1 1 V20 L5.6 15.7 L8.7 22.7 L11.7 21.5 L8.7 14.7 H14.8 Z" />
      </svg>
    </span>
  );
}
