# 自编程 Workflow

OpenProgram 的聊天 Agent 可以为你编写可复用的 Workflow。当任务需要稳定的多阶段结构、会被反复使用或需要可审阅的版本历史时，才值得写成 Workflow。Agent 能直接完成的一次性任务不需要。

## Agent 如何编写

没有专门的编写工具。Agent 使用普通的文件工具和命令行：

1. 把 `~/.openprogram/workflows/<name>/` 建成 Git 仓库并写好包：角色、函数、`PROGRAM_ENTRIES`、`README.md` 和行为测试。
2. 运行 `openprogram workflows check ~/.openprogram/workflows/<name>`。检查会导入包、在操作系统沙箱中运行测试，通过后提交。
3. 失败时读报告、修改包，然后再次检查。

运行中的 worker 会在几秒内加载已提交的 Workflow，它的入口随即作为工具出现在所有聊天和 Programs 页面中，无需重启。修改 Workflow 也一样：改文件，再检查。早期版本保留在 Workflow 的 Git 历史中。

## 查找和运行 Workflow

```bash
openprogram workflows list
```

列出每个 Workflow 及其状态：已加载、加载失败或暂不可调用（例如有未提交改动）。在聊天中，每个入口都是 Agent 可以像其他工具一样调用的工具。Programs 页面显示同样的 Workflow，并为每个入口打开参数表单。

## 自己编写

包结构、角色与 Context 规则、测试工具和检查命令见[编写和检查 Workflow](workflows/authoring.zh.md)。

对于公开一组 agentic function、而不是单个 Workflow 包的可安装仓库，使用独立的[harness 安装合同](installing-harnesses.zh.md)。
