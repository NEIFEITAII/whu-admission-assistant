import { describe, expect, it } from 'vitest';
import { sanitizeAnswer, type ChartSpec } from '@/utils/answerFormat';

function chartTag(view: object): string {
  const content = JSON.stringify(view)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<chart-view content="${content}" />`;
}

function readChart(output: string): ChartSpec {
  const match = output.match(/```chart\n([\s\S]+?)\n```/);
  if (!match) throw new Error(`缺少 chart 标记：${output}`);
  return JSON.parse(match[1]) as ChartSpec;
}

describe('sanitizeAnswer', () => {
  it('清理 think、SQL 代码块和 Python traceback', () => {
    const raw = [
      '<think_never_used>内部分析</think_never_used>',
      '正式结论',
      '',
      '```sql',
      'SELECT * FROM whu_major_records;',
      '```',
      '',
      'Traceback (most recent call last):',
      '  File "C:\\agent\\query.py", line 12, in <module>',
      'ValueError: failed',
    ].join('\n');
    expect(sanitizeAnswer(raw)).toBe('正式结论');
  });

  it('将底层表名替换为业务名称', () => {
    expect(
      sanitizeAnswer('whu_group_admissions / whu_major_records / admission_agent'),
    ).toBe('专业组投档线数据 / 分专业录取数据 / 招生数据库');
  });

  it('单行单列结果直接显示粗体数值', () => {
    const output = sanitizeAnswer(
      chartTag({ type: 'response_table', data: [{ min_score: 623 }] }),
    );
    expect(output).toBe('**623**');
    expect(output).not.toContain('|');
  });

  it('多行结果转换为中文表头 Markdown 表格', () => {
    const output = sanitizeAnswer(
      chartTag({
        type: 'response_table',
        data: [
          { year: 2024, min_score: 623 },
          { year: 2023, min_score: 620 },
        ],
      }),
    );
    expect(output).toBe(
      '| 年份 | 最低分 |\n| --- | --- |\n| 2024 | 623 |\n| 2023 | 620 |',
    );
  });

  it('保留 chart 块并把 year 数字列作为维度', () => {
    const output = sanitizeAnswer(
      chartTag({
        type: 'response_line',
        data: [
          { year: 2023, min_score: '620' },
          { year: 2024, min_score: '623' },
        ],
      }),
    );
    expect(output).toContain('```chart\n');
    expect(readChart(output)).toEqual({
      kind: 'line',
      categories: ['2023', '2024'],
      series: [{ name: '最低分', values: [620, 623] }],
    });
  });

  it.each([
    ['response_pie', 'pie'],
    ['response_line', 'line'],
    ['response_bar', 'bar'],
  ] as const)('将 %s 转为 %s 图表', (type, kind) => {
    const spec = readChart(
      sanitizeAnswer(
        chartTag({
          type,
          data: [
            { major_name: '计算机类', min_score: 630, max_score: 645 },
            { major_name: '数学类', min_score: 625, max_score: 638 },
          ],
        }),
      ),
    );
    expect(spec.kind).toBe(kind);
    expect(spec.categories).toEqual(['计算机类', '数学类']);
    if (kind === 'pie') expect(spec.series).toHaveLength(1);
  });

  it('空数据给出明确提示', () => {
    expect(sanitizeAnswer(chartTag({ type: 'response_table', data: [] }))).toBe(
      '（未查询到相关数据，请换个问法试试）',
    );
  });

  it('移除缺少 content 或 JSON 非法的 chart 标签', () => {
    expect(
      sanitizeAnswer('前缀<chart-view />中<chart-view content="broken" />后缀'),
    ).toBe('前缀中后缀');
  });
});
