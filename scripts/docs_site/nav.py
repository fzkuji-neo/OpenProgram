"""Build the left-sidebar navigation tree from the docs/ directory layout.

The tree mirrors the on-disk folder structure. Each directory becomes a group;
its title comes from that directory's README.md H1 if present, else a prettified
folder name. Within a group, README.md is pinned first, the rest sort by name.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

# Folders that are never part of the docs site.
EXCLUDE_DIRS = {"_site", "_site.tmp", "_site.old", "_static_root",
                "images", "slides"}

# Internal execution plans stay versioned in Git but are not product
# documentation. Keep this path-level list separate from EXCLUDE_DIRS so a
# similarly named directory in another product area is not hidden by accident.
EXCLUDE_PATH_PREFIXES = ("superpowers/",)

# Top-level tabs. Each top-level directory under docs/ is one tab in the top
# navbar; the sidebar only shows the current tab's tree. Order here is the
# navbar order. (dir name -> (中文 label, English label))
TABS: dict[str, tuple[str, str]] = {  # dir -> (English label, 中文 label)
    "start":        ("Get started", "开始使用"),
    "install":      ("Install", "安装"),
    "capabilities": ("Capabilities", "能力"),
    "interfaces":   ("Interfaces", "界面"),
    "models":       ("Models", "模型"),
    "integrations": ("Integrations", "集成"),
    "server":       ("Server & Ops", "服务与运维"),
    "reference":    ("Reference", "参考"),
    # Virtual tab: no docs/design/ directory — pages under reference/design/
    # (the engineering-notes archive) are routed here by tab_of(), so the
    # archive gets a first-class navbar tab without moving 130+ file pairs.
    "design":       ("Design", "设计"),
}
# Loose files directly under docs/ belong to a tab too.
ROOT_PAGE_TAB = {"README.md": "start"}
# A top-level dir not listed in TABS falls back to the reference tab, so a
# stray folder degrades to "filed under Reference" instead of vanishing.
FALLBACK_TAB = "reference"

# Display-name overrides for pages whose H1 doesn't make a good sidebar label.
ROOT_PAGE_GROUPS: dict[str, tuple[str, str]] = {
    "README.md": ("Overview", "start"),
    "capabilities/agentic-programming/philosophy.md": ("Philosophy", ""),
}

# Sidebar titles for directories that have no README.md of their own.
DIR_TITLES: dict[str, tuple[str, str]] = {  # rel dir -> (English, 中文)
    "capabilities/agentic-programming/writing-functions": ("Writing functions", "编写函数"),
    "capabilities/agentic-programming/choosing-the-next-step": ("Choosing the next step", "选择下一步"),
    "reference/design": ("Overview", "概览"),
    "reference/cli": ("CLI commands", "CLI 命令"),
}



@dataclass
class Page:
    src: Path          # absolute source path
    rel: Path          # path relative to docs/ (e.g. design/runtime/rewind.md)
    out: Path          # output path relative to _site/ (always .html)
    title: str
    is_readme: bool
    kind: str          # "md" or "html"
    i18n_key: str = ""  # if set, sidebar label switches with the UI language
    zh_src: Path | None = None   # Chinese-version source (xxx.zh.md), if any
    zh_out: Path | None = None   # Chinese-version output path, if any
    title_zh: str = ""  # Chinese sidebar label (from the .zh.md H1), if any


_H1_RE = re.compile(r"^\s{0,3}#\s+(.+?)\s*#*\s*$", re.MULTILINE)
_HTML_TITLE_RE = re.compile(r"<title>(.*?)</title>", re.IGNORECASE | re.DOTALL)


def extract_title(path: Path) -> str:
    """First H1 (md) or <title> (html); fall back to a prettified file stem."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return prettify(path.stem)
    if path.suffix == ".md":
        m = _H1_RE.search(text)
        if m:
            return m.group(1).strip()
    else:
        m = _HTML_TITLE_RE.search(text)
        if m:
            # strip a common " — OpenProgram" style suffix for nav brevity
            return re.sub(r"\s*[—·|-]\s*OpenProgram.*$", "", m.group(1).strip())
        # body-only fragment: fall back to its first <h1>
        h1 = re.search(r"<h1[^>]*>(.*?)</h1>", text, re.IGNORECASE | re.DOTALL)
        if h1:
            return re.sub(r"<[^>]+>", "", h1.group(1)).strip()
    return prettify(path.stem)


def prettify(name: str) -> str:
    name = name.replace("_", " ").replace("-", " ")
    return name.strip().title()


def is_excluded(rel: Path) -> bool:
    rel_str = rel.as_posix()
    return (
        any(part in EXCLUDE_DIRS for part in rel.parts)
        or any(rel_str.startswith(prefix) for prefix in EXCLUDE_PATH_PREFIXES)
    )


def discover(docs_root: Path) -> list[Page]:
    """All public renderable pages under docs/, excluding internal paths.

    Bilingual convention: ``xxx.md`` or ``xxx.html`` is the default (English)
    version; a sibling ``xxx.zh.md`` or ``xxx.zh.html`` is its Chinese version.
    The Chinese source does not get its own sidebar entry; it is attached to the
    default source as ``zh_src`` and reached via the language toggle.
    """
    # First pass: collect all .zh.md chinese sources, keyed by their base stem.
    zh_sources: dict[Path, Path] = {}  # base rel (xxx.md) -> zh src path
    for path in docs_root.rglob("*.zh.md"):
        rel = path.relative_to(docs_root)
        if is_excluded(rel):
            continue
        base_rel = rel.with_name(rel.name[:-len(".zh.md")] + ".md")
        zh_sources[base_rel] = path
    for path in docs_root.rglob("*.zh.html"):
        rel = path.relative_to(docs_root)
        if is_excluded(rel):
            continue
        base_rel = rel.with_name(rel.name[:-len(".zh.html")] + ".html")
        zh_sources.setdefault(base_rel, path)

    pages: list[Page] = []
    for path in sorted(docs_root.rglob("*")):
        if path.suffix not in (".md", ".html"):
            continue
        rel = path.relative_to(docs_root)
        if is_excluded(rel):
            continue
        if rel.name.endswith((".zh.md", ".zh.html")):
            continue  # chinese version is attached to its base, not a page
        out = rel.with_suffix(".html")
        rel_str = str(rel).replace("\\", "/")
        override = ROOT_PAGE_GROUPS.get(rel_str)
        title = override[0] if override else extract_title(path)
        zh_src = zh_sources.get(rel)
        zh_out = (rel.with_name(rel.stem + ".zh.html")) if zh_src else None
        title_zh = ("概览" if rel_str == "README.md" else extract_title(zh_src)) if zh_src else ""
        pages.append(
            Page(
                src=path,
                rel=rel,
                out=out,
                title=title,
                is_readme=path.stem.upper() == "README",
                kind=path.suffix.lstrip("."),
                zh_src=zh_src,
                zh_out=zh_out,
                title_zh=title_zh,
            )
        )
    return _dedupe_md_html(pages)


def _dedupe_md_html(pages: list[Page]) -> list[Page]:
    """When foo.md and foo.html coexist in the same dir, the md is the canonical
    page and the html is its visualization. Keep both, but the html output path
    is suffixed so it never overwrites the md's output."""
    by_dir_stem: dict[tuple, list[Page]] = {}
    for p in pages:
        by_dir_stem.setdefault((p.rel.parent, p.rel.stem), []).append(p)
    result: list[Page] = []
    for group in by_dir_stem.values():
        kinds = {p.kind for p in group}
        if kinds == {"md", "html"}:
            for p in group:
                if p.kind == "html":
                    p.out = p.rel.parent / f"{p.rel.stem}.viz.html"
                    if p.zh_out is not None:
                        p.zh_out = p.zh_out.with_suffix(".viz.html")
                    p.title = f"{p.title} (viz)"
                result.append(p)
        else:
            result.extend(group)
    return result


@dataclass
class Section:
    """An ordered page group, optionally nested under a design area."""
    title: str
    title_zh: str
    pages: list  # list[Page]
    area: tuple[str, str] | None = None


@dataclass
class Tab:
    key: str            # top-level dir name ("start", "models", …)
    title: str          # English (default) label
    title_zh: str
    sections: list      # list[Section] — the tab's sidebar
    landing: Path       # out path the navbar tab links to


def tab_of(p: Page) -> str:
    rel = str(p.rel).replace("\\", "/")
    if rel.startswith(ARCHIVE_PREFIX):
        return "design"
    parts = p.rel.parts
    if len(parts) == 1:
        return ROOT_PAGE_TAB.get(parts[0], FALLBACK_TAB)
    return parts[0] if parts[0] in TABS else FALLBACK_TAB


# Editorial sidebar layout: per tab, ordered sections with explicit page
# membership. (section EN title, section 中文 title, [rel paths in order]).
# Pages not listed here fall into an automatic trailing section named after
# their directory, so a new file never vanishes from the sidebar.
ARCHIVE_PREFIX = "reference/design/"
TAB_SECTIONS: dict[str, list[tuple[str, str, list[str]]]] = {
    "start": [
        ("Overview", "概览", ["README.md", "start/features.md"]),
        ("First steps", "第一步", [
            "start/GETTING_STARTED.md", "start/daily-use.md", "start/faq.md"]),
    ],
    "install": [
        ("Install", "安装", ["install/install.md"]),
        ("Maintenance", "维护", ["install/upgrade.md", "install/profiles.md"]),
    ],
    "capabilities": [
        ("Overview", "概览", ["capabilities/README.md", "capabilities/applications.md", "capabilities/framework-control.md"]),
        ("Agentic Programming", "Agentic Programming", [
            "capabilities/agentic-programming/README.md",
            "capabilities/agentic-programming/philosophy.md",
            "capabilities/agentic-programming/embedding-in-your-own-stack.md"]),
        ("Writing functions", "编写函数", [
            "capabilities/agentic-programming/writing-functions/pure-python.md",
            "capabilities/agentic-programming/writing-functions/agentic-function.md",
            "capabilities/agentic-programming/writing-functions/function-metadata.md"]),
        ("Choosing the next step", "选择下一步", [
            "capabilities/agentic-programming/choosing-the-next-step/tool-calling.md",
            "capabilities/agentic-programming/choosing-the-next-step/fixed-order-calls.md",
            "capabilities/agentic-programming/choosing-the-next-step/next-step-decision.md"]),
        ("Agentic Workflows", "Agentic Workflows", [
            "capabilities/workflows/README.md",
            "capabilities/workflows/authoring.md",
            "capabilities/workflows/reports.md",
            "capabilities/workflows/gui-agent.md",
            "capabilities/workflows/research-agent.md",
            "capabilities/workflows/wiki-agent.md"]),
        ("Memory", "记忆", ["capabilities/memory.md"]),
        ("Session goals", "会话目标", ["capabilities/goal.md"]),
        ("Agentic workflows", "Agentic 工作流", ["capabilities/agentic-workflow.md"]),
        ("Asking about OpenProgram", "询问 OpenProgram 自身",
         ["capabilities/docs-question.md"]),
        ("Security review", "安全审查", ["capabilities/security-review.md"]),
        ("Extending", "扩展", [
            "capabilities/installing-harnesses.md", "capabilities/skills.md",
            "capabilities/distill.md",
            "capabilities/plugins.md", "capabilities/mcp.md",
            "capabilities/tools.md", "capabilities/lsp.md"]),
    ],
    "interfaces": [
        ("Overview", "概览", ["interfaces/README.md"]),
        ("Surfaces", "界面", [
            "interfaces/desktop.md", "interfaces/web.md", "interfaces/tui.md",
            "interfaces/cli.md", "interfaces/acp.md"]),
    ],
    "models": [
        ("Overview", "概览", ["models/README.md", "models/providers.md"]),
        ("Configuration", "配置", [
            "models/auth.md", "models/fast-tier.md",
            "models/thinking-effort.md", "models/token-tracking.md"]),
    ],
    "integrations": [
        ("Integrations", "集成", [
            "integrations/claude-code.md", "integrations/openclaw.md",
            "integrations/channels.md"]),
    ],
    "server": [
        ("Overview", "概览", ["server/README.md"]),
        ("Operations", "运维", [
            "server/configuration.md", "server/upgrading.md",
            "server/backup.md", "server/troubleshooting.md"]),
    ],
    "reference": [
        ("Overview", "概览", ["reference/README.md"]),
        ("API", "API", [
            "reference/API.md", "reference/api/runtime.md",
            "reference/api/providers.md", "reference/api/agentic-function.md"]),
        ("CLI and configuration", "CLI 与配置", [
            "reference/cli.md", "reference/config.md",
            "reference/diagnostics.md",
            "reference/session-export.md",
            "reference/output-styles.md",
            # generated from code at build time (generate_reference.py):
            "reference/config-keys.md", "reference/provider-registry.md"]),
        ("Notes", "笔记", ["reference/claude-code-compaction.md"]),
        ("Comparisons", "对比", [
            "comparisons/ai-agent-frameworks.md",
            "comparisons/related-projects.md",
        ]),
    ],
    "design": [
        ('Overview', '总览', [
            "reference/design/README.md",
            "reference/design/framework-overview.md",
            "reference/design/repository-structure.html",
            "reference/design/implementation-status.html",
            "reference/design/framework-comparison.html",
            "reference/design/feature-matrix.html",
        ]),
        ('Runtime · Execution', '运行时 · 执行与控制', [
            "reference/design/runtime/README.md",
            "reference/design/runtime/execution/agent-call-flow.md",
            "reference/design/runtime/execution/control.html",
            "reference/design/runtime/execution/agent-action-lifecycle.html",
            "reference/design/runtime/execution/agent-worktree.md",
            "reference/design/runtime/execution/agentic-self-recursion.html",
            "reference/design/runtime/execution/agentic-self-recursion.md",
            "reference/design/runtime/execution/async-job-lifecycle.md",
            "reference/design/runtime/execution/dispatcher-split.md",
            "reference/design/runtime/execution/next-step-decision.md",
        ]),
        ('Runtime · Sessions', '运行时 · 会话与存储', [
            "reference/design/runtime/session/README.md",
            "reference/design/runtime/session/storage.md",
            "reference/design/runtime/session/operations.md",
            "reference/design/runtime/session/context.md",
            "reference/design/runtime/unified-session-context.md",
            "reference/design/runtime/additional-working-directories.md",
            "reference/design/runtime/session/comparison.md",
            "reference/design/runtime/session/distill.md",
            "reference/design/runtime/session/storage-consistency.html",
            "reference/design/runtime/session/name.md",
        ]),
        ('Runtime · DAG and collaboration', '运行时 · DAG 与协作', [
            "reference/design/runtime/dag/overview.md",
            "reference/design/runtime/agent-collaboration.md",
            "reference/design/runtime/agent-collab-architecture.html",
            "reference/design/runtime/agent-collab-comparison.html",
            "reference/design/runtime/dag/branch-collaboration.md",
            "reference/design/runtime/dag/layout.html",
            "reference/design/runtime/dag/external-program-run-node.html",
            "reference/design/runtime/dag/persistence-observability.html",
            "reference/design/runtime/dag/rendering.md",
            "reference/design/runtime/operations/branch-naming.md",
            "reference/design/runtime/operations/branch-naming.html",
            "reference/design/runtime/operations/edge-field-rename.md",
            "reference/design/runtime/operations/unify-parent-called-by.md",
        ]),
        ('Runtime · Goals and recovery', '运行时 · 目标与恢复', [
            "reference/design/runtime/goal-and-recovery.html",
            "reference/design/runtime/agent-resource-governance.html",
            "reference/design/runtime/structured-generation-recovery.html",
            "reference/design/runtime/durable-tool-results.html",
            "reference/design/runtime/operations/streaming-resume.md",
            "reference/design/runtime/operations/chat-progress-recovery.html",
            "reference/design/runtime/web-runtime-reliability.html",
            "reference/design/runtime/web-frontend-spawn.html",
        ]),
        ('Runtime · Configuration and operations', '运行时 · 配置与操作', [
            "reference/design/runtime/agent-configuration-ui.html",
            "reference/design/runtime/agent-core-configuration-ui.html",
            "reference/design/runtime/agent-tool-configuration-ui.html",
            "reference/design/runtime/agent-capability-configuration-ui.html",
            "reference/design/runtime/chat-search-settings.html",
            "reference/design/runtime/tool-toggle-management.md",
            "reference/design/runtime/operations/user-input-requests.md",
            "reference/design/runtime/operations/file-management.html",
        ]),
        ('Programs and workflows', '程序与工作流', [
            "reference/design/function/README.md",
            "reference/design/function/agentic-program.html",
            "reference/design/function/calling-unification.md",
            "reference/design/function/calling/code-call.md",
            "reference/design/runtime/application-runtime.html",
            "reference/design/runtime/programs-architecture.html",
            "reference/design/runtime/self-programmed-agentic-workflow.html",
            "reference/design/runtime/self-programming-workflow-model.html",
            "reference/design/runtime/self-programming-workflow-authoring.html",
            "reference/design/runtime/self-programming-workflow-ui.html",
            "reference/design/runtime/workflow-control-primitives.md",
            "reference/design/runtime/llm-and-agent.html",
            "reference/design/runtime/self-update.html",
        ]),
        ('Workflows · Reports', '工作流 · 报告', [
            "reference/design/runtime/report-suite.html",
            "reference/design/runtime/weekly-report.html",
            "reference/design/runtime/group-weekly-report.html",
            "reference/design/runtime/report-delivery-intent.html",
        ]),
        ('Context', '上下文', [
            "reference/design/context/README.md",
            "reference/design/context/overview.md",
            "reference/design/context/composition.md",
            "reference/design/context/compaction.md",
            "reference/design/context/compaction-diagram.html",
            "reference/design/context/occupancy-status.html",
            "reference/design/context/statistics.html",
            "reference/design/context/memory-introspection.html",
            "reference/design/context/comparison.md",
        ]),
        ('Memory', '记忆', [
            "reference/design/memory/README.md",
            "reference/design/memory/overview.md",
            "reference/design/memory/architecture.html",
            "reference/design/memory/entity-memory-proposal.md",
            "reference/design/memory/virtual-memory.md",
            "reference/design/memory/authority-handoff.md",
            "reference/design/memory/authority-landscape.html",
            "reference/design/memory/adoption.html",
            "reference/design/memory/comparison.html",
            "reference/design/memory/editor.html",
            "reference/design/memory/settings-ui.html",
            "reference/design/memory/speaker-identity.html",
            "reference/design/memory/written-marker.html",
            "reference/design/memory/written-marker.md",
        ]),
        ('Events and scheduling', '事件与调度', [
            "reference/design/proactive/README.md",
            "reference/design/proactive/event-layer.md",
            "reference/design/proactive/event-layer.html",
            "reference/design/proactive/events-and-state.md",
            "reference/design/proactive/execution-model.md",
            "reference/design/proactive/overview.md",
            "reference/design/proactive/policies-mvp.md",
            "reference/design/proactive/invariants.md",
            "reference/design/proactive/event-reference.html",
            "reference/design/proactive/framework-evolution.html",
            "reference/design/proactive/framework-evolution.md",
            "reference/design/scheduler/memory-integration.html",
        ]),
        ('UI · Foundations', '界面 · 基础', [
            "reference/design/ui/README.md",
            "reference/design/ui/app-icon.html",
            "reference/design/ui/invariants.md",
            "reference/design/ui/surface-system.md",
            "reference/design/ui/state-layer.md",
            "reference/design/ui/theme-system.html",
            "reference/design/ui/window-state.md",
            "reference/design/ui/session-tab-identity.html",
            "reference/design/ui/window-lifecycle.md",
            "reference/design/ui/web-styles.md",
            "reference/design/ui/interaction-feedback.md",
            "reference/design/ui/indicator-dots.md",
            "reference/design/ui/session-status.html",
        ]),
        ('UI · Chat and composer', '界面 · 对话与编辑器', [
            "reference/design/ui/attachment-handling.html",
            "reference/design/ui/chat-attachments.html",
            "reference/design/ui/chat-turn-visual-spec.html",
            "reference/design/ui/chat-transcript-follow.html",
            "reference/design/ui/composer-interaction-modes.md",
            "reference/design/ui/composer-local-attachment-paths.html",
            "reference/design/ui/composer-responsive-controls.html",
            "reference/design/ui/composer-tool-profile-menu.html",
            "reference/design/ui/composer-fast-control.html",
            "reference/design/ui/gui-agent.html",
            "reference/design/ui/browser-control-surfaces.html",
            "reference/design/ui/send-queue-reliability.html",
            "reference/design/ui/session-auto-rename.html",
            "reference/design/ui/slash-and-compact.html",
            "reference/design/ui/turn-occupancy.md",
            "reference/design/ui/websocket-command-lifecycle.html",
        ]),
        ('UI · Browser and tabs', '界面 · 浏览器与标签页', [
            "reference/design/ui/browser-extensions.html",
            "reference/design/ui/built-in-browser.html",
            "reference/design/ui/session-resources.html",
            "reference/design/ui/center-tabs-and-split-layout.html",
            "reference/design/ui/remote-web-access.html",
            "reference/design/ui/remote-web-access.md",
            "reference/design/ui/web-tab-home-button.html",
            "reference/design/ui/web-tab-native-bounds.html",
        ]),
        ('UI · Settings and catalog', '界面 · 设置与目录', [
            "reference/design/ui/avatar-randomization.html",
            "reference/design/ui/programs-explorer-template.html",
            "reference/design/ui/programs-source-categories.html",
            "reference/design/ui/settings-collapsible-columns.html",
        ]),
        ('UI · Workspace and sidebar', '界面 · 工作区与侧栏', [
            "reference/design/ui/integrated-terminal.html",
            "reference/design/ui/project-order.html",
            "reference/design/ui/project-location.html",
            "reference/design/ui/file-type-icons.html",
            "reference/design/ui/project-workspace.md",
            "reference/design/ui/right-sidebar-files.html",
            "reference/design/ui/sidebars-resizing.html",
        ]),
        ('CLI and TUI', '命令行与终端界面', [
            "reference/design/cli/README.md",
            "reference/design/cli/config-write-safety.md",
            "reference/design/cli/drop-run-command.md",
            "reference/design/cli/naming.md",
            "reference/design/cli/ports.md",
            "reference/design/cli/redesign.md",
            "reference/design/cli/single-port.md",
            "reference/design/cli/slash-commands-references.md",
            "reference/design/cli/slash-commands.md",
            "reference/design/cli/tui-upgrade.md",
        ]),
        ('Providers · Requests and models', '模型服务 · 请求与模型', [
            "reference/design/providers/README.md",
            "reference/design/providers/models/overview.md",
            "reference/design/providers/request-build.md",
            "reference/design/providers/custom-openai-compatible-provider.html",
            "reference/design/providers/models/fast-tier.md",
            "reference/design/providers/models/thinking-effort.md",
            "reference/design/providers/json-schema-structured-output.html",
            "reference/design/providers/network-proxy.md",
            "reference/design/providers/metadata-load-diagnostics.html",
            "reference/design/providers/bailian-model-catalog.md",
            "reference/design/usage-metering.md",
        ]),
        ('Providers · Authentication', '模型服务 · 账号与认证', [
            "reference/design/providers/auth/api-key-resolution-unification.md",
            "reference/design/providers/auth/claude-code-direct-oauth.md",
            "reference/design/providers/auth/credential-connection-unification.md",
            "reference/design/providers/auth/credential-file-hardening.html",
            "reference/design/providers/auth/credential-status-redesign.md",
            "reference/design/providers/auth/credential-validation-unification.md",
            "reference/design/providers/auth/unified-account-management.md",
            "reference/design/providers/auth/unified-auth-storage.md",
        ]),
        ('Providers · Reliability', '模型服务 · 可靠性', [
            "reference/design/providers/reliability/error-and-timeout-mechanism.html",
            "reference/design/providers/reliability/error-retry.md",
            "reference/design/providers/reliability/error-taxonomy-propagation.md",
            "reference/design/providers/reliability/llm-fault-tolerance.md",
            "reference/design/providers/record-replay.md",
            "reference/design/providers/record-replay.html",
            "reference/design/providers/responses-reasoning-replay.html",
        ]),
        ('Extensions and integrations', '扩展与集成', [
            "reference/design/integrations/README.md",
            "reference/design/integrations/editor-integration.md",
            "reference/design/integrations/extension-management.html",
            "reference/design/integrations/harness-standard.md",
            "reference/design/integrations/mcp-integration.md",
            "reference/design/integrations/mcp-server.html",
            "reference/design/integrations/skills-and-plugins.md",
            "reference/design/integrations/web-use-technical-spec.html",
            "reference/design/integrations/web-use.html",
            "reference/design/extension-gating/README.md",
            "reference/design/extension-gating/future-work.md",
            "reference/design/extension-gating/reference-comparison.md",
        ]),
        ('Channels', '消息渠道', [
            "reference/design/channels/README.md",
            "reference/design/channels/audit.md",
            "reference/design/channels/design.md",
        ]),
        ('Security and permissions', '安全与权限', [
            "reference/design/runtime/sandbox-architecture.html",
            "reference/design/runtime/system-access.html",
            "reference/design/runtime/ssrf-protection.html",
            "reference/design/security/dependency-security.html",
        ]),
        ('Distribution', '安装与分发', [
            "reference/design/distribution/installation-packaging.html",
            "reference/design/distribution/automatic-updates.html",
            "reference/design/distribution/developer-id.html",
            "reference/design/distribution/windows-support.md",
        ]),
        ('Engineering · Testing and errors', '工程 · 测试与错误处理', [
            "reference/design/testing/test-system.html",
            "reference/design/testing/windows-ci.html",
            "reference/design/error-handling.md",
        ]),
        ('Engineering · Documentation and website', '工程 · 文档与网站', [
            "reference/design/docs-site.html",
            "reference/design/site-discoverability-performance.html",
            "reference/design/site-indexnow-discovery.html",
            "reference/design/community-discoverability.html",
        ]),
        ('Supporting · Prototypes', '补充 · 交互原型', [
            "reference/design/ui/layout-density-prototype.html",
            "reference/design/ui/composer-interaction-prototype.html",
            "reference/design/ui/project-workspace-prototype.html",
            "reference/design/ui/sidebar-hierarchy-prototype.html",
            "reference/design/runtime/dag/live-layout.html",
        ]),
        ('Supporting · Implementation records', '补充 · 实施记录', [
            "reference/design/repository-structure-implementation.html",
            "reference/design/site-indexnow-implementation.html",
            "reference/design/documentation-gaps.md",
            "reference/design/engineering-backlog.md",
            "reference/design/ui/unification-work.md",
            "reference/design/ui/resource-panel-preview-plan.html",
            "reference/design/distribution/implementation-plan.md",
            "reference/design/integrations/web-use-implementation.html",
            "reference/design/extension-gating/implementation.md",
            "reference/design/plans/credential-connection-unification.md",
            "reference/design/plans/mcp-server-implementation.md",
            "reference/design/plans/cache-control-passthrough.md",
            "reference/design/plans/proactive-implementation.md",
        ]),
        ('Supporting · Research', '补充 · 研究材料', [
            "reference/design/proactive/_research_archive/evaluation.md",
            "reference/design/proactive/_research_archive/replay.md",
            "reference/design/proactive/_research_archive/threat-model.md",
        ]),
    ],
}


# Top-level design areas. The section lists below are the only source of
# hierarchy/order; flat page sequences remain available to breadcrumbs and
# previous/next navigation. Overview is a direct group, not a redundant wrapper.
DESIGN_AREAS = [
    ("Architecture", "架构总览", ["Overview"]),
    ("Agents and workflows", "Agent 与工作流", [
        "Runtime · Execution", "Runtime · Sessions", "Runtime · DAG and collaboration",
        "Runtime · Goals and recovery", "Runtime · Configuration and operations",
        "Programs and workflows", "Workflows · Reports", "Events and scheduling",
    ]),
    ("Context and memory", "上下文与记忆", ["Context", "Memory"]),
    ("Interfaces", "界面与交互", [
        "UI · Foundations", "UI · Chat and composer", "UI · Browser and tabs",
        "UI · Settings and catalog", "UI · Workspace and sidebar", "CLI and TUI",
    ]),
    ("Models and connections", "模型与外部接入", [
        "Providers · Requests and models", "Providers · Authentication",
        "Providers · Reliability", "Extensions and integrations", "Channels",
    ]),
    ("Security and engineering", "安全与工程", [
        "Security and permissions", "Distribution", "Engineering · Testing and errors",
        "Engineering · Documentation and website",
    ]),
    ("Supporting material", "补充材料", [
        "Supporting · Prototypes", "Supporting · Implementation records", "Supporting · Research",
    ]),
]


# Explicit sidebar order for product pages (rel path or rel dir -> rank).
# Tutorial docs must read top-to-bottom; anything unlisted sorts after these,
# alphabetically (which is fine for the design-notes archive).
PAGE_ORDER: dict[str, int] = {
    "reference/design/runtime/report-delivery-intent.html": 1007,
    "README.md": 0,
    "start/GETTING_STARTED.md": 1,
    "start/daily-use.md": 2,
    "start/features.md": 3,
    "start/faq.md": 4,
    "install/install.md": 0,
    "install/upgrade.md": 1,
    "install/profiles.md": 2,
    "capabilities/README.md": 0,
    "capabilities/applications.md": 1,
    "capabilities/framework-control.md": 2,
    "capabilities/agentic-programming": 1,
    "capabilities/workflows": 2,
    "capabilities/installing-harnesses.md": 3,
    "capabilities/skills.md": 4,
    "capabilities/distill.md": 5,
    "capabilities/commit-push-pr.md": 6,
    "capabilities/plugins.md": 7,
    "capabilities/mcp.md": 8,
    "capabilities/tools.md": 9,
    "capabilities/permissions.md": 10,
    "capabilities/lsp.md": 11,
    "capabilities/memory.md": 12,
    "capabilities/goal.md": 12,
    "capabilities/agentic-workflow.md": 13,
    "capabilities/docs-question.md": 13,
    "capabilities/security-review.md": 14,
    "capabilities/agentic-programming/philosophy.md": 1,
    "capabilities/agentic-programming/embedding-in-your-own-stack.md": 2,
    "capabilities/agentic-programming/writing-functions": 3,
    "capabilities/agentic-programming/choosing-the-next-step": 4,
    "capabilities/workflows/reports.md": 0,
    "capabilities/workflows/gui-agent.md": 1,
    "capabilities/workflows/research-agent.md": 2,
    "capabilities/workflows/wiki-agent.md": 3,
    "interfaces/README.md": 0,
    "interfaces/desktop.md": 1,
    "interfaces/web.md": 2,
    "interfaces/tui.md": 3,
    "interfaces/cli.md": 4,
    "interfaces/acp.md": 5,
    "models/README.md": 0,
    "models/providers.md": 1,
    "models/auth.md": 2,
    "models/fast-tier.md": 3,
    "models/thinking-effort.md": 4,
    "models/token-tracking.md": 5,
    "integrations/claude-code.md": 0,
    "integrations/openclaw.md": 1,
    "integrations/channels.md": 2,
    "server/README.md": 0,
    "server/configuration.md": 1,
    "server/upgrading.md": 2,
    "server/backup.md": 3,
    "server/troubleshooting.md": 4,
    "reference/README.md": 0,
    "reference/API.md": 1,
    "reference/api": 2,
    "reference/cli.md": 3,
    "reference/config.md": 4,
    "reference/diagnostics.md": 5,
    "reference/session-export.md": 6,
    "reference/output-styles.md": 7,
    "reference/claude-code-compaction.md": 6,
    "comparisons/ai-agent-frameworks.md": 8,
    "comparisons/related-projects.md": 9,
    "reference/design": 900,  # design-notes archive always last
    "reference/design/implementation-status.html": 1,
    "reference/design/repository-structure.html": 2,
    "reference/design/repository-structure-implementation.html": 3,
    "reference/design/docs-site.html": 4,
    # The context notes read in order: the layer, then compaction, then how the
    # blocks are composed and compared, then the two rendered companions.
    "reference/design/context/README.md": 0,
    "reference/design/context/overview.md": 1,
    "reference/design/context/compaction.md": 2,
    "reference/design/context/composition.md": 3,
    "reference/design/context/comparison.md": 4,
    "reference/design/context/compaction-diagram.html": 5,
    "reference/design/context/memory-introspection.html": 6,
    # The memory notes read in order: what it is, how it works, how others do it.
    "reference/design/memory/README.md": 0,
    "reference/design/memory/overview.md": 1,
    "reference/design/memory/written-marker.md": 2,
    "reference/design/memory/written-marker.html": 3,
    "reference/design/memory/architecture.html": 4,
    "reference/design/memory/comparison.html": 5,
    "reference/design/memory/adoption.html": 6,
    # Within the design archive everything defaults to 999 (alphabetical).
    # >999 pins canonical security designs to the end of their section.
    "reference/design/runtime/sandbox-architecture.html": 1000,
    "reference/design/runtime/system-access.html": 1002,
    # Same treatment for agent collaboration: the design note first, then its
    # two rendered companions (our tool surface, then the eight reference
    # implementations compared).
    "reference/design/runtime/agent-collaboration.md": 1002,
    "reference/design/runtime/agent-collab-architecture.html": 1003,
    "reference/design/runtime/agent-collab-comparison.html": 1004,
    # Unified lifecycle and debugger control contract for all runtime owners.
    "reference/design/runtime/execution/control.html": 1005,
    "reference/design/runtime/durable-tool-results.html": 1005,
    "reference/design/runtime/goal-and-recovery.html": 1006,
    # Center tabs: authoritative tab/group/view state and split-layout design.
    "reference/design/ui/center-tabs-and-split-layout.html": 1009,
    "reference/design/ui/built-in-browser.html": 1010,
    "reference/design/ui/session-resources.html": 1010,
    "reference/design/ui/session-auto-rename.html": 1011,
    "reference/design/ui/browser-extensions.html": 1011,
    "reference/design/ui/integrated-terminal.html": 1012,
    "reference/design/ui/composer-local-attachment-paths.html": 1013,
    "reference/design/ui/composer-responsive-controls.html": 1014,
    "reference/design/ui/composer-tool-profile-menu.html": 1015,
    "reference/design/ui/composer-fast-control.html": 1020,
    "reference/design/ui/programs-source-categories.html": 1016,
    "reference/design/ui/theme-system.html": 1017,
    "reference/design/ui/settings-collapsible-columns.html": 1018,
    # Chat attachments: the delivery note first, its rendered companion
    # next, then the four-layer note on how attachments look and behave
    # inside the chat itself.
    "reference/design/ui/attachment-handling.html": 1019,
    "reference/design/ui/chat-attachments.html": 1021,
    "reference/design/ui/file-type-icons.html": 1022,
    "reference/design/ui/browser-control-surfaces.html": 1023,
    # The three whole-framework pages sit together at the end of the design
    # root: first how one conversation runs inside us, then how we compare to
    # the reference frameworks by design axis, then by feature list.
    "reference/design/framework-overview.md": 1020,
    "reference/design/framework-comparison.html": 1021,
    "reference/design/runtime/application-runtime.html": 1023,
    "reference/design/feature-matrix.html": 1022,
    # Distribution: authoritative conceptual design followed by its separate
    # implementation ledger.
    "reference/design/distribution/installation-packaging.html": 1035,
    "reference/design/distribution/automatic-updates.html": 1036,
    "reference/design/distribution/implementation-plan.md": 1037,
    "reference/design/distribution/windows-support.md": 1038,
    # Integrations: keep the current Web Use and MCP server HTML designs
    # together after the alphabetical integration notes.
    "reference/design/integrations/web-use.html": 1039,
    "reference/design/integrations/mcp-server.html": 1040,

    # Test architecture and execution contracts.
    "reference/design/testing/test-system.html": 1050,
    # Agentic program: the four-layer note that unifies tools, skills and
    # agentic functions as one concept sits after the calling-framework
    # note it builds on.
    "reference/design/function/agentic-program.html": 1030,
}


def _order_key(rel: Path) -> int:
    return PAGE_ORDER.get(str(rel).replace("\\", "/"), 999)


def build_tabs(docs_root: Path, pages: list[Page]) -> list[Tab]:
    """Split pages into ordered editorial sections with a discoverable fallback."""
    tabs: list[Tab] = []
    for key, (en, zh) in TABS.items():
        tab_pages = [p for p in pages if tab_of(p) == key]
        if not tab_pages:
            continue
        rel_str = lambda p: str(p.rel).replace("\\", "/")
        by_rel = {rel_str(p): p for p in tab_pages}
        placed: set[str] = set()

        sections: list[Section] = []
        for sec_en, sec_zh, paths in TAB_SECTIONS.get(key, []):
            sec_pages = [by_rel[r] for r in paths if r in by_rel]
            placed.update(r for r in paths if r in by_rel)
            if sec_pages:
                sections.append(Section(title=sec_en, title_zh=sec_zh, pages=sec_pages))

        # Anything unlisted lands in an automatic section named after its
        # directory, so new files never vanish from the sidebar. Design pages use editorial groups above; unclassified new pages
        # remain visible rather than disappearing.
        leftovers = [p for p in tab_pages if rel_str(p) not in placed]
        auto_base = Path(ARCHIVE_PREFIX.rstrip("/")) if key == "design" else Path(key)
        fallback_sections = _auto_sections(docs_root, leftovers, base_dir=auto_base)
        if key == "design":
            for section in fallback_sections:
                section.title = "Uncategorized · " + section.title
                section.title_zh = "待分类 · " + (section.title_zh or section.title)
        sections.extend(fallback_sections)

        if key == "design":
            by_title = {section.title: section for section in sections}
            ordered = []
            for area_en, area_zh, names in DESIGN_AREAS:
                for name in names:
                    section = by_title.pop(name, None)
                    if section is not None:
                        section.area = (area_en, area_zh)
                        ordered.append(section)
            for section in by_title.values():
                section.area = ("Uncategorized", "待分类")
                ordered.append(section)
            sections = ordered

        landing = sections[0].pages[0].out if sections and sections[0].pages else Path("index.html")
        tabs.append(Tab(key=key, title=en, title_zh=zh, sections=sections,
                        landing=landing))
    return tabs


def _dir_title(docs_root: Path, rel_dir: Path) -> tuple[str, str]:
    override = DIR_TITLES.get(str(rel_dir).replace("\\", "/"))
    if override:
        return override
    readme = docs_root / rel_dir / "README.md"
    readme_zh = docs_root / rel_dir / "README.zh.md"
    title = extract_title(readme) if readme.exists() else prettify(rel_dir.name)
    title_zh = extract_title(readme_zh) if readme_zh.exists() else ""
    return title, title_zh


def _auto_sections(docs_root: Path, pages: list[Page], base_dir: Path) -> list[Section]:
    """Group pages into one flat section per directory, ordered by path.
    Nested dirs become their own sections titled 'Parent · Child'."""
    by_dir: dict[Path, list[Page]] = {}
    for p in pages:
        by_dir.setdefault(p.rel.parent, []).append(p)

    sections: list[Section] = []
    for rel_dir in sorted(by_dir, key=lambda d: str(d)):
        sec_pages = sorted(
            by_dir[rel_dir],
            key=lambda p: (_order_key(p.rel), not p.is_readme, p.title.lower()))
        # section title: the dir chain below base_dir, joined for nested dirs
        try:
            chain = rel_dir.relative_to(base_dir).parts
        except ValueError:
            chain = rel_dir.parts
        if not chain:
            title, title_zh = _dir_title(docs_root, rel_dir)
        else:
            parts_en, parts_zh = [], []
            for i in range(len(chain)):
                en, zh = _dir_title(docs_root, base_dir.joinpath(*chain[:i + 1]))
                parts_en.append(en)
                parts_zh.append(zh or en)
            title = " · ".join(parts_en)
            title_zh = " · ".join(parts_zh)
        sections.append(Section(title=title, title_zh=title_zh, pages=sec_pages))
    return sections
