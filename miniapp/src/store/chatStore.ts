import { create } from 'zustand';
import { ChatMessage, ChatMode, ChatSession } from '@/types/chat';
import { createConversation, streamChatCompletions } from '@/services/dbgpt';
import { generateId, loadSessions, saveSessions } from '@/utils/storage';
import { sanitizeAnswer } from '@/utils/answerFormat';
import { decideMode } from '@/utils/routeMode';

let _cancelRef: (() => void) | null = null;

// 旧版本数据库场景名兼容
const normalizeSession = (s: ChatSession): ChatSession => {
  const mode = (s.mode as string) === 'chat_with_db_qa' ? 'chat_with_db_execute' : s.mode;
  return { ...s, mode } as ChatSession;
};

/** 取会话里最近一条用户/助手消息所用的引擎，作为追问的默认引擎 */
const lastUsedMode = (session: ChatSession | null): ChatMode => {
  if (!session) return 'chat_knowledge';
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i].role !== 'system') return session.messages[i].mode;
  }
  return 'chat_knowledge';
};

/** 回答里出现这些说法，说明当前引擎没覆盖到，值得换另一个引擎再试一次 */
const INSUFFICIENT_RE =
  /内容不足|未提供|未收录|未涉及|无法回答|无法给出|没有相关|未查询到相关数据|资料不足|暂未收录/;

/**
 * 只有"基本没答"才换引擎。知识库常给出"已回答一部分 + 提示不够完整"
 * 的长回答，其中也含"内容不足"字样，若同样触发重试会白白多等一轮，
 * 还会把政策问题错送到数据库。这里要求回答足够短才判定为未覆盖。
 */
const isInsufficient = (text: string): boolean =>
  text.trim().length < 150 && INSUFFICIENT_RE.test(text);

/** 两个引擎都答不了时的兜底引导，避免留下一个生硬的"无法回答" */
const GUIDE_TEXT =
  '这个问题我暂时答不了。我能直接回答的是：分数线与位次、招生计划与专业目录、报考条件与录取规则。换个更具体的问法通常就能答，比如「2024年湖北物理类最低录取分是多少？」';

/**
 * 跨引擎兜底只允许 知识库 → 数据库 单向：
 * 知识库答不出数值类属正常，换数据引擎值得再试；
 * 数据库（含 ReAct）答不出时知识库大概率也没有，反向重试只会把等待翻倍。
 */
const fallbackMode = (mode: ChatMode): ChatMode | null =>
  mode === 'chat_knowledge' ? 'chat_with_db_react' : null;

interface ChatState {
  sessions: ChatSession[];
  current: ChatSession | null;
  streaming: boolean;
  init: () => void;
  newSession: () => void;
  openSession: (convUid: string) => void;
  deleteSession: (convUid: string) => void;
  clearAll: () => void;
  sendMessage: (text: string) => Promise<void>;
  cancel: () => void;
}

export const useChatStore = create<ChatState>((set, get) => {
  /** 更新指定助手消息的内容 */
  const setMsgContent = (msgId: string, content: string, error?: boolean) => {
    const cur = get().current;
    if (!cur) return;
    const messages = cur.messages.map((m) =>
      m.id === msgId ? { ...m, content, ...(error ? { error: true } : {}) } : m,
    );
    const s2 = { ...cur, messages, updatedAt: Date.now() };
    set({
      current: s2,
      sessions: get().sessions.map((s) => (s.convUid === s2.convUid ? s2 : s)),
    });
  };

  /** 确保某个引擎有可用的底层会话，并把它记为当前引擎 */
  const ensureConv = async (mode: ChatMode): Promise<string | null> => {
    const cur = get().current;
    if (!cur) return null;
    const convUids: Partial<Record<ChatMode, string>> = { ...(cur.convUids || {}) };
    if (cur.convUid && !convUids[cur.mode]) convUids[cur.mode] = cur.convUid;

    let convUid = convUids[mode];
    if (!convUid) {
      try {
        convUid = await createConversation(mode);
      } catch (e) {
        console.error('[ChatStore] create conversation error', e);
        return null;
      }
      convUids[mode] = convUid;
    }

    const latest = get().current;
    if (latest) {
      const s2 = { ...latest, mode, convUids };
      set({
        current: s2,
        sessions: get().sessions.map((s) => (s.convUid === s2.convUid ? s2 : s)),
      });
    }
    return convUid;
  };

  /**
   * 单条问题的完整作答流程：
   * 先用分到的引擎答；若回答表明"没覆盖到"，自动换另一个引擎重试一次；
   * 两次都不行则给出可操作的引导文案，而不是把失败原文抛给用户。
   */
  const answer = async (input: string, msgId: string, startMode: ChatMode) => {
    let mode = startMode;
    let lastText = '';

    for (let attempt = 0; attempt < 2; attempt++) {
      const convUid = await ensureConv(mode);
      if (!convUid) {
        setMsgContent(msgId, '无法连接问答服务，请确认后端已启动', true);
        set({ streaming: false });
        return;
      }

      const res = await new Promise<{ ok: boolean; text: string }>((resolve) => {
        let acc = '';
        _cancelRef = streamChatCompletions(
          { mode, convUid, userInput: input },
          {
            onDelta: (delta, replace) => {
              acc = replace ? delta : acc + delta;
              setMsgContent(msgId, acc);
            },
            onDone: () => resolve({ ok: true, text: sanitizeAnswer(acc) }),
            onError: (err) => resolve({ ok: false, text: `[错误] ${err.message}` }),
          },
        );
      });
      _cancelRef = null;

      if (!res.ok) {
        setMsgContent(msgId, res.text, true);
        set({ streaming: false });
        return;
      }

      lastText = res.text;
      const next = attempt === 0 && isInsufficient(lastText) ? fallbackMode(mode) : null;
      if (next) {
        // 知识库没覆盖到，换数据引擎再试一次（先清空气泡避免拼在一起）
        mode = next;
        setMsgContent(msgId, '');
        continue;
      }
      break;
    }

    setMsgContent(msgId, lastText || GUIDE_TEXT);
    set({ streaming: false });
    saveSessions(get().sessions);
  };

  return {
    sessions: [],
    current: null,
    streaming: false,

    init: () => {
      set({ sessions: loadSessions().map(normalizeSession) });
    },

    newSession: () => {
      set({ current: null });
    },

    openSession: (convUid) => {
      const s = get().sessions.find((x) => x.convUid === convUid) || null;
      if (s) set({ current: s });
    },

    deleteSession: (convUid) => {
      const list = get().sessions.filter((s) => s.convUid !== convUid);
      let current = get().current;
      if (current?.convUid === convUid) current = null;
      set({ sessions: list, current });
      saveSessions(list);
    },

    clearAll: () => {
      set({ sessions: [], current: null });
      saveSessions([]);
    },

    cancel: () => {
      if (_cancelRef) {
        _cancelRef();
        _cancelRef = null;
      }
      set({ streaming: false });
    },

    sendMessage: async (text) => {
      const input = text.trim();
      if (!input || get().streaming) return;

      const session = get().current;
      // 单入口智能分流：数字类走数据库，政策类走知识库，追问沿用上一轮
      const mode = decideMode(input, lastUsedMode(session));

      // 先把本轮引擎的会话建好，保证会话主标识从一开始就有效
      const convUids: Partial<Record<ChatMode, string>> = { ...(session?.convUids || {}) };
      if (session?.convUid && !convUids[session.mode]) convUids[session.mode] = session.convUid;
      if (!convUids[mode]) {
        try {
          convUids[mode] = await createConversation(mode);
        } catch (e) {
          console.error('[ChatStore] create conversation error', e);
          return;
        }
      }
      const primaryConvUid = session?.convUid || convUids[mode]!;

      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: input,
        mode,
        timestamp: Date.now(),
      };
      const assistantMsg: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '',
        mode,
        timestamp: Date.now(),
      };

      const prevTitle = session?.title || '';
      const title = prevTitle && prevTitle !== '新会话' ? prevTitle : input.slice(0, 20) || '新会话';

      const updatedSession: ChatSession = {
        convUid: primaryConvUid,
        title,
        mode,
        convUids,
        messages: [...(session?.messages || []), userMsg, assistantMsg],
        createdAt: session?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      const exists = !!session?.convUid && get().sessions.some((s) => s.convUid === session.convUid);
      set({
        current: updatedSession,
        sessions: exists
          ? get().sessions.map((s) => (s.convUid === updatedSession.convUid ? updatedSession : s))
          : [updatedSession, ...get().sessions],
        streaming: true,
      });

      await answer(input, assistantMsg.id, mode);
    },
  };
});
