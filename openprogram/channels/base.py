"""Channel 抽象 — 入口 B 接口定义 + 入站 loop 抽象方法.

入口 B (有状态、保留 message_id 可以后续 edit) 主要给两类调用者用:

* dispatcher 在跑流式 turn 时, 先 ``adapter.send_text(target, "🤔...")``
  拿 handle, 然后 tool 事件触发时 ``adapter.edit_text(handle, "🔧 bash...")``,
  最后用最终 reply 收尾 — 即 channel 侧 progress streaming.
* dispatcher 路径下 channel adapter 自己在 ``on_message`` 里收到用户消息后,
  也可以用 send_text/edit_text 跟用户来回, 而不必各自维护一份 platform SDK
  调用代码.

底层 HTTP 实现走 :mod:`._transport`, 跟入口 A (:mod:`.outbound`) 共用.
Adapter 子类如果想用 platform-native SDK 替代 raw HTTP (比如 discord.py
的 mention 解析、附件上传) 可以 override ``send_text`` / ``edit_text``.

注意: ``run(stop)`` 仍然是抽象方法 — 每个 adapter 的入站事件循环
(discord.py / slack_sdk / 长轮询) 形态差异太大, 没法在 base 里统一.
"""
from __future__ import annotations

import abc
import threading
import time
from dataclasses import dataclass
from typing import Optional

from openprogram._text import (
    IDENTITY_HEADER_PART_MAX_CHARS,
    normalize_identity_header_part,
)


#: quoted 文本进 agent 上下文的截断上限 — 被引用消息只是背景, 不值得
#: 占大量 token.
QUOTED_MAX_CHARS = 500

#: 发言人标签里显示名的截断上限. 显示名是发信人自己在平台上填的, 长度
#: 由平台管, 这里只挡住病态长度不让它盖过消息本身.
SENDER_NAME_MAX_CHARS = IDENTITY_HEADER_PART_MAX_CHARS


def _quoted_block(quoted: str) -> str:
    """被引用消息 → agent 可见的统一 quoted 块 (markdown 引用格式)."""
    q = quoted.strip()
    if len(q) > QUOTED_MAX_CHARS:
        q = q[:QUOTED_MAX_CHARS] + "…"
    lines = "\n".join("> " + ln for ln in q.splitlines())
    return f"[quoted message]\n{lines}"


def _one_line(value: str) -> str:
    """Compatibility wrapper for the shared runtime-header normalizer."""
    return normalize_identity_header_part(value)


class _TypingIndicator:
    """一轮进行期间在聊天里显示"正在输入", 按平台的有效期定时刷新.

    平台不支持 (Slack) 或第一次发送失败就安静退出 — 这只是提示, 不能
    影响回复本身.
    """

    def __init__(self, platform: str, account_id: str, target: str) -> None:
        self.platform = platform
        self.account_id = account_id
        self.target = target
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None
        self._started = False

    def start(self) -> None:
        from openprogram.channels._transport import TYPING_REFRESH_SECONDS
        interval = TYPING_REFRESH_SECONDS.get(self.platform)
        if not interval:
            return
        self._thread = threading.Thread(
            target=self._run, args=(interval,), daemon=True,
        )
        self._thread.start()

    def _run(self, interval: float) -> None:
        from openprogram.channels import _transport
        while not self._stop.is_set():
            try:
                result = _transport.send_typing(
                    self.platform, self.account_id, self.target,
                )
            except Exception:  # noqa: BLE001
                return
            if not result.ok:
                return
            self._started = True
            if self._stop.wait(interval):
                return

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=5)
        if self._started:
            from openprogram.channels import _transport
            try:
                _transport.stop_typing(self.platform, self.account_id, self.target)
            except Exception:  # noqa: BLE001
                pass


@dataclass(frozen=True)
class MessageHandle:
    """指向一条已发出去的消息 — 后续可以拿来 edit.

    四字段都是字符串, 方便跨进程序列化 (写进文件 / 通过 WS 传) — 总管
    程序持有句柄, 别的进程也能拿同样的 handle 去调 edit_text.

    * ``platform``    — "telegram" / "discord" / "slack" / "wechat"
    * ``account_id``  — 哪个账号发的 (multi-account 区分)
    * ``target``      — 收信人语义按 platform 不同, 跟 outbound.send
                        的 user_id 参数一致
    * ``message_id``  — platform-native 字符串. WeChat 是空字符串
                        (iLink 不支持 edit, handle 没法用来 patch)
    """
    platform: str
    account_id: str
    target: str
    message_id: str

    @property
    def editable(self) -> bool:
        """该 handle 是否能用来 edit_text. WeChat 永远 False."""
        return bool(self.message_id) and self.platform != "wechat"


class Channel(abc.ABC):
    """每个 platform adapter 继承这个类.

    ``platform_id`` 子类必须设 (字符串, 跟 ``_transport`` / outbound 用
    的 channel 名一致 — "telegram" / "discord" / "slack" / "wechat").
    """
    platform_id: str = ""

    def __init__(self, account_id: str = "default") -> None:
        self.account_id = account_id

    #: dispatch_inbound 的 progress_stream 参数. WeChat 关掉 (iLink 不能
    #: edit, 占位消息会变成孤儿"⏳"残留), 其他 platform 默认开.
    progress_stream: bool = True

    @abc.abstractmethod
    def run(self, stop: threading.Event) -> None:
        """跑入站事件循环直到 ``stop`` 被 set.

        实现细节按 platform 不同 (discord.py Gateway / Slack Socket Mode
        / Telegram long-poll / WeChat iLink long-poll), 在各 adapter 文件
        自己写. 一般只做两件事:
          * 长连接 / 长轮询拿入站消息, parse 成 ChannelMessage
          * 调 :meth:`handle_inbound` — 线程派发 / dispatch / 降级回发
            都在 base 统一处理

        返回语义 (``run_forever`` 依赖):
          * 抛异常          — 瞬态故障 (断网 / gateway 掉线), 会被退避重连
          * 正常 return     — 永久停止 (凭据失效需人工重登), 不再重启
        """

    #: run_forever 的重连退避参数 — 初始等待秒数, 指数翻倍到上限.
    RESTART_BACKOFF = 5.0
    RESTART_BACKOFF_MAX = 300.0

    def run_forever(self, stop: threading.Event) -> None:
        """带自动重连的入站循环 — worker 用这个入口跑 adapter.

        :meth:`run` 异常退出 (网络断 / gateway 掉线 / SDK 崩溃) 时指数
        退避重连: 5s 起步翻倍, 封顶 300s; 一次运行存活超过 60s 视为
        连接曾经健康, 退避重置回 5s. 每次崩溃和重连都落日志.

        :meth:`run` **正常 return** 视为永久停止 (adapter 自己判断没救
        了, e.g. wechat token 失效要求重新扫码), 不再重启 — 避免对着
        失效凭据无限空转.
        """
        tag = f"{self.platform_id}:{self.account_id}"
        backoff = self.RESTART_BACKOFF
        while not stop.is_set():
            started = time.time()
            try:
                self.run(stop)
            except Exception as e:  # noqa: BLE001
                import traceback
                print(f"[{tag}] adapter crashed: {type(e).__name__}: {e}")
                traceback.print_exc()
            else:
                if not stop.is_set():
                    print(f"[{tag}] adapter exited on its own — "
                          f"not restarting (operator action needed)")
                return
            if stop.is_set():
                return
            if time.time() - started >= 60.0:
                backoff = self.RESTART_BACKOFF
            print(f"[{tag}] reconnecting in {backoff:.0f}s")
            if stop.wait(backoff):
                return
            backoff = min(backoff * 2, self.RESTART_BACKOFF_MAX)

    # ------------------------------------------------------------------
    # 入站统一处理 — adapter parse 完调这个, 不再各抄一遍线程+降级逻辑
    # ------------------------------------------------------------------

    def peer_id_for(self, ch_msg) -> str:
        """从 :class:`ChannelMessage` 算 dispatch 用的 peer_id — 同时也是
        降级回发的 outbound target. 默认 chat_id (telegram 群共享 /
        wechat 单聊). Discord / Slack override 成 ``{chat_id}_{user_id}``
        让同一 channel 里的不同用户各占一个 session."""
        return ch_msg.chat_id

    def handle_inbound(self, ch_msg) -> None:
        """统一入站处理: 每消息起一个 daemon 线程跑 access 门禁 →
        附件下载 → quoted 块组装 → dispatch.

        Per-message 线程是必须的 — 函数在 turn 里停在 runtime.ask 时不能
        堵住 adapter 的 poll loop / 事件回调, 否则用户自己的 /answer 回复
        永远进不来, 等待自死锁. 附件下载同理 (可能几十 MB).

        dispatch_inbound 返回字符串 (progress streaming 降级 / 关闭) 时
        经 :meth:`send_text` 回发 — 统一走 _transport, chunking / 格式
        渲染 / 限流重试都在那一层, adapter 不再持有 platform SDK 的直发
        副本.
        """
        threading.Thread(
            target=self._dispatch_and_reply, args=(ch_msg,), daemon=True,
        ).start()

    def _dispatch_and_reply(self, ch_msg) -> None:
        from openprogram.channels import _room

        peer_id = self.peer_id_for(ch_msg)
        snippet = ch_msg.text[:60] + ("..." if len(ch_msg.text) > 60 else "")
        safe_display = _one_line(ch_msg.user_display)
        who = safe_display or ch_msg.user_id or peer_id
        tag = f"[{self.platform_id}:{self.account_id}]"
        # 别的机器人发的消息不进 agent — 两个机器人在一个群里会互相回复
        # 到有人把它们停下为止.
        if ch_msg.from_bot:
            return
        if not _room.first_delivery(self.platform_id, self.account_id,
                                    ch_msg.chat_id, ch_msg.message_id):
            return
        print(f"{tag} <{who}> {snippet}")

        # ---- access 门禁: 未知发信人不进 agent --------------------------
        # 配对确认只能走本机 CLI/webui (_access 模块 docstring), 这里
        # 只可能发配对码回执, 绝不放行.
        from openprogram.channels import _access
        stable_sender_id = ch_msg.user_id or (
            ch_msg.chat_id if ch_msg.is_dm else ""
        )
        access_decision = _access.decide_inbound_sender(
            self.platform_id, self.account_id,
            stable_sender_id,
            display=safe_display,
        )
        if not access_decision.allowed:
            print(f"[{self.platform_id}:{self.account_id}] <{who}> "
                  "blocked by access policy "
                  f"({access_decision.reason_code})")
            if ch_msg.chat_type in {"group", "channel", "thread"} \
                    and ch_msg.text:
                try:
                    from openprogram.memory.writing import (
                        archive_unpaired_group_message,
                    )

                    archive_unpaired_group_message(
                        channel=self.platform_id,
                        account_id=self.account_id,
                        chat_id=ch_msg.chat_id,
                        message_id=ch_msg.message_id,
                        user_id=stable_sender_id,
                        user_display=safe_display,
                        text=ch_msg.text,
                        timestamp=ch_msg.ts,
                    )
                except Exception as exc:  # noqa: BLE001
                    print(
                        f"[{self.platform_id}:{self.account_id}] "
                        f"pending evidence archive failed: {exc}"
                    )
            if access_decision.reply:
                self.send_text_full(peer_id, access_decision.reply)
            return

        # ---- 房间层: 命令 / @提及门槛 / 限流 -----------------------------
        room_key = (self.platform_id, self.account_id, ch_msg.chat_id)
        in_room = _room.is_room(ch_msg.chat_type)
        verb = _room.command_verb(ch_msg.text)
        if verb in ("/new", "/reset", "/activation"):
            self.send_text_full(peer_id, self._room_command(
                verb, ch_msg, peer_id, room_key, in_room,
            ))
            return
        if in_room and not verb:
            entry = _room.PendingEntry(
                speaker_id=stable_sender_id, speaker_display=safe_display,
                text=ch_msg.text or "(attachment)", ts=ch_msg.ts or time.time(),
            )
            mode = _room.activation(self.platform_id, self.account_id,
                                    ch_msg.chat_id)
            if mode == "mention" and not ch_msg.mentioned:
                _room.record_pending(room_key, entry)
                return
            if not _room.allow_turn(room_key):
                print(f"{tag} room {ch_msg.chat_id} over its turn limit; "
                      "message kept as pending history")
                _room.record_pending(room_key, entry)
                return

        # ---- 附件下载 + quoted 块 → agent 可见的 user_text ---------------
        user_text = ch_msg.text
        turn_attachments: list[dict] = []
        if ch_msg.attachments:
            from openprogram.channels import _attachments
            saved = _attachments.download_inbound(
                self.platform_id, self.account_id, ch_msg.attachments,
            )
            turn_attachments = _attachments.to_turn_attachments(saved)
            notes = _attachments.attachment_notes(saved)
            if notes:
                joined = "\n".join(notes)
                user_text = f"{user_text}\n\n{joined}" if user_text else joined
        # 命令 (/answer · /decline) 原样交给 dispatch 解析, 不拼上下文块.
        if ch_msg.quoted_text and not verb:
            user_text = _quoted_block(ch_msg.quoted_text) + "\n\n" + user_text
        if in_room and not verb:
            pending = _room.take_pending(room_key)
            if pending:
                user_text = _room.render_pending(pending) + "\n\n" + user_text

        # 正文保持发信人原文；发言人只走独立 speaker 字段, 模型从
        # 输入信封 (authority.render_model_input) 读, 网页从消息元数据读.

        if not verb:
            self._ack(ch_msg)
        from openprogram.channels._conversation import dispatch_inbound
        typing = _TypingIndicator(self.platform_id, self.account_id, peer_id)
        if not verb:
            typing.start()
        try:
            reply_text = dispatch_inbound(
                channel=self.platform_id,
                account_id=self.account_id,
                peer_kind=ch_msg.chat_type,
                peer_id=peer_id,
                user_text=user_text,
                user_display=safe_display or peer_id,
                speaker_id=stable_sender_id or None,
                speaker_display=safe_display or None,
                progress_stream=self.progress_stream,
                block_stream=not self.progress_stream,
                attachments=turn_attachments or None,
            )
        finally:
            typing.stop()
        # 占位消息 edit 或分段发送走通时 reply 已经送达, 返回 None.
        if reply_text is not None:
            result = self.send_text_full(peer_id, reply_text)
            if not result.ok:
                print(f"{tag} send failed: "
                      f"{result.error_kind}: {result.error_detail}")

    def _room_command(self, verb: str, ch_msg, peer_id: str,
                      room_key: tuple[str, str, str], in_room: bool) -> str:
        """/new · /reset · /activation — 回执文本."""
        from openprogram.channels import _room
        if verb in ("/new", "/reset"):
            from openprogram.channels._conversation import start_new_conversation
            _room.clear_pending(room_key)
            return start_new_conversation(
                channel=self.platform_id, account_id=self.account_id,
                peer_kind=ch_msg.chat_type, peer_id=peer_id,
            )
        if not in_room:
            return "私聊里我会回复每一条消息，不需要设置。"
        arg = _room.command_arg(ch_msg.text).lower()
        labels = {"mention": "只在 @我 或回复我时回应",
                  "always": "回应每一条消息"}
        if not arg:
            mode = _room.activation(self.platform_id, self.account_id,
                                    ch_msg.chat_id)
            return (f"当前模式：{mode}（{labels[mode]}）。"
                    "用 /activation mention 或 /activation always 切换。")
        if arg not in _room.ACTIVATION_MODES:
            return "用法：/activation mention 或 /activation always"
        _room.set_activation(self.platform_id, self.account_id,
                             ch_msg.chat_id, arg)
        return f"✓ 已切换为 {arg}：{labels[arg]}。"

    def _ack(self, ch_msg) -> None:
        """账号开了 ``ack_reaction`` 时给接手的消息加一个 👀."""
        if not ch_msg.message_id:
            return
        from openprogram.channels import _transport
        from openprogram.channels.accounts import get_settings
        if get_settings(self.platform_id, self.account_id).get(
                "ack_reaction", "off") != "on":
            return
        result = _transport.add_reaction(
            self.platform_id, self.account_id,
            ch_msg.chat_id, ch_msg.message_id,
        )
        if not result.ok and result.error_kind != "not_supported":
            print(f"[{self.platform_id}:{self.account_id}] ack reaction "
                  f"failed: {result.error_kind}")

    # ------------------------------------------------------------------
    # 出站接口 — 默认走 _transport, 子类可 override 用 platform-native SDK
    # ------------------------------------------------------------------

    def send_text(self, target: str, text: str) -> Optional[MessageHandle]:
        """发一条消息. 成功返回 :class:`MessageHandle` (可用来后续 edit),
        失败返回 ``None``.

        想拿结构化失败原因 (error_kind / retryable) 用
        :meth:`send_text_full`.

        Default 实现走 :func:`._transport.post_message`, 跟 outbound.send
        是同一份底层. 子类想用 platform-native SDK 替代 (mention 解析、
        附件上传等) 可以 override.
        """
        result = self.send_text_full(target, text)
        if not result.ok:
            return None
        return MessageHandle(
            platform=self.platform_id,
            account_id=self.account_id,
            target=target,
            message_id=result.message_id,
        )

    def send_text_full(self, target: str, text: str):
        """跟 :meth:`send_text` 一样但返回完整 :class:`SendResult`."""
        from openprogram.channels import _transport
        return _transport.post_message(
            self.platform_id, self.account_id, target, text,
        )

    def send_file(self, target: str, path: str, caption: str = ""):
        """把本地文件发给 ``target``. 返回 :class:`SendResult`.

        走 :func:`._transport.post_file`. WeChat (iLink 无文件上传接口)
        返回 ``not_supported`` — 调用方自行降级 (e.g. 改发带路径的文本).
        """
        from openprogram.channels import _transport
        return _transport.post_file(
            self.platform_id, self.account_id, target, path, caption,
        )

    def edit_text(self, handle: MessageHandle, new_text: str) -> bool:
        """把 ``handle`` 指向的消息改成 ``new_text``. 返回 True/False.

        WeChat 永远返回 False (iLink 不支持 edit). 其他 platform 走
        :func:`._transport.patch_message`. 想拿结构化失败原因用
        :meth:`edit_text_full`.

        Handle 的 ``platform`` 字段必须跟当前 adapter 一致 — 不允许跨
        platform edit (那是 multi-adapter 协调的范畴, 不归 base 管).
        """
        return self.edit_text_full(handle, new_text).ok

    def edit_text_full(self, handle: MessageHandle, new_text: str):
        """跟 :meth:`edit_text` 一样但返回完整 :class:`SendResult`."""
        from openprogram.channels._transport import SendResult
        if not handle.editable:
            return SendResult.fail(
                "not_supported",
                f"{handle.platform} message {handle.message_id!r} not editable",
            )
        if handle.platform != self.platform_id:
            return SendResult.fail(
                "bad_target",
                f"cross-platform edit refused: handle.platform={handle.platform!r} "
                f"vs adapter.platform_id={self.platform_id!r}",
            )
        from openprogram.channels import _transport
        return _transport.patch_message(
            handle.platform, handle.account_id,
            handle.target, handle.message_id, new_text,
        )
