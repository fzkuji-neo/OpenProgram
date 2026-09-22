<div id="outbound-network-proxy"></div>

# 出站网络代理

Provider HTTP 流量涉及两项独立问题：httpx 环境代理诊断，以及受管客户端的出站安全策略。受管客户端通过 `openprogram.security.safe_http` 构建，不使用 `http_proxy.py` 的 mount 映射。执行策略的代理属于 `OutboundSecurityConfig.policy_proxy`，因此 URL 策略和代理路由会一起评估。面向产品用户的文档位于 `docs/server/configuration.md`。

<div id="1-why-one-resolver"></div>

## 1. 统一解析器的原因

实现区分以下出站路径：

| 路径 | 使用方 | 未使用共享解析器时的代理语义 |
|---|---|---|
| 受管客户端（`providers/utils/http_client.py`） | provider SDK 与流式路径 | 使用 `safe_http` 和特定调用方的 URL 策略。在 `OutboundSecurityConfig.policy_proxy` 中显式配置策略代理；客户端不启用 `get_proxy_mounts()` 或非受管代理环境状态。 |
| SDK / 临时原始 httpx | OpenAI 兼容聊天（`openai_completions` / `openai_responses` 内的 openai SDK）、OAuth 流程、token 刷新、“测试 provider”按钮 | 完整 httpx 环境语义：小写变量优先于大写，遵循 `ALL_PROXY` 和 `NO_PROXY`。 |
| CLI 子进程 | claude_code, codex CLI, gemini CLI | 继承 shell 环境；外部 CLI 自行处理代理。 |

受管路径有意采用比普通 httpx 客户端更严格的 URL 和凭证策略。因此，provider 请求不得静默继承非受管进程代理：调用方应使用受管安全配置，或使用作用范围明确的普通客户端，并在调用位置记录其 httpx 环境语义。

SOCKS 代理会直接暴露这种差异：shell 设置 `ALL_PROXY=socks5://127.0.0.1:7891` 后，所有通过 API 请求的 provider 都因 “Using SOCKS proxy, but the 'socksio' package is not installed” 而崩溃，而通过 CLI 调用的 provider 仍可工作。

<div id="2-how-openclaw-does-it"></div>

## 2. OpenClaw 的处理方式

来源： `references/openclaw/src/infra/net/proxy-env.ts`, `proxy-fetch.ts`,
`src/infra/net/proxy/`, and https://docs.openclaw.ai/cli/proxy/.

- **统一环境解析器**（`proxy-env.ts`）刻意复现 undici `EnvHttpProxyAgent` 语义：小写变量优先于大写；HTTPS 请求优先使用 `https_proxy`，随后回退到 `http_proxy`；`ALL_PROXY` 作为显式传入的回退。完整的 `NO_PROXY` 匹配器检查每次代理决策，支持逗号/空白分隔、不区分大小写、`*`、前导点、`*.`、子域后缀、可选 `:port`、方括号 IPv6，以及自定义 IPv4-CIDR 扩展。由于 undici 不导出匹配器，此实现需与 undici 保持同步。
- **统一显式覆盖**：`--proxy-url` 参数 / `proxy.proxyUrl` 配置 / `OPENCLAW_PROXY_URL` 环境变量，可选 `--proxy-ca-file`。以包装 undici `ProxyAgent` 的 `makeProxyFetch(proxyUrl)` 实现，并管理代理生命周期，包括验证、TLS 选项和活动状态跟踪。
- Provider HTTP 辅助函数统一通过这些函数请求；SSRF 防护（`fetch-guard.ts`）也组合使用同一个 `matchesNoProxy`。

OpenProgram 采用标准环境变量具有统一且文档化解释这一诊断特性，同时在受管 provider 路径增加独立的策略代理边界。OpenClaw 还提供代理生命周期验证与 SSRF 检查，本设计不需要这些机制。

<div id="3-resolution-order"></div>

## 3. 解析顺序

1. `OPENPROGRAM_PROXY_URL`：显式第一方覆盖，由诊断辅助函数及明确使用环境代理映射的调用方使用。它不是受管客户端的隐式覆盖。
2. 由 httpx 自带的 `get_environment_proxies()` 解析标准环境变量：`http_proxy`/`HTTP_PROXY`、`https_proxy`/`HTTPS_PROXY`、`all_proxy`/`ALL_PROXY`、`no_proxy`/`NO_PROXY`。直接使用 httpx 解析器而不重写，使诊断调用方获得相同解析行为。注意它委托 urllib 的 `getproxies()`，因此在 macOS/Windows 未设置环境变量时，会使用操作系统代理设置，与其他 Python 进程一致。
3. 受管 provider 客户端不将环境解析结果作为安全策略的隐式覆盖。若受管请求必须使用代理，应在 `OutboundSecurityConfig.policy_proxy` 中声明；策略层随后在建立连接前验证代理与目标的关系。

<div id="4-mechanics"></div>

## 4. 机制

- `providers/utils/http_proxy.py` 暴露 `get_proxy_mounts()`，用于诊断环境代理映射和 `OPENPROGRAM_PROXY_URL` 覆盖。受管 provider 客户端不使用该映射；rescue 命令用它报告已配置代理状态。
- `providers/utils/http_client.py::build_async_client` 委托 `safe_async_client` 或 `configured_safe_async_client`。受管客户端应用注册调用方的 URL 策略、有界超时和 socket 加固。配置策略代理后，`safe_http` 创建能感知策略决策的代理传输，并在派发前从请求中移除代理凭证。
- OpenAI、Anthropic 和 Google SDK 调用方在 `openprogram/security/safe_http.py` 中以注入传输的方式注册。共享客户端生命周期仍显式管理，不通过传入 `http_proxy.py` 中的 `mounts=` 实现。
- 一次性原始 httpx 客户端（OAuth 流程、token 刷新、marketplace）有意使用普通 `httpx.AsyncClient()`：其环境语义天然一致，也不需要流式加固。`OPENPROGRAM_PROXY_URL` 不适用于这些客户端，这是接受的限制，而非遗漏。
- 订阅模型列表使用 `safe_client("provider.fixed_api")`，因此遵循 `OutboundSecurityConfig.policy_proxy`，并有意忽略环境与操作系统代理设置。
- 选择处理 SOCKS 环境配置的普通 httpx 调用方必须提供对应的 `httpx[socks]` 依赖；受管客户端不会从环境中的 `ALL_PROXY` 推导该依赖。
- `openprogram rescue` 包含代理探测：报告已解析的代理配置；若配置 SOCKS 代理但缺少 socksio，则报告失败并给出明确修复方法。
- 测试套件与代理隔离：`tests/conftest.py` 清除代理环境变量，并将 urllib 的操作系统设置回退限制为仅使用环境变量，避免开发者的 Clash/系统代理接管集成测试的 localhost 请求。线上冒烟测试通过 `OPENPROGRAM_TEST_LIVE=1 pytest -m slow` 重新启用真实网络。

<div id="5-deliberately-not-built"></div>

## 5. 有意不实现

- `proxy.url` 配置项 / CLI 参数（OpenClaw 提供此功能）：环境变量已满足当前用户需求，覆盖变量以较低成本处理约 90% 的情况。出现按 profile 配置代理的需求时再添加配置项。
- 代理验证 / 生命周期管理（OpenClaw 的受管代理）及 `--proxy-ca-file`：使用 TLS 拦截的企业代理已经可以通过 httpx 标准 `SSL_CERT_FILE`/`REQUESTS_CA_BUNDLE` 处理（`trust_env=True`）工作。
- 与代理决策绑定的 SSRF 防护：OpenProgram 是本地工具，不是托管网关。

<div id="6-invariants"></div>

## 6. 不变式

1. 所有新增 provider HTTP 代码必须通过 `build_async_client` / `get_shared_async_client` 及已注册的 `safe_http` 调用方取得客户端；不得使用手工构造的代理 kwargs 创建受管客户端。
2. 受管请求不得用 `get_proxy_mounts()` 替代 `OutboundSecurityConfig.policy_proxy`。
3. `get_proxy_mounts()` 仍是环境解析诊断工具。若 httpx 移动 `get_environment_proxies`，应使该辅助函数的诊断输出与 httpx 一致，不将其视为受管传输契约。
4. `tests/component/security/test_http_proxy.py` 固定诊断解析规则，并验证非受管环境代理不会启用受管 provider 客户端的代理。
