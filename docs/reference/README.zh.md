# 概览

查参数、查命令、查配置键时来这里。本 Tab 收录 Python API、CLI 命令、配置项的完整参考，以及工程设计文档的归档。

## Python API

- [API 总览](API.zh.md) —— 核心组件一页看全：`agentic_function`、`Runtime`、providers
- [agentic_function](api/agentic-function.zh.md) —— 装饰器本身：参数、元数据、行为
- [Runtime](api/runtime.zh.md) —— `runtime.exec()` 的全部参数与语义
- [Providers](api/providers.zh.md) —— `create_runtime` 与各内置 provider runtime

## CLI 与配置

- [CLI 命令参考](cli.zh.md) —— `openprogram` 每个子命令的作用与关键参数
- [配置参考](config.zh.md) —— `config.json` 的键、`openprogram config` 的用法、环境变量汇总
- [诊断包](diagnostics.zh.md) —— `openprogram diagnostics`：支持包 zip 里有什么、脱敏掉了什么

## 专题笔记

- [Claude Code 的上下文压缩机制](claude-code-compaction.zh.md) —— 对 Claude Code compaction 行为的分析笔记

## 设计文档归档

[`design/`](design/README.zh.md) 是工程设计笔记的归档：写给开发者自己看，按子系统组织（runtime、providers、function、memory、channels、cli、ui 等），只增不改。它记录决策当时的思路，不保证与当前代码逐行一致——面向使用者的准确说明以本 Tab 其余页面和代码为准。
