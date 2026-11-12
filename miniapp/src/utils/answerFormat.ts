// DB-GPT 返回内容净化：
// 1. 剥离模型思考链标签（<think_never_used...>...</think_never_used...> 等）
// 2. 将 DB-GPT Web 私有的 <chart-view> 标签转为小程序可渲染的 Markdown 表格

const COLUMN_NAME_MAP: Record<string, string> = {
  year: '年份',
  province: '省份',
  subject_type: '科类',
  subject: '科类',
  batch: '批次',
  category: '类型',
  data_level: '层次',
  school_name: '学校',
  major_name: '专业名称',
  major_group: '专业组',
  group_code: '专业组代码',
  major_code: '专业代码',
  min_score: '最低分',
  lowest_score: '最低分',
  score: '分数',
  min_rank: '最低位次',
  rank: '位次',
  lowest_rank: '最低位次',
  plan_num: '计划数',
  plan_count: '计划数',
  count: '数量',
  avg_score: '平均分',
  max_score: '最高分',
};

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ');
}

function humanizeColumn(key: string): string {
  if (COLUMN_NAME_MAP[key]) return COLUMN_NAME_MAP[key];
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .trim();
}

interface ChartViewData {
  type?: string;
  sql?: string;
  data?: Array<Record<string, unknown>>;
}

// 图表 spec：类目轴 + 数值系列（MiniChart 组件渲染）
export interface ChartSpec {
  kind: 'bar' | 'line' | 'pie';
  title?: string;
  categories: string[];
  series: Array<{ name: string; values: number[] }>;
}

const CATEGORY_KEYS = ['year', 'major_group', 'major_name', 'province', 'subject_type', 'batch', 'category', 'school_name'];

function toNumber(v: unknown): number | null {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return parseFloat(v);
  return null;
}

// 从行记录推断图表维度：类目列（首个非数值列，优先常见维度名）+ 数值列（≤3）
function buildChartSpec(view: ChartViewData): ChartSpec | null {
  const rows = view.data || [];
  if (rows.length < 2 || rows.length > 12) return null;
  const columns = Object.keys(rows[0]);
  // 类目列：优先常见维度列（year 等值为数字字符串时仍是维度），否则取第一列
  const catCol =
    columns.find((c) => CATEGORY_KEYS.includes(c)) || columns[0];
  // 数值列：类目列以外、每行都可数值化的列
  const numCols = columns.filter(
    (c) =>
      c !== catCol &&
      rows.some((r) => toNumber(r[c]) !== null) &&
      rows.every((r) => toNumber(r[c]) !== null || r[c] === null || r[c] === undefined),
  );
  if (numCols.length === 0) return null;

  const rawType = (view.type || '').toLowerCase();
  const kind: ChartSpec['kind'] = rawType.includes('pie') || rawType.includes('donut')
    ? 'pie'
    : rawType.includes('line') || rawType.includes('area')
      ? 'line'
      : 'bar';

  // 饼图只取第一个数值列；折线/柱状最多 3 个数值系列
  const seriesCols = kind === 'pie' ? [numCols[0]] : numCols.slice(0, 3);
  const values = (col: string) => rows.map((r) => toNumber(r[col]) ?? 0);
  return {
    kind,
    categories: rows.map((r) => String(r[catCol] ?? '')),
    series: seriesCols.map((c) => ({ name: humanizeColumn(c), values: values(c) })),
  };
}

function dataToMarkdown(view: ChartViewData): string {
  const rows = view.data || [];
  // 查询无结果时给出明确提示，避免只剩引导语
  if (rows.length === 0) return '\n\n（未查询到相关数据，请换个问法试试）\n';
  const columns = Object.keys(rows[0]);
  // 单行单列（如"最低录取分：623"）直接以粗体数值展示，不套 1x1 表格
  if (rows.length === 1 && columns.length === 1) {
    const v = rows[0][columns[0]];
    if (v !== null && v !== undefined && typeof v !== 'object') {
      return `\n\n**${String(v).replace(/\|/g, '\\|')}**\n`;
    }
  }
  // 模型选择了图表展示方式且数据适合绘图 → 输出 chart 标记由 MiniChart 渲染
  const rawType = (view.type || '').toLowerCase();
  if (rawType && rawType !== 'response_table') {
    const spec = buildChartSpec(view);
    if (spec) {
      return `\n\n\`\`\`chart\n${JSON.stringify(spec)}\n\`\`\`\n`;
    }
  }
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }
    return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
  };
  const header = `| ${columns.map(humanizeColumn).join(' | ')} |`;
  const divider = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = rows
    .map((r) => `| ${columns.map((c) => cell(r[c])).join(' | ')} |`)
    .join('\n');
  return `\n\n${header}\n${divider}\n${body}\n`;
}

// <chart-view content="&quot;...&quot;" /> → markdown 表格
function replaceChartViews(text: string): string {
  return text.replace(
    /<chart-view\b[^>]*?\/?>/gi,
    (tag) => {
      const m = tag.match(/\scontent=(?:"([^"]*)"|'([^']*)')/i);
      if (!m) return '';
      const raw = decodeHtmlEntities(m[1] !== undefined ? m[1] : m[2]);
      try {
        const view = JSON.parse(raw) as ChartViewData;
        return dataToMarkdown(view);
      } catch {
        return '';
      }
    },
  );
}

// 去掉成对思考链标签及其内容，以及任何残留的孤立标签
function stripThinkTags(text: string): string {
  let out = text.replace(
    /<think[\w-]*[^>]*>[\s\S]*?<\/think[\w-]*\s*>/gi,
    '',
  );
  out = out.replace(/<\/?think[\w-]*[^>]*>/gi, '');
  return out;
}

function tidyUp(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const TABLE_NAME_MAP: Array<[RegExp, string]> = [
  [/\bwhu_group_admissions\b/g, '专业组投档线数据'],
  [/\bwhu_major_records\b/g, '分专业录取数据'],
  [/\bwhu_school_summary\b/g, '院校录取数据'],
  [/\bwhu_data_coverage\b/g, '数据覆盖情况'],
  [/\bhubei_score_ranks\b/g, '一分一段表'],
  [/\bhubei_major_admissions\b/g, '招生计划数据'],
  [/\badmission_agent\b/g, '招生数据库'],
];

// 去掉 SQL 代码块（用户不需要看到查询语句），保留 chart 图表标记块
function stripSqlBlocks(text: string): string {
  return text.replace(
    /```([a-zA-Z]*)[^\n]*\n[\s\S]*?```/g,
    (m, lang) => (String(lang).toLowerCase() === 'chart' ? m : ''),
  );
}

function replaceTableNames(text: string): string {
  let out = text;
  for (const [re, name] of TABLE_NAME_MAP) out = out.replace(re, name);
  return out;
}

/** 后端偶发把 Python 异常栈拼进回答，这里整段剥掉，避免用户看到代码报错 */
function stripTraceback(text: string): string {
  const idx = text.search(/Traceback \(most recent call last\)|File "[A-Za-z]:[\\/][^"]+", line \d+/);
  if (idx === -1) return text;
  const head = text.slice(0, idx);
  // 异常栈后面若还有正文（如总结句）保留，这里优先保留截断处的正文
  const tail = text.slice(idx);
  const afterError = tail.split(/\n\s*\n/).slice(1).join('\n\n').trim();
  return afterError ? `${head.trim()}\n\n${afterError}` : head.trim();
}

export function sanitizeAnswer(raw: string): string {
  if (!raw) return '';
  let out = stripThinkTags(raw);
  out = replaceChartViews(out);
  out = stripSqlBlocks(out);
  out = replaceTableNames(out);
  out = stripTraceback(out);
  return tidyUp(out);
}
