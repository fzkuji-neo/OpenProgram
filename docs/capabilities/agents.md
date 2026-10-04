# Configure an Agent

Open **Agents** in the sidebar. An Agent saves a reusable configuration: model, instructions, available capabilities, memory access and channel conversation settings. It does not have to represent a specialized task.

Choose **New Agent**, enter a name and choose a model, then edit its configuration. The internal ID is generated automatically. Search the list by name, ID or description.

| Section | What it changes |
| --- | --- |
| General | Display name, description, provider, model, reasoning effort and system prompt |
| Programs | Automatic tool availability, selected programs or no programs |
| Skills | Available skills and exclusions |
| MCP | Allowed, excluded and required servers |
| Memory | Off, read only or read and write; readable and writable spaces |
| Context | Channel conversation isolation, idle reset and daily reset |
| Advanced | Channel identity, mention patterns and workspace file paths |

Changes across sections share one draft. **Save** writes the complete configuration. Changing Agents or starting a destructive action offers Save, Discard or Cancel. Failed saves retain the draft. If another editor saved first, compare your draft with the latest version before choosing which to keep. Keeping your draft does not immediately overwrite the newer version; review it and save again.

The model picker reads the provider catalog without changing another conversation's model. Inherit uses the current default model. An unavailable model or unsupported reasoning effort remains visible until you explicitly change it. Missing required MCP servers prevent execution before a model request.

## Specialist Agents

Image creator, Decision advisor, Lightweight helper and Coordinator are ordinary saved Agents. Select one from the list to start a conversation or edit it. The list shows its purpose; configuration sections are tabs above the editor. New Agent creates an independent configuration; Duplicate copies a saved Agent's settings.

| Agent | Purpose | Capabilities |
| --- | --- | --- |
| Image creator | Generate images from a brief | `image_generate`; requires a configured image backend |
| Decision advisor | Compare options and explain a recommendation | No tools |
| Lightweight helper | Extract, classify, format, summarize, or predict candidate next messages when asked | No tools |
| Coordinator | Plan dependencies, delegate authorized tasks and check results | Read/search and Agent coordination tools |

Choose a low-cost model for the lightweight helper and a strong reasoning model for the coordinator in General. Their names do not guarantee price or quality. Image generation uses a separately configured backend and does not include image editing. Predicted messages are suggestions rather than authorization; a planning-only request does not authorize delegated execution.

The specialist Agents start with memory, Skills and MCP disabled. Their Context is built by the existing runtime. Each saved Agent can be edited or duplicated independently, without changing the default Agent.

Python can call a saved Agent directly:

```python
from openprogram import Agent
from openprogram.agent.management import manager

helper = Agent.from_spec(manager.get("utility"))
result = helper("Extract the city from: the event is in Singapore.")
```

For an explicit installation, `create_builtin_agents()` in `openprogram.agent.management.builtin_agents` creates missing specialist records and preserves existing records. Registry reads do not install Agents or recreate deleted ones.

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
