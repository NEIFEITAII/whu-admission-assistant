import { describe, expect, it } from 'vitest';
import { decideMode, isComplexDataQuestion, isDataQuestion } from '@/utils/routeMode';

describe('routeMode', () => {
  it('将政策规则问题路由到知识库', () => {
    expect(decideMode('武汉大学报考条件是什么？')).toBe('chat_knowledge');
    expect(isDataQuestion('录取流程和材料要求有哪些？')).toBe(false);
  });

  it('强数据词优先于政策列举词', () => {
    const input = '招生专业有什么选科要求？';
    expect(isDataQuestion(input)).toBe(true);
    expect(decideMode(input)).toBe('chat_with_db_execute');
  });

  it('校园话题优先于普通数值词', () => {
    expect(isDataQuestion('转专业需要多少分？')).toBe(false);
    expect(decideMode('转专业需要多少分？')).toBe('chat_knowledge');
  });

  it('简单数值查询使用 execute', () => {
    expect(decideMode('2024年湖北物理类录取分数线')).toBe('chat_with_db_execute');
  });

  it('复杂趋势和比较查询使用 ReAct', () => {
    const input = '近三年湖北录取分数线逐年变化趋势';
    expect(isComplexDataQuestion(input)).toBe(true);
    expect(decideMode(input)).toBe('chat_with_db_react');
  });

  it('无明确意图的追问沿用上一轮引擎', () => {
    expect(decideMode('继续', 'chat_with_db_react')).toBe('chat_with_db_react');
    expect(decideMode('还有呢', 'chat_with_db_execute')).toBe('chat_with_db_execute');
  });

  it('空输入不触发数据判定并使用传入 fallback', () => {
    expect(isDataQuestion('  ')).toBe(false);
    expect(isComplexDataQuestion('')).toBe(false);
    expect(decideMode('  ', 'chat_with_db_execute')).toBe('chat_with_db_execute');
  });
});
