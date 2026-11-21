import { create } from 'zustand';
import { ChatMessage, ChatMode, ChatSession } from '@/types/chat';
import { createConversation, streamChatCompletions } from '@/services/dbgpt';
import { generateId, loadSessions, saveSessions } from '@/utils/storage';
import { sanitizeAnswer } from '@/utils/answerFormat';
import { decideMode } from '@/utils/routeMode';

// 旧版本数据库场景名兼容
const normalizeSession = (s: ChatSession): ChatSession => {
  if ((s.mode as string) !== 'chat_with_db_qa') return s;
  return {
    ...s,
    mode: 'chat_with_db_execute',
    convUids: {
      ...s.convUids,
      chat_with_db_execute: s.convUids?.chat_with_db_execute || s.convUids?.[s.mode] || s.convUid,
    },
  };
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
  let cancelAnswer: (() => void) | null = null;

  const updateSession = (sessionUid: string, update: (session: ChatSession) => ChatSession) => {
    const { current, sessions } = get();
    const session = sessions.find((s) => s.convUid === sessionUid);
    if (!session) return;
    const updated = update(session);
    set({
      current: current?.convUid === sessionUid ? updated : current,
      sessions: sessions.map((s) => (s.convUid === sessionUid ? updated : s)),
    });
  };

  const answer = async (input: string, sessionUid: string, msgId: string, startMode: ChatMode) => {
    let cancelled = false;
    let stopStream: (() => void) | undefined;
    cancelAnswer = () => {
      cancelled = true;
      stopStream?.();
    };

    const setMsgContent = (content: string, error = false) => {
      updateSession(sessionUid, (session) => ({
        ...session,
        updatedAt: Date.now(),
        messages: session.messages.map((message) =>
          message.id === msgId ? { ...message, content, error } : message,
        ),
      }));
    };

    let mode = startMode;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const session = get().sessions.find((s) => s.convUid === sessionUid);
        if (!session) return;
        const convUid = session.convUids?.[mode] ?? (await createConversation(mode));
        if (cancelled) return;
        if (convUid) {
          updateSession(sessionUid, (latest) => ({
            ...latest,
            mode,
            convUids: { ...latest.convUids, [mode]: convUid },
          }));
        }

        const reply = await new Promise<string>((resolve, reject) => {
          let content = '';
          const abort = streamChatCompletions(
            { mode, convUid, userInput: input },
            {
              onDelta: (delta, replace) => {
                if (cancelled) return;
                content = replace ? delta : content + delta;
                setMsgContent(content);
              },
              onDone: () => resolve(sanitizeAnswer(content)),
              onError: reject,
            },
          );
          stopStream = () => {
            abort();
            resolve('');
          };
        });
        stopStream = undefined;
        if (cancelled) return;

        const next = attempt === 0 && convUid && isInsufficient(reply) ? fallbackMode(mode) : null;
        if (!next) {
          setMsgContent(reply || GUIDE_TEXT);
          return;
        }
        mode = next;
        setMsgContent('');
      }
    } catch (error) {
      if (!cancelled) {
        const message = error instanceof Error ? error.message : '问答服务暂时无法处理这条消息';
        setMsgContent(`[错误] ${message}`, true);
      }
    } finally {
      if (!cancelled) {
        cancelAnswer = null;
        set({ streaming: false });
        saveSessions(get().sessions);
      }
    }
  };

  return {
    sessions: [],
    current: null,
    streaming: false,

    init: () => {
      if (!get().streaming) set({ sessions: loadSessions().map(normalizeSession) });
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
      cancelAnswer?.();
      cancelAnswer = null;
      set({ streaming: false });
      saveSessions(get().sessions);
    },

    sendMessage: async (text) => {
      const input = text.trim();
      if (!input || get().streaming) return;

      const session = get().current;
      // 单入口智能分流：数字类走数据库，政策类走知识库，追问沿用上一轮
      const mode = decideMode(input, lastUsedMode(session));

      // 兼容早期将首个后端会话 ID 用作本地会话标识的历史记录。
      const convUids = session?.convUids ?? (session ? { [session.mode]: session.convUid } : {});
      const primaryConvUid = session?.convUid || generateId();

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

      await answer(input, primaryConvUid, assistantMsg.id, mode);
    },
  };
});
