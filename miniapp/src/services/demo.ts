import type { ChatMode } from '@/types/chat';

const DEMO_NOTE = '\n\n> 离线演示数据：当前未连接问答服务，以上为内置样例；连接后端后将展示实时查询结果。';

interface DemoEntry {
  match: RegExp;
  modes?: ChatMode[];
  answer: string;
}

const ENTRIES: DemoEntry[] = [
  {
    match: /国家专项|专项计划/,
    modes: ['chat_knowledge'],
    answer: `国家专项计划的报考条件主要有三点：

1. **户籍**：考生本人具有实施区域当地连续三年以上户籍，其父亲或母亲或法定监护人具有当地户籍。
2. **学籍**：考生本人具有户籍所在县高中连续三年学籍并实际就读。
3. **资格**：须通过省级招生考试机构组织的专项计划资格审核，公示无异议后方可填报。

国家专项计划在本科提前批之后、普通批之前投档，录取分数原则上不低于学校所在批次的控制线。${DEMO_NOTE}`,
  },
  {
    match: /转专业/,
    modes: ['chat_knowledge'],
    answer: `武汉大学本科生转专业一般在**大一学年结束后**申请，主要条件与流程如下：

- **基本条件**：在校期间无违纪记录，已修课程成绩合格；部分专业对先修课程或成绩排名有要求。
- **限制情形**：艺术类、体育类等特殊类型招生录取的学生，通常只能在同类专业范围内申请。
- **办理流程**：学院公布接收计划与考核办法 → 学生提交申请 → 接收学院组织考核（笔试/面试）→ 公示拟录取名单 → 报学校教务部门审批。

具体名额与考核方式每年会有调整，建议以当年教务处发布的通知为准。${DEMO_NOTE}`,
  },
  {
    match: /奖助学金|奖学金|助学金|资助/,
    modes: ['chat_knowledge'],
    answer: `武汉大学本科生奖助体系大致分为三类：

| 类型 | 主要项目 | 说明 |
|---|---|---|
| 奖学金 | 国家奖学金、优秀学生奖学金、各类社会捐赠奖学金 | 奖励学业与综合表现优秀的学生 |
| 助学金 | 国家助学金、校内困难补助 | 面向家庭经济困难学生，按困难等级分档 |
| 助学贷款与勤工助学 | 生源地信用助学贷款、勤工助学岗位 | 缓解就学资金压力 |

评定一般按学年进行，由学生申请、班级民主评议、学院审核、学校公示后发放。${DEMO_NOTE}`,
  },
  {
    match: /宿舍|住宿|寝室/,
    modes: ['chat_knowledge'],
    answer: `武汉大学本科生宿舍以**四人间**为主，部分楼栋为六人间，住宿条件包括：

- 上床下桌，每人独立书桌与衣柜；
- 配备空调，可自行调节温度；
- 独立卫浴或楼层公共卫浴（视楼栋而定），提供热水；
- 宿舍区覆盖校园网络，公共区域配有洗衣房、开水间。

不同校区的宿舍楼建成年代不同，具体分配以入学时的宿舍安排为准。${DEMO_NOTE}`,
  },
  {
    match: /位次|排名|名次/,
    modes: ['chat_with_db_execute', 'chat_with_db_react'],
    answer: `2024 年湖北物理类部分分数对应的累计位次如下：

| 分数 | 累计位次 |
|---|---|
| 653 | 2315 |
| 649 | 2879 |
| 647 | 3218 |

分数越高位次越靠前，同一分数的考生按同分排序规则确定先后顺序。${DEMO_NOTE}`,
  },
  {
    match: /计划|招生人数|招多少/,
    modes: ['chat_with_db_execute', 'chat_with_db_react'],
    answer: `武汉大学在湖北的招生计划总量：

| 年份 | 计划总数 |
|---|---|
| 2024 | 1698 |
| 2025 | 1704 |

2025 年比 2024 年增加 6 人，整体规模保持稳定。${DEMO_NOTE}`,
  },
  {
    match: /专业组|投档线|最低分|录取分/,
    modes: ['chat_with_db_execute', 'chat_with_db_react'],
    answer: `2024 年湖北物理类部分专业组投档线：

| 专业组 | 最低分 | 对应位次 |
|---|---|---|
| (06) 普通类 | 641 | 4287 |
| (11) 普通类 | 647 | 3218 |
| (12) 普通类 | 649 | 2879 |
| (07) 国家专项 | 623 | 8760 |

同一专业组内不同专业录取分数会有差异，组内最低分即该组投档线。${DEMO_NOTE}`,
  },
  {
    match: /快报|汇总|概览|趋势/,
    modes: ['chat_with_db_execute', 'chat_with_db_react'],
    answer: `**2024 年招生快报（湖北）**

- 招生计划总数：1698 人
- 物理类普通类最低投档线：641 分，对应位次 4287
- 历史类普通类最低投档线：628 分，对应位次 797
- 覆盖批次：普通批、国家专项、高校专项、民族班、中外合作办学

从 2023 到 2025 年，物理类普通类最低分依次为 636、641、634，整体在 630–645 区间波动。${DEMO_NOTE}`,
  },
];

const DEFAULT_ANSWER = `我可以回答武汉大学招生相关问题，例如：

- **招生政策**：国家专项报考条件、转专业规则、奖助学金、宿舍条件
- **分数与位次**：某年某科类的分数对应位次、专业组投档线
- **招生计划**：分年度、分类别的计划数量
- **数据汇总**：年度招生快报、跨年趋势对比

当前为离线演示模式，内置样例覆盖上述方向。连接问答服务后，所有数字将改为实时查库结果。`;

export function pickDemoAnswer(question: string, mode?: ChatMode): string {
  const q = (question || '').trim();
  const hit = ENTRIES.find(
    (entry) => (!entry.modes || !mode || entry.modes.includes(mode)) && entry.match.test(q),
  );
  return hit ? hit.answer : DEFAULT_ANSWER;
}

/**
 * 模拟流式输出演示答案，返回取消函数。
 * 按固定间隔分片推送，保证与真实链路一致的逐字呈现效果。
 */
export function streamDemoAnswer(
  question: string,
  mode: ChatMode | undefined,
  onDelta: (text: string, replace?: boolean) => void,
  onDone: () => void,
): () => void {
  const text = pickDemoAnswer(question, mode);
  const step = 6;
  let cursor = 0;
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = () => {
    if (cancelled) return;
    cursor += step;
    onDelta(text.slice(0, Math.min(cursor, text.length)), true);
    if (cursor >= text.length) {
      onDone();
      return;
    }
    timer = setTimeout(tick, 40);
  };

  timer = setTimeout(tick, 120);
  return () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
}
