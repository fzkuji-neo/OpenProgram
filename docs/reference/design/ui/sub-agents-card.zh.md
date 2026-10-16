# 子代理卡片

一个轮次派生出的子代理，集中显示在一张**子代理卡片**里，和文件改动卡片、
报错卡片并列。每个子代理一个标签；打开标签，就在卡片里看到这个子代理
自己的对话。主对话的记录只保留它自己的轮次。

相关：[`chat-turn-visual-spec.html`](chat-turn-visual-spec.zh.html)
（执行时间线与子代理步骤行）、
[`indicator-dots.md`](indicator-dots.zh.md)（标签状态点）。
代码：`apps/web/components/chat/messages/sub-agents-card.tsx`、
`apps/web/lib/chat/sub-agent-transcripts.ts`、
`apps/web/lib/net/chat-stream.ts`（`handleSubAgentResponse`）、
`openprogram/agent/production_driver/execution.py`（`_turn_event_sink`）、
`apps/server/openprogram_server/_webui/ws_actions/sub_agent.py`
（`load_sub_agent_transcript`）。

## 为什么需要它

子代理（一次 `agent` 派生，或之后发给它的 `send_message`）以 Job 运行，
它的轮次是**同一个 session** 里的一条分支，所以实时 chat 帧带的是主对话
的 `session_id`。如果只按 session id 路由，每个子代理的提示、步骤和回复
都会落进主对话的记录里，和父代理自己的回复混在一起。

## 帧

- 生产驱动给每个 Job 轮次一个专用 sink，它在每个 `chat_response` 帧上
  加 `data.job_id`（Job 的 execution id）。主对话轮次仍用原 sink；其他
  类型的帧原样通过。
- 客户端把带 `job_id` 的帧送进子代理路径，绝不交给主对话的处理器；
  运行时桥（`wsHandleChatResponse`）同样忽略它。
- Job 轮次使用准入 id `<job>_user` / `<job>_user_reply`。后续 Job 的
  `job_status.parent_msg_id` 是上一个 `<job>_user_reply`，客户端据此把
  每个 Job 映射到所属子代理的**第一个** Job。同一子代理的所有轮次共用
  store key `<session_id>#sub-agent:<第一个 job id>`；没有 Job id 的旧派生
  按分支头作 key。
- 回复开始流式输出前，客户端先放入提示行。文字来自派生卡片的 prompt，
  或 `job_status` 的 `prompt_summary`。

## 加载记录

`load_sub_agent_transcript {session_id, job_id | head_id}` 返回
`sub_agent_transcript {head_id, messages}`，不移动 session 头。服务端：

1. 只给了 `job_id` 时，从 Job 的 execution input 解析出分支头；
2. 从分支头沿最新的 user/assistant 子节点走到分支末端，这样能读到后来
   发给这个子代理的消息；
3. 按分支顺序（而不是存储顺序）返回这条分支上的 user 和 assistant 行，
   因为回复占位行可能先于提示行写入。

Job 完成时，把它的回复作为 `head_id` 记到 Job 和派生卡片上。canonical
驱动返回的是轮次运行器的 `TurnResult`，回复 id 在 `assistant_msg_id` 字段；
抛出异常的轮次没有结果，此时使用 Job 准入时的回复 id。

客户端用加载结果替换这个子代理的行，并保留加载结果里没有的实时行。
同一子代理的任一 Job 进入终态时重新加载。

## 卡片

- **头部：**机器人图标、"N 个子代理"，以及状态说明（运行中 / 失败 /
  已取消 / 完成）。选中的子代理运行时，头部还会出现取消按钮（走
  `execution.cancel`）。
- **标签：**每个子代理一个胶囊。状态点后面的名称在卡片里打开这个子代理，
  再点一次关闭；卡片默认收起。胶囊右端有一个小圆形 **↗**，样式与地址栏的
  “在浏览器中打开”按钮相同，点击后在主视图里显示这个子代理：checkout 到它
  最新的回复，那里的子代理分支横幅可以切回来。跳转目标是这个子代理已加载
  记录的分支末端（需要时在点击时加载），没有时退回派生卡片的 `head_id`。
- **内容区：**内嵌的凹陷区域，最高 `min(520px, 60vh)`。
  - 每条提示是一张凸起的小卡片，标注*任务*或*消息*。它去掉
    `[task from …]` / `[message from …]` 回执行，点击前最多显示 3 行。
  - 每条回复是 `embedded` 模式的 `AssistantBubble`：没有头部，也没有
    操作栏。
  - 运行中的子代理打开时停在最新输出处，并持续跟随，直到读者向上滚动。
    已完成的子代理打开时停在任务处。
- 时间线里的子代理步骤行保持不变；卡片补上子代理的对话，不替代步骤行。

## 返回路径

在子代理分支上，记录顶部显示子代理分支横幅：子代理的名称和“返回主对话”。
这是那里唯一的返回入口；当前显示的就是这个分支时，分支第一条提示上方的
"创建自"卡片不显示，否则会和横幅重复。横幅回到派生回复之下最新的轮次，
而不是派生回复本身，否则之后的轮次会被隐藏。

有界会话加载不带 graph，所以 head 位于派生分支上时，`session_loaded`
携带 `spawned_branch {root_id, caller_id, back_target, first_reply, label}`
（否则为 `null`）。分支根是 `source=agent_spawn` 且没有 predecessor 的
user 行，它的 `caller` 就是派生回复。根上的 `spawned_from` 标注同样不需要
指针的 head：Job 派生的根按同样方式找到，标签取自 `job_id` 相同的派生卡片。运行在调用途中停止时不会写派生卡片，
这时标签取派生回复里提示词与分支开头相同的那个 `agent` 调用的 `description`。

