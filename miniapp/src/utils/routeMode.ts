import { ChatMode } from '@/types/chat';

/**
 * 强数据意图：命中即判定为查库，优先级高于「有哪些 / 是什么」这类政策词
 * （"有哪些专业组""专业目录包含什么"本质是列举数据库里的客观清单）
 */
const STRONG_DATA_PATTERNS: RegExp[] = [
  /专业组|院校专业组|专业目录|招生专业|开设专业|专业代码|选科要求/,
];

/**
 * 数字/聚合类意图：出现这些词，几乎必然是查库问题（知识库无法给出数值）
 */
const DATA_PATTERNS: RegExp[] = [
  /分数线|投档线|录取线|最低分|最高分|平均分|录取分/,
  /位次|排名|名次|一分一段/,
  /多少人|多少分|多少名|招多少|几个人|几分/,
  /人数|总数|合计|总计划|计划数|招生计划/,
  /逐年|趋势|增长|下降|减少|越多|越少|扩招|缩招/,
  /占比|比例|百分比|百分位|超越/,
];

/**
 * 政策/规则类意图：出现这些词，说明要的是规则解释而非数值
 */
const POLICY_PATTERNS: RegExp[] = [
  /条件|要求|流程|材料|时间|步骤|方式|渠道|入口|资格/,
  /是什么|什么是|如何|怎么|怎样|能否|可以吗|是否|有没有/,
  /政策|规则|规定|章程|简章|办法|通知|解读|区别|差异/,
  /有哪些|有什么|包含|包括|介绍|名单/,
  /多少次/,
];

/**
 * 明确属于知识科普的话题：即便夹带"多少"也不该走数据库
 */
const TOPIC_PATTERNS: RegExp[] = [
  /转专业|保研|推免|就业|薪资|宿舍|食堂|社团|奖学金|助学金|助学贷款|校园|校区/,
];

export function isDataQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/研究生|硕士|博士|学院简介|学院概况/.test(t)) return false;
  if (/强基计划|保送生|高校专项/.test(t)
      && /专业|条件|流程|简章|考核/.test(t)
      && !/录取分|分数线|投档线|位次|人数|招生计划/.test(t)) return false;
  if (STRONG_DATA_PATTERNS.some((re) => re.test(t))) return true;
  if (TOPIC_PATTERNS.some((re) => re.test(t))) return false;
  if (POLICY_PATTERNS.some((re) => re.test(t))) return false;
  return DATA_PATTERNS.some((re) => re.test(t));
}

/**
 * 复杂数据意图：列举/趋势/对比/跨年等需要多步推理的数据问题。
 * 这类不走 fastpath 通路（SQL 生成需 LLM 多轮），走 ReAct 智能体。
 */
const COMPLEX_DATA_PATTERNS: RegExp[] = [
  /逐年|趋势|变化|对比|比较|差异/,
  /哪些|所有|各个|完整|全部|列表|目录/,
  /跨.*年|多年|历年|每年/,
  /最高|最低|平均|占比|比例/,
  /预测|建议|推荐|能上吗|可以上吗|冲稳保/,
];

/** 判断是否为复杂数据问题（需 ReAct 多步推理），简单数值查询返回 false */
export function isComplexDataQuestion(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (!isDataQuestion(t)) return false;
  return COMPLEX_DATA_PATTERNS.some((re) => re.test(t));
}

/**
 * 决定这条问题交给哪个引擎（三档路由）：
 * 1. 命中数字意图且非复杂 → chat_with_db_execute（fastpath 通路，最快）
 * 2. 命中数字意图且复杂   → chat_with_db_react（ReAct 智能体，多步推理）
 * 3. 命中政策意图          → 知识库（能讲清规则）
 * 4. 都不像（追问）        → 沿用上一轮引擎，保持上下文
 */
export function decideMode(text: string, fallback: ChatMode = 'chat_knowledge'): ChatMode {
  const t = text.trim();
  if (isDataQuestion(t)) {
    return isComplexDataQuestion(t) ? 'chat_with_db_react' : 'chat_with_db_execute';
  }
  if (/研究生|硕士|博士|学院简介|学院概况|强基计划|保送生|高校专项/.test(t)) {
    return 'chat_knowledge';
  }
  if (POLICY_PATTERNS.some((re) => re.test(t))) return 'chat_knowledge';
  return fallback;
}
