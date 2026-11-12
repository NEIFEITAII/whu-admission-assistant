# 武汉大学招生问答智能体（小程序原型）

面向湖北考生的招生问答智能体原型：既能回答招生政策类问题，也能回答分数、位次、招生计划等数字类问题。前端为 Taro 4 + React 18 + TypeScript，同时构建微信小程序与 H5。

## 能力范围

| 能力 | 示例问题 | 实现方式 |
|---|---|---|
| 招生政策问答 | 国家专项要满足什么条件？转专业怎么申请？ | 知识库检索增强问答 |
| 分数位次查询 | 2024 年物理类 647 分是多少位次？ | 自然语言转 SQL，强制查库 |
| 招生计划查询 | 2024、2025 年在湖北各招多少人？ | 分组聚合查询 |
| 录取分析 | 近三年物理类最低分趋势 | 多步推理 + SQL |
| 招生快报 | 生成某年度招生情况快报 | 聚合查询 + 结构化输出 |
| 多轮追问 | 那 2023 年呢？ | 会话上下文复用 |

数字类问题一律通过 SQL 查询数据库，不依赖语义检索生成数值，避免"看起来合理但实际错误"的答案。

## 目录结构

```
miniapp/                    小程序源码（Taro 项目）
  src/
    pages/                  对话页、题库页、历史页、我的
    components/             消息气泡、图表、品牌标识等
    services/dbgpt.ts       与问答服务通信（SSE 流式）
    services/demo.ts        离线演示样例
    utils/routeMode.ts      问题类型识别与引擎选择
    utils/answerFormat.ts   答案清洗与表格/图表格式化
    store/chatStore.ts      会话与消息状态
    **/__tests__/           前端单元测试（Vitest）
backend/                    后端部署包（建表脚本、数据、MCP 服务、配置模板）
docs/
  whu_admission_system_design.md/.docx    系统总体设计与详细设计
  assets/architecture.png                  系统架构图
tests/
  business/                 业务测试（24 场景 / 29 轮）
  backend-reference/        后端与 MCP 单元测试（在对应后端仓库内运行）
```

## 快速开始

### 方式一：离线演示（无需任何后端）

```bash
cd miniapp
npm install
npm run build:h5
npx serve dist-h5       # 或任意静态服务器
```

打开页面即可对话。未连接问答服务时，前端会自动切换到**离线演示模式**，用内置样例逐字输出，覆盖政策问答、分数位次、招生计划、快报四类问题；样例答案末尾会标注"离线演示数据"，不会与真实查询结果混淆。

微信小程序端：

```bash
cd miniapp
npm run build:weapp
```

用微信开发者工具打开 `miniapp/` 目录，`miniprogramRoot` 已指向 `dist/`。首次导入时请把 `project.config.json` 中的 `appid` 换成你自己的小程序 AppID（或使用测试号），否则无法预览。

### 方式二：连接真实后端

前端默认请求 `http://127.0.0.1:5670`，可在"我的"页面修改服务地址。后端由三部分组成：

1. PostgreSQL 招生数据库（分数位次、招生计划、专业录取明细等表）；
2. MCP 只读 SQL 服务，向模型暴露表结构与查询能力；
3. DB-GPT 问答服务，提供知识库问答、SQL 问答与多步推理三类接口。

三者的建表脚本、数据、MCP 服务源码与配置模板都在 [`backend/`](backend/README.md) 中，按该目录的 README 即可在另一台机器复现。该包不含任何密钥与数据库口令，均通过环境变量注入。

三者启动后，前端会自动改用真实数据，离线样例不再触发。

## 测试

前端单元测试（路由判断、答案格式化、会话管理、流式收尾）：

```bash
cd miniapp
npm run test:run
```

业务测试（直接调用真实服务接口，覆盖 6 类能力）：

```bash
# 静态校验，不需要服务
python tests/business/run_business_tests.py --validate-only

# 冒烟（8 个核心场景）
python tests/business/run_business_tests.py --suite smoke --base-url http://127.0.0.1:5670

# 全量 24 场景 / 29 轮
python tests/business/run_business_tests.py --suite full --base-url http://127.0.0.1:5670
```

每次运行在 `tests/business/results/<时间戳>/` 下生成 `records.jsonl`（逐轮原始记录）、`summary.json`、`report.md`。最近一次全量结果：24 场景全部通过，平均 9.03 秒。

后端与 MCP 的单元测试位于 `tests/backend-reference/`，需放回对应后端仓库运行（依赖其内部模块）。

## 设计文档

- [系统总体设计与详细设计（Markdown）](docs/whu_admission_system_design.md)
- [系统总体设计与详细设计（Word）](docs/whu_admission_system_design.docx)

文档包含总体架构、11 个功能模块及其功能点、代码实现位置、数据库表结构与查询口径、单元测试设计与业务测试设计。

## 说明

- 仓库不含后端源码、数据库导出与任何密钥；涉及 API Key、数据库口令的配置均在部署环境本地维护。
- 内置的招生数据来源于公开招生信息，仅用于功能演示，不作为报考依据。
