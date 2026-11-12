import { View, Text, ScrollView } from '@tarojs/components';
import { useMemo } from 'react';
import MiniChart from '@/components/MiniChart';
import type { ChartSpec } from '@/utils/answerFormat';
import styles from './index.module.scss';

interface Props {
  content: string;
}

type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] }
  | { type: 'code'; text: string }
  | { type: 'chart'; spec: ChartSpec }
  | { type: 'quote'; text: string }
  | { type: 'divider' };

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.split('\n');
  let i = 0;
  let paraBuf: string[] = [];

  const flushPara = () => {
    if (paraBuf.length > 0) {
      const text = paraBuf.join(' ').trim();
      if (text) blocks.push({ type: 'paragraph', text });
      paraBuf = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // 代码块（```chart 为图表标记，交由 MiniChart 渲染）
    if (trimmed.startsWith('```')) {
      flushPara();
      const lang = trimmed.slice(3).trim().toLowerCase();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing ```
      if (lang === 'chart') {
        try {
          const spec = JSON.parse(codeLines.join('\n')) as ChartSpec;
          if (spec && Array.isArray(spec.categories) && Array.isArray(spec.series)) {
            blocks.push({ type: 'chart', spec });
          }
        } catch {
          // 解析失败丢弃
        }
      } else {
        blocks.push({ type: 'code', text: codeLines.join('\n') });
      }
      continue;
    }

    // 表格
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      flushPara();
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        tableLines.push(lines[i].trim());
        i++;
      }
      const parseRow = (l: string) =>
        l.split('|').slice(1, -1).map((c) => c.trim());
      const header = parseRow(tableLines[0] || '');
      const rows: string[][] = [];
      for (let r = 1; r < tableLines.length; r++) {
        const cells = parseRow(tableLines[r]);
        // 跳过分隔行 |---|---|
        if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
        rows.push(cells);
      }
      blocks.push({ type: 'table', header, rows });
      continue;
    }

    // 标题
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (headingMatch) {
      flushPara();
      blocks.push({
        type: 'heading',
        level: headingMatch[1].length,
        text: headingMatch[2],
      });
      i++;
      continue;
    }

    // 分割线
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushPara();
      blocks.push({ type: 'divider' });
      i++;
      continue;
    }

    // 引用
    if (trimmed.startsWith('>')) {
      flushPara();
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith('>')) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ''));
        i++;
      }
      blocks.push({ type: 'quote', text: quoteLines.join(' ') });
      continue;
    }

    // 无序列表
    if (/^[-*+]\s+/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*+]\s+/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: false, items });
      continue;
    }

    // 有序列表
    if (/^\d+[.、)]\s*/.test(trimmed)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\d+[.、)]\s*/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+[.、)]\s*/, ''));
        i++;
      }
      blocks.push({ type: 'list', ordered: true, items });
      continue;
    }

    // 空行
    if (!trimmed) {
      flushPara();
      i++;
      continue;
    }

    paraBuf.push(trimmed);
    i++;
  }
  flushPara();
  return blocks;
}

// 行内格式：**粗体**、`行内代码`
function renderInline(text: string, keyPrefix: string) {
  const parts: Array<{ text: string; bold?: boolean; code?: boolean }> = [];
  let rest = text;
  let idx = 0;
  const regex = /(\*\*([^*]+)\*\*)|(`([^`]+)`)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    if (m.index > lastIndex) {
      parts.push({ text: text.slice(lastIndex, m.index) });
    }
    if (m[2] !== undefined) parts.push({ text: m[2], bold: true });
    else if (m[4] !== undefined) parts.push({ text: m[4], code: true });
    lastIndex = m.index + m[0].length;
    idx++;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex) });
  if (parts.length === 0) parts.push({ text: rest });

  return parts.map((p, i) => (
    <Text
      key={`${keyPrefix}-${i}`}
      className={`${styles.inline} ${p.bold ? styles.bold : ''} ${p.code ? styles.inlineCode : ''}`}
    >
      {p.text}
    </Text>
  ));
}

export default function MarkdownText({ content }: Props) {
  const blocks = useMemo(() => parseBlocks(content || ''), [content]);

  return (
    <View className={styles.markdown}>
      {blocks.map((block, bi) => {
        switch (block.type) {
          case 'heading':
            return (
              <View
                key={bi}
                className={`${styles.heading} ${styles[`h${block.level}`] || ''}`}
              >
                {renderInline(block.text, `h-${bi}`)}
              </View>
            );
          case 'paragraph':
            return (
              <View key={bi} className={styles.paragraph}>
                {renderInline(block.text, `p-${bi}`)}
              </View>
            );
          case 'quote':
            return (
              <View key={bi} className={styles.quote}>
                {renderInline(block.text, `q-${bi}`)}
              </View>
            );
          case 'divider':
            return <View key={bi} className={styles.divider} />;
          case 'chart':
            return <MiniChart key={bi} spec={block.spec} />;
          case 'code':
            return (
              <View key={bi} className={styles.codeBlock}>
                <Text className={styles.codeText}>{block.text}</Text>
              </View>
            );
          case 'list':
            return (
              <View key={bi} className={styles.list}>
                {block.items.map((item, ii) => (
                  <View key={ii} className={styles.listItem}>
                    <Text className={styles.listMarker}>
                      {block.ordered ? `${ii + 1}.` : '•'}
                    </Text>
                    <View className={styles.listContent}>
                      {renderInline(item, `li-${bi}-${ii}`)}
                    </View>
                  </View>
                ))}
              </View>
            );
          case 'table':
            return (
              <ScrollView key={bi} scrollX className={styles.tableScroll} enhanced showScrollbar={false}>
                <View className={styles.table}>
                  <View className={`${styles.tableRow} ${styles.tableHeader}`}>
                    {block.header.map((h, hi) => (
                      <View key={hi} className={styles.tableCell}>
                        {renderInline(h, `th-${bi}-${hi}`)}
                      </View>
                    ))}
                  </View>
                  {block.rows.map((row, ri) => (
                    <View key={ri} className={styles.tableRow}>
                      {row.map((cell, ci) => (
                        <View key={ci} className={styles.tableCell}>
                          {renderInline(cell, `td-${bi}-${ri}-${ci}`)}
                        </View>
                      ))}
                    </View>
                  ))}
                </View>
              </ScrollView>
            );
          default:
            return null;
        }
      })}
    </View>
  );
}
