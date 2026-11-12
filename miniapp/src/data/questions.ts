import { ChatMode } from '@/types/chat';

export interface QuestionItem {
  id: string;
  question: string;
  mode: ChatMode;
}

export interface QuestionCategory {
  category: string;
  items: QuestionItem[];
}

export const questions: QuestionCategory[] = [
  {
    category: '录取分数',
    items: [
      { id: 'q1', question: '2024年武汉大学在湖北物理类最低录取分是多少？', mode: 'chat_with_db_execute' },
      { id: 'q2', question: '2023年湖北历史类各专业组投档线分别是多少？', mode: 'chat_with_db_execute' },
      { id: 'q3', question: '2024年武汉大学计算机类专业在湖北的录取分数线？', mode: 'chat_with_db_execute' },
      { id: 'q4', question: '近三年武汉大学在湖北物理类的录取位次变化趋势', mode: 'chat_with_db_execute' },
    ],
  },
  {
    category: '位次与排名',
    items: [
      { id: 'q5', question: '湖北物理类位次5000名能上武汉大学吗？', mode: 'chat_with_db_execute' },
      { id: 'q6', question: '如何用一分一段表换算我的高考位次？', mode: 'chat_with_db_execute' },
      { id: 'q7', question: '湖北历史类位次2000名推荐报考哪些专业？', mode: 'chat_with_db_execute' },
    ],
  },
  {
    category: '招生政策',
    items: [
      { id: 'q8', question: '武汉大学2025年招生章程有哪些要点？', mode: 'chat_knowledge' },
      { id: 'q9', question: '强基计划的报考条件和流程是什么？', mode: 'chat_knowledge' },
      { id: 'q10', question: '武汉大学有哪些特殊类型招生？', mode: 'chat_knowledge' },
      { id: 'q11', question: '保送生和艺术类招生的要求分别是什么？', mode: 'chat_knowledge' },
      { id: 'q12', question: '新生入学后转专业政策是怎样的？', mode: 'chat_knowledge' },
    ],
  },
  {
    category: '志愿填报',
    items: [
      { id: 'q13', question: '武汉大学在湖北有哪些专业组，如何选？', mode: 'chat_with_db_execute' },
      { id: 'q14', question: '武汉大学2024年在湖北各专业的招生计划人数？', mode: 'chat_with_db_execute' },
      { id: 'q15', question: '平行志愿下冲武汉大学需要注意什么？', mode: 'chat_knowledge' },
      { id: 'q16', question: '武汉大学大类招生包含哪些专业方向？', mode: 'chat_knowledge' },
    ],
  },
];
