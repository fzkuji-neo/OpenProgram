import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { groupTools } from "../../components/functions/tool-groups.ts";

const root = new URL("../../", import.meta.url);
const read = (name) => readFileSync(new URL(name, root), "utf8");
const page = read("components/agents/agents-page.tsx");
const types = read("components/agents/agent-types.ts");
const capabilities = read("components/agents/agent-capabilities.tsx");
const models = read("components/agents/model-picker.tsx");
const controls = read("components/agents/agent-controls.tsx");
const panels = read("components/agents/agent-panels.tsx");
const pageStyles = read("components/agents/agents-page.module.css");
const source = [page, types, capabilities, models, controls, panels].join("\n");
const primaryNav = read("components/sidebar/sidebar-primary-nav.tsx");
const sender = read("components/chat/composer/submit/send-chat-message.ts");
const route = read("../server/openprogram_server/_webui/routes/files/tree.py");

// Structural boundaries, with user-visible flows covered by the real browser test.
assert.match(page, /ManagePageHeader, managePageStyles/);
assert.match(controls, /ManageRow/);
assert.match(page, /settings-page\.module\.css/);
assert.match(page, /from "@\/components\/ui\/tabs"/);
assert.match(page, /from "@\/components\/ui\/dialog"/);
assert.match(page, /<Tabs[\s\S]*value=\{tab\}/);
assert.match(page, /<AgentListRow/);
for (const name of ["overview", "model", "programs", "skills", "mcp", "memory", "context", "advanced"]) {
  assert.match(types, new RegExp(`id: "${name}"`));
}
assert.match(page, /\/api\/agents/);
assert.match(page, /expected_revision: baseline\?\.revision/);
assert.match(page, /startAgentConversation/);
assert.match(page, /beforeunload/);
assert.match(models, /\/api\/providers\/list/);
assert.match(models, /thinking_levels/);
assert.doesNotMatch(models, /switchModel|setAgentSettings|method:\s*["'](?:POST|PATCH|PUT)["']/,
  "The Agent model picker must not mutate current chat or provider defaults");
for (const endpoint of ["/api/programs", "/api/tools", "/api/tool-profiles", "/api/skills", "/api/mcp/servers"]) {
  assert.ok(capabilities.includes(endpoint), `Missing lazy catalog ${endpoint}`);
}
assert.match(capabilities, /Tools[\s\S]*Connected Services[\s\S]*Applications[\s\S]*Workflows/);
assert.match(controls, /useActionIconAnimation/);
assert.doesNotMatch(source, /from ["']lucide-react["']|<svg\b|<path\b/,
  "Agent controls must reuse the existing animated icon repository");
assert.match(pageStyles, /\.mobileAgentSelect/);
assert.match(pageStyles, /@media\(max-width:680px\)/);
const fontDeclarations = pageStyles.match(/\bfont(?:-size)?\s*:[^;}]+/g) ?? [];
assert.ok(fontDeclarations.every((declaration) =>
  /^font-size:var\(--fs-(?:sm|base|md|lg)\)$/.test(declaration)
  || declaration === "font:var(--fs-sm) var(--font-mono)"),
  `Agents typography must use the shared scale, found: ${fontDeclarations.join(", ")}`);
assert.match(primaryNav, /href:\s*"\/agents"[\s\S]*nav\.agents/);
assert.match(sender, /toolsProfile\s*!==\s*"__agent__"[\s\S]*payload\.tools_profile\s*=\s*toolsProfile/);
assert.match(route, /_mcp_server[\s\S]*"source": "mcp" if mcp_server else "builtin"/);

const rows = [
  { name: "read", group: "file", source: "builtin" },
  { name: "linear__get_issue", group: "connected", source: "mcp", server: "linear" },
  { name: "linear__save_issue", group: "connected", source: "mcp", server: "linear" },
  { name: "drawio__set_page", group: "connected", source: "mcp", server: "drawio" },
];
const grouped = groupTools(rows.filter((tool) => tool.source === "mcp"), "server");
assert.deepEqual(grouped.map((group) => [group.name, group.items.length]), [["drawio", 1], ["linear", 2]]);
console.log("agent tool configuration checks passed");
