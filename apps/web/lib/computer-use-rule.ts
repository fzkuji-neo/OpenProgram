/** Project permission rules that allow computer use of one app. */
const APP_RULE = /^computer_use\((.+)\)$/i;

/** The app a ``computer_use(<app>)`` rule names, or null for any other rule. */
export function computerUseRuleApp(rule: string): string | null {
  const match = APP_RULE.exec(rule.trim());
  return match ? match[1].trim() : null;
}
