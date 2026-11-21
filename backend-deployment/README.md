# 本机后端部署源码

此目录保存招生数据库建表与公开种子数据、MCP 服务、启动脚本，以及 Qwen 配置模板。
当前整合使用 qwen3.8-flash-next。DB-GPT 监听 15670，GraphRAG 监听 8090，
MCP 监听 8765，本机招生 PostgreSQL 实例监听 15435。

## 配套仓库

- 前端与部署源码在 https://github.com/NorthSeven877/whu-admission-assistant/tree/codex/whu-qwen-graphrag
- GraphRAG 在 https://github.com/NorthSeven877/whu-admissions-graphrag/tree/codex/whu-qwen-graphrag
- DB-GPT 定制代码在 https://github.com/NorthSeven877/DB-GPT/tree/codex/whu-qwen-graphrag

三个仓库需放在同一级目录。GraphRAG 所需语料放在同级 doc 目录，
按 GraphRAG 仓库说明建立索引。数据库数据量为 6 张表、5579 行。

## 配置与启动

已有部署可继续使用原部署包中的 scripts/start_local.ps1。
本目录中的启动脚本使用本目录下的 .runtime 保存本地运行配置与数据库实例。
首次使用此副本时需先准备 PostgreSQL 实例，初始化 .runtime/postgres，
设置为仅监听 127.0.0.1:15435，创建 admission_agent 库，导入 sql/schema.sql
和 sql/seed.sql，并为 admission_reader 授予只读权限。

在 .runtime/mcp-venv 中安装 requirements.txt，在 DB-GPT/.venv 中按其官方
文档安装 DB-GPT，并额外安装 jieba==0.42.1 与 rank-bm25==0.2.2。
把 config/whu-qwen.toml 复制到 DB-GPT/configs/whu-qwen.toml。
复制两个 .env.example 模板到 .runtime/db-mcp.env 和 .runtime/qwen.env，
填入本机数据库口令、模型密钥和本地加密密钥。PostgreSQL 的 pg_ctl.exe 需在 PATH 中。

DB-GPT 中需注册名为 admission_agent 的 PostgreSQL 数据源和 whu_admission
知识空间。环境变量、数据库口令和模型密钥保存在本机配置中。
当前内网模型配置采用 verify_ssl=false，可在 configs/whu-qwen.toml 中调整。

完成初始化后，在 PowerShell 执行本目录的 scripts/start_local.ps1。
前端在 miniapp 目录运行 npm.cmd run dev:h5。
