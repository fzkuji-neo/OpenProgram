# Reminders

Ask the agent to remind you of something at a time, or to come back and do something later. Say it in plain words in any conversation:

- "Remind me in 20 minutes to take the bread out."
- "At 5 pm remind me to send the invoice."
- "Every weekday at 9:00 remind me to check the standup notes."
- "Tomorrow at 9, check whether the CI run passed and tell me what failed."

The first three are **notifications**: at that time you get the message. The last one **wakes the agent**: at that time a turn starts in the same conversation with the request, and the agent does the work then.

## Setting one

The agent sets reminders with its `remind` tool. Its reply says the exact time the reminder fires, for example "fires Fri 2026-10-23 17:00 CST (in 2.5 h)", so you can check it understood you.

| You say | When it fires |
| --- | --- |
| "in 20 minutes" | 20 minutes from now |
| "at 17:00" | The next 17:00: today if it is still ahead, otherwise tomorrow |
| "on December 1 at 10:00" | That date and time |
| "every weekday at 9:00" | Repeats; the agent writes a cron expression such as `0 9 * * 1-5` |

Times are in your computer's local time zone unless you name another one. A reminder fires within a minute of its time.

Whether a reminder only notifies you or wakes the agent follows from what you ask. Asking to *be reminded* notifies you. Asking the agent to *do* something later wakes it. Say which one you want if it matters.

## When it fires

A notification reminder:

- shows a message in every open OpenProgram window;
- posts a system notification, even while you are using the App. The desktop App posts it (clicking it opens the conversation). When no App window is open, the worker posts it itself, also under the OpenProgram name and icon. A worker installed with pip instead of the App posts it through Script Editor on macOS, and needs `notify-send` on Linux;
- is sent as a message when it was set in a [chat channel](../integrations/channels.md) conversation (Telegram, Slack, Discord or WeChat).

A reminder that wakes the agent does all of the above, then starts a turn in the conversation it was set in. The turn's message begins with ⏰ and the reminder text, and it runs with that conversation's permission mode and rules. If a turn is already running there, it waits up to 10 minutes for that turn to end. In a chat channel conversation, the agent's answer is also sent to the channel.

If the conversation has been deleted when the reminder fires, you still get the notification, but no turn starts.

## See, pause or cancel reminders

Open **Scheduler** in the sidebar. Reminders are listed with the other scheduled tasks, labeled **Reminder** or **Reminder · wakes agent**. Pause, resume or delete them there, or ask the agent ("cancel my 5 pm reminder"); it uses the `scheduler` tool to list and delete them.

## Limits

- Reminders run in the OpenProgram worker on this computer. If the worker is not running at the time, a one-time reminder fires as soon as it starts again; a repeating reminder skips the times it missed. Keep the worker running at login with `openprogram worker install`.
- System notifications follow your system settings: Focus or Do Not Disturb holds them in Notification Center. The App's **Notifications** setting turns off the App's own notifications too.
- Only you, as the local owner in an interactive conversation, can set reminders.

## Run your own command

Each reminder that fires is a `reminder.fired` event. A `hooks` entry in `config.json` runs a command of yours on it, with the event as JSON on the command's standard input:

```json
{"hooks": {"reminder.fired": [{"command": "python ~/bin/on_reminder.py", "timeout": 30}]}}
```

The event's `payload` carries `message`, `title`, `session_id`, `wake` and `fired_at`. Hooks are read when the worker starts. The [event layer design](../reference/design/proactive/event-layer.md) describes events and hooks.
