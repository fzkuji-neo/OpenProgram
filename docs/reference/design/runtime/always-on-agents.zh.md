# 常驻 Agent

常驻 Agent 在用户不在场时持续工作：持有一个常驻目标，按计划唤醒，没有任务时做只读调研，并报告发现。参考产品是 OpenAI 的 dots 和 xAI 的 Grok Bot：两者都给一个 agent 持久目标、独立的工作场所、随反馈改进的记忆，以及“哪些事可以自己做”的规则。

OpenProgram 用已有的部件构建它。常驻 Agent 就是一个开启了 `always_on` 分区的普通已保存 Agent（`AgentSpec`），使用该 Agent 的模型、指令、工具、记忆空间和权限规则。它的工作发生在一个普通会话里，它的目标就是普通的聊天目标。新代码只负责决定何时唤醒、每次唤醒做什么、报告送到哪里。

## 组成

| 部件 | 位置 | 复用 |
| --- | --- | --- |
| 配置 | `agent.json` 中的 `AgentSpec.always_on` | Agent 管理与带 revision 的保存 |
| 常驻会话 | 一个 `source="always_on"` 的会话 | 会话存储与聊天界面 |
| 常驻目标 | 常驻会话中的聊天目标 | 目标续跑、验证与预算 |
| 唤醒计划 | `openprogram/agent/always_on/ticker.py`，worker 线程 | worker 服务启动流程 |
| 巡检回合 | 使用只读工具列表的普通回合 | `CanonicalAgentAdapter`、`TurnRequest.tools_override` |
| 报告 | `always_on_report` 工具、`reports.jsonl`、`always_on_report` 帧 | 桌面通知桥 |
| 渠道发送 | `openprogram/agent/always_on/delivery.py` | `channels.outbound.send_full`、绑定、渠道会话 |
| 学习 | Agent 自己的记忆空间 | 记忆策略与会话结束提取 |
| 规则 | 常驻会话的权限模式与规则 | 权限规则与审批卡片 |

## 配置

`always_on` 是 Agent 配置的一部分，因此和 Agent 编辑器的单一草稿、revision 校验一起保存：

| 字段 | 类型 | 默认值 | 含义 |
| --- | --- | --- | --- |
| `enabled` | bool | `false` | 是否按计划唤醒 |
| `goal` | 字符串，最多 4000 字符 | `""` | 常驻目标；为空表示只做巡检 |
| `wake_minutes` | int，5–10080 | `60` | 两次计划唤醒的间隔 |
| `research` | bool | `true` | 没有未结束目标时是否巡检 |
| `autonomy` | `"report"` 或 `"act"` | `"report"` | 巡检能否自行启动目标 |
| `channels` | `{channel, account_id, peer_id, label}` 列表，最多 10 个 | `[]` | 同时接收每条报告的渠道会话 |

`agent/management/manager.py` 中的 `validate_always_on()` 规范化该分区，方式与 `validate_memory_config()` 规范化记忆相同。没有该分区的旧 `agent.json` 加载为关闭。复制 Agent 时会复制该分区，但强制关闭 `enabled`，副本不会自己开始唤醒。

## 运行状态

运行状态与配置分开存放，唤醒既不会推高配置 revision，也不会与打开的编辑器草稿冲突。它位于 `<agent 目录>/always_on/`：

- `state.json`：`home_session_id`、`applied_goal`（最近一次从配置启动的目标文本和目标 id）、`last_wake`（`at`、`reason`、`outcome`、`detail`）与 `next_wake_at`。
- `reports.jsonl`：每行一条报告（`id`、`at`、`title`、`body`、`links`、`session_id`，选了渠道时还有 `deliveries`），只保留最新 200 条。

两个文件都在每个 Agent 的锁内原子写入。

## 常驻会话

每个常驻 Agent 恰好有一个常驻会话。`home_session()` 在第一次需要时创建它，标题为 `<Agent 名称> · Always-on`。用户删除后，下次唤醒会新建。用户可以像普通聊天一样在这里和 Agent 对话。目标回合、巡检和报告都出现在这份记录里，Agent 做的事都看得见。

## 唤醒

`wake(agent_id, reason)` 在每次计划触发和 **立即唤醒** 时运行。它总会记录 `last_wake`，并安排 `next_wake_at = now + wake_minutes`。一次唤醒最多做一件事，按以下顺序判断：

1. **disabled**：`always_on.enabled` 关闭。计划唤醒到此为止；**立即唤醒** 被拒绝。
2. **busy**：常驻会话中已有回合在运行，不启动任何事。
3. **goal started**：常驻 `goal` 非空、不同于 `applied_goal`，且会话中没有未结束的目标。运行时用该目标创建聊天目标，并通过 `goal.chat.start_from_controls()` 启动。之后由普通的目标续跑一轮轮推进，并由验证决定是否完成。
4. **goal in progress** 或 **goal paused**：有未结束的目标。唤醒不干预：自动续跑属于目标运行时，用户的暂停永远不会被覆盖。
5. **check-in**：开启了 `research`，运行时启动一个巡检回合（见下文）。
6. **idle**：无事可做。

因此修改后的常驻目标会在当前目标结束后生效。用户可在会话中用 `/goal clear` 结束当前目标，立即切换。

## 巡检回合

巡检是常驻会话中的普通 owner 聊天回合（source 为 `web`），使用该会话自己的权限模式与规则。这样目标续跑、验证和审批卡片对待它与用户发起的聊天完全一致。提示词写明上一次巡检的时间、常驻目标和自主程度，并要求 Agent：

- 回顾记忆和会话中未完结的事项；
- 只用只读工具查找与目标相关的新情况；
- 发现值得用户看的事时调用 `always_on_report`，否则不报告。

`tools_override` 把回合限制为只读工具：`read`、`grep`、`glob`、`list`、`web_search`、`web_fetch`、`read_conversation`、`memory_search`、`memory_get`、`memory_grep`、`memory_browse`、`todo_list`、`get_goal` 与 `always_on_report`。`autonomy="act"` 时再加入 `create_goal`、`todo_create`、`todo_update`，Agent 可以把发现转为自己的目标，随后按常规工具与权限执行。MCP 工具不在列表中，因为无法仅凭名称判断一个服务的工具是否只读。

## 报告

`always_on_report(title, body, links)` 是一个工具，toolset 为单独的 `always_on`，不在默认工具集中。`loop_runner` 只在常驻会话里提供它（`agent_for_session()` 判断），其他会话中会被移除；在常驻会话以外调用也会被拒绝。报告追加到 `reports.jsonl`，并广播为 `always_on_report` 帧。桌面壳通过现有的注意力桥把它转成系统通知（kind 为 `report`，以报告 id 去重，仅在没有 App 窗口获得焦点时显示），点击后打开常驻会话。产生报告的工具调用也留在会话记录中。

## 渠道发送

`always_on.channels` 列出同时接收每条报告的渠道会话。`channel` 取 `telegram`、`slack`、`discord` 或 `wechat`。`peer_id` 是渠道传输层期望的目标，与渠道会话保存的 id 相同；Slack 和 Discord 的目标是带作用域的 `<channel>_<user>` id。`validate_always_on()` 拒绝未知渠道和空 id，并去掉同一 (channel, account, peer) 的重复项。

常驻标签页的候选来自 `delivery.channel_targets()`，状态接口以 `channel_targets` 返回：

- 此 Agent 的渠道会话（带 `channel`、`account_id` 和 `peer_id` 的会话行），标签取对方的显示名；
- 此 Agent 的 peer 绑定。没有指定账号的绑定会展开到该渠道的每个账号。

绑定到整个渠道或账号的绑定没有指定 peer，在有人通过它和 Agent 聊过之前不提供候选。

Agent 有目标时，`runtime.report()` 保存报告时为每个目标写一行 `deliveries`，状态为 `sending`，并照常广播。随后调用 `delivery.deliver()`，在后台线程中发送，因此工具会立即返回；重试和限流可能需要几十秒。线程通过 `channels.outbound.send_full()` 给每个目标发一条 Markdown 消息：加粗的 `<Agent 名称> · <标题>`、正文，然后是链接列表。渠道传输层按平台渲染并切分长文本。每行变为 `sent`，或者 `failed`，并带上传输层的 `error_kind` 和一行 `detail`；异常记为 `unknown`。线程随后用 `store.update_report()` 写回各行，并广播 `always_on_update`，让打开的常驻标签页刷新。发送失败既不会删除报告，也不会让工具失败。

## 从反馈中学习

常驻 Agent 通过已配置的记忆学习。记忆设为 **读写** 且写入 **此 Agent** 时，会话结束写入器会把常驻会话中的偏好与纠正提取到 Agent 自己的空间，之后每个回合都会读回。记忆不是读写时，常驻标签页会提示；它不会自行修改记忆设置。

## 规则

Agent 可以独立做什么，取决于常驻会话的权限模式加上已保存的权限规则，与其他会话的控制方式相同。回合需要的审批在会话里以审批卡片等待，并发出“需要你的回复”通知。巡检不增加任何权限，只收窄工具列表。

## 计划

`ticker.py` 随 worker 的其他服务一起启动。它每 30 秒列出开启 `always_on.enabled` 的 Agent，唤醒 `next_wake_at` 已过或从未设置的那些。因此新开启的 Agent 在保存后半分钟内唤醒；worker 重启沿用已保存的计划，不会同时唤醒所有 Agent。同一 Agent 的两次唤醒不会并发。

## 界面

- **Agents → 常驻标签页**：配置字段，以及状态区：常驻会话、上次与下次唤醒、**立即唤醒**、**打开** 和最近的报告。
- **HTTP**：`GET /api/agents/{id}/always-on` 返回配置、状态、最近报告与 `channel_targets`；`POST /api/agents/{id}/always-on/wake` 立即唤醒；`POST /api/agents/{id}/always-on/home` 返回（必要时创建）常驻会话。`PATCH /api/agents/{id}` 像其他分区一样接受 `always_on`。
- **Python**：`openprogram.agent.always_on` 提供 `wake()`、`status()`、`reports()`、`home_session()` 和 `channel_targets()`。

## 实现状态

已实现：配置、常驻会话、唤醒判断、巡检、带桌面通知的报告、渠道发送、定时器、HTTP、Python API 与常驻标签页。

未实现：

- 每个 Agent 独立的云端计算机。工作在本机进行，使用会话的工作目录与沙箱。
- 免打扰时段与每日唤醒窗口。
- 多个常驻 Agent 组队协作。
