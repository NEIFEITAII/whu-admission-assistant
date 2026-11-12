# 武汉大学招生问答智能体 — 后端部署包

本包用于在另一台机器上复现招生问答智能体的后端。前端仓库只包含小程序与离线演示，真实问答需要这里的三部分服务。

## 后端组成

| 组件 | 作用 | 本包提供 |
|---|---|---|
| PostgreSQL 数据库 `admission_agent` | 存放分数位次、招生计划、专业组投档线、分专业录取明细 | 建表脚本 + 全量公开数据 |
| MCP 只读 SQL 服务 | 向模型暴露"查表 / 看字段 / 跑 SQL"，只允许 SELECT | 服务源码 |
| DB-GPT 问答服务 | 理解问题、生成 SQL、组织答案 | 配置模板 + 接入说明 |

大模型（DeepSeek）为外部依赖，需要自己的 API Key，不包含在本包内。

## 目录

```
sql/schema.sql          建表 + 索引
sql/seed.sql            数据（6 张表，约 5500 行公开招生数据）
mcp/db_mcp_server.py    只读 SQL 的 MCP 服务（SSE 协议）
config/dbgpt.toml.example  DB-GPT 配置模板
config/.env.example     环境变量样例
scripts/init_db.ps1     一键建库导数据（Windows PowerShell）
scripts/start_mcp.ps1   启动 MCP 服务
scripts/start_dbgpt.ps1 启动 DB-GPT
verify.py               自检：连接数据库并核对各表行数
requirements.txt        Python 依赖
```

## 部署步骤

### 1. 准备 PostgreSQL

安装 PostgreSQL 14 以上版本，创建空库：

```sql
CREATE DATABASE admission_agent;
```

然后导入结构与会数据（PowerShell）：

```powershell
$env:PGPASSWORD="你的postgres密码"
psql -h 127.0.0.1 -U postgres -d admission_agent -f sql/schema.sql
psql -h 127.0.0.1 -U postgres -d admission_agent -f sql/seed.sql
```

或直接执行 `scripts/init_db.ps1`（脚本会读取 `$env:PGPASSWORD`）。

导入完成后自检：

```powershell
python verify.py
```

预期输出各表行数：

```
hubei_score_ranks     4442
hubei_major_admissions 482
whu_group_admissions    78
whu_major_records      515
whu_school_summary      54
whu_data_coverage        8
```

### 2. 启动 MCP 只读服务

```powershell
pip install -r requirements.txt
$env:DB_MCP_PG_PASSWORD="你的postgres密码"
python mcp/db_mcp_server.py
```

默认监听 `127.0.0.1:8765`，SSE 路径 `/sse`，对外提供三个工具：`list_tables`、`describe_table`、`run_sql`。

写操作会被拒绝，且在拒绝时不建立数据库连接。

### 3. 部署 DB-GPT

DB-GPT 是开源框架，需按其官方文档安装（Python 3.10+，建议独立虚拟环境）：

```powershell
git clone https://github.com/eosphoros-ai/DB-GPT.git
cd DB-GPT
python -m venv .venv
.venv\Scripts\pip install -e ".[default]"
```

把本包的 `config/dbgpt.toml.example` 复制到 `DB-GPT/configs/`，并填写：

- `api_key`：你的 DeepSeek API Key
- 数据库连接：指向本机 `admission_agent` 库
- MCP 服务地址：`http://127.0.0.1:8765/sse`

启动：

```powershell
.venv\Scripts\dbgpt.exe start webserver --config configs/dbgpt-proxy-deepseek.toml
```

模型加载约 100 秒，之后监听 `0.0.0.0:5670`。

### 4. 连接前端

小程序默认请求 `http://127.0.0.1:5670`，在"我的"页面可修改服务地址。三者都启动后，前端自动使用真实数据，不再触发离线演示。

## 数据说明

- 数据覆盖 2018–2026 年湖北招生相关信息，来源为公开招生资料。
- `whu_data_coverage` 表记录每个年份的数据覆盖范围，回答"有没有某年数据"时应先查此表。
- 2026 年只有专业组投档线，没有分专业明细，也没有 2026 年一分一段表。
- 分数与位次必须来自同一行记录，不能分别取最小值后拼接。

## 已知限制

- 知识库问答依赖的招生问答文档（约 87 个问答）未包含在本包内，需自行放入 DB-GPT 知识空间，否则政策类问题会返回"知识库未包含"。
- 本包不含任何密钥，所有口令与 API Key 均通过环境变量或本地配置注入。
- 若只想快速演示前端效果，不必部署本包：前端未连接后端时会自动使用内置样例。
