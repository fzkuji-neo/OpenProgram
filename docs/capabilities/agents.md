# Configure an Agent

Open **Agents** in the sidebar. An Agent saves a reusable configuration: model, instructions, available capabilities, memory access and channel conversation settings. It does not have to represent a specialized task.

Choose **New Agent**, select a template or **Blank Agent**, choose a model and enter a name, then edit its configuration. The internal ID is generated automatically. Search the list by name, ID or description.

| Section | What it changes |
| --- | --- |
| Overview | Display name, description and configuration summary |
| Model & Instructions | Provider, model, reasoning effort and system prompt |
| Programs | Automatic tool availability, selected programs or no programs |
| Skills | Available skills and exclusions |
| MCP | Allowed, excluded and required servers |
| Memory | Off, read only or read and write; readable and writable spaces |
| Context | Channel conversation isolation, idle reset and daily reset |
| Advanced | Channel identity, mention patterns and workspace file paths |

Changes across sections share one draft. **Save** writes the complete configuration. Changing Agents or starting a destructive action offers Save, Discard or Cancel. Failed saves retain the draft. If another editor saved first, compare your draft with the latest version before choosing which to keep. Keeping your draft does not immediately overwrite the newer version; review it and save again.

The model picker reads the provider catalog without changing another conversation's model. Inherit uses the current default model. An unavailable model or unsupported reasoning effort remains visible until you explicitly change it. Missing required MCP servers prevent execution before a model request.

## Start from a template

Templates create ordinary, editable Agent configurations. They use the same `Agent` and `Context` execution paths, with memory off by default.

| Template | Use it for | Starting capabilities |
| --- | --- | --- |
| Image creator | Generate images from a brief | `image_generate`; requires a configured image backend |
| Decision advisor | Compare options, recommend a choice and identify missing evidence | No tools |
| Lightweight helper | Extract, classify, format, summarize briefly or predict candidate next messages when asked | No tools |
| Coordinator | Plan dependencies, delegate authorized tasks and check the combined result | Read/search and Agent coordination tools |

The creation dialog uses the existing model catalog. Select a low-cost model for the lightweight helper and a strong reasoning model for the coordinator. Templates do not guarantee a price or quality level, and inheriting the default model does not make a task cheaper. A supported reasoning effort is suggested when you select a template; you can change it before creation. Image generation uses its separately configured backend; this template does not add image editing.

Predicted next messages are suggestions, not confirmed user intent or authorization. The coordinator produces a plan without delegating when the request is only to plan. These are model instructions; actual permissions remain governed by the existing execution policy.

All template configurations start with Skills and MCP disabled. Enable specific capabilities in the editor as needed. Creating a template instance does not change existing Agents or your default Agent. Each instance can be edited or duplicated independently.

Python code can create and use the same saved template configuration:

```python
from openprogram import Agent
from openprogram.agent.management import manager

spec = manager.create_from_name("Small tasks", template_id="utility")
helper = Agent.from_spec(spec)
result = helper("Extract the city from: the event is in Singapore.")
```

Use `provider`, `model_id`, and `thinking_effort` in `create_from_name()` to select an explicit model. Omitting them inherits the configured model and its reasoning default. Creating a saved configuration writes to the Agent registry; calling the resulting Agent uses the normal model runtime.

## Start a conversation or try a draft

**New conversation** uses the saved Agent configuration. **Try in new conversation** opens an independent chat with the current draft. It does not save the Agent. The first message records that trial's configuration snapshot; subsequent messages and resumed execution retain it. Trials never write long-term memory: a saved or draft Off setting stays Off; other trials are read only.

Multiple unsent conversations retain their own Agent selection and overrides. Sending one does not use another tab's Agent. A rejected first message preserves the selection for retry. Changing the model in an unsent Agent conversation applies only to that conversation.

Saved instructions, capability settings and memory settings apply to subsequent executions using that Agent. Existing conversations keep the model selected when they started and any explicit reasoning choice. When reasoning effort is unset, they use the current Agent default. Explicit conversation overrides remain in effect. Trial conversations keep their snapshot. Context reset settings govern channel conversations; new chats and trials start with new history.

## Memory access

New Agents start with memory Off. Existing configurations without a memory field retain access to the legacy shared memory. **This Agent** stores memory separately for that Agent; **Shared legacy memory** refers to the pre-existing profile-wide store. A read-and-write configuration must include its write destination in its readable spaces.

Off prevents framework memory reads and writes. Read only allows reads without extraction or new records. Background extraction and derived results preserve recorded write restrictions, so turning memory back on does not ingest earlier restricted turns. Turning memory off or deleting an Agent configuration does not delete its already stored memory. These settings govern the framework's memory operations; filesystem tool access follows its own permissions.

If **Require memory to be available** is enabled, unavailable memory prevents execution. Otherwise the execution continues without memory and records the degradation. The [Memory page](memory.md) describes editing the existing shared store; it is not a browser for each Agent's separate memory space.

## Duplicate and delete

Duplicate copies the configuration, with a new ID. It does not copy conversations, workspace file contents or private memory. A `self` memory reference resolves to the new Agent's separate space; an explicit legacy shared reference still points to the shared store. The default Agent cannot be deleted until another Agent is made default.
