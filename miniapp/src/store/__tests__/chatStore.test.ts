import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMode } from '@/types/chat';
import type { StreamCallbacks } from '@/services/dbgpt';

const taroMocks = vi.hoisted(() => ({
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
}));

const serviceMocks = vi.hoisted(() => ({
  createConversation: vi.fn(),
  streamChatCompletions: vi.fn(),
}));

vi.mock('@tarojs/taro', () => ({
  default: {
    getStorageSync: taroMocks.getStorageSync,
    setStorageSync: taroMocks.setStorageSync,
  },
}));

vi.mock('@/services/dbgpt', () => ({
  createConversation: serviceMocks.createConversation,
  streamChatCompletions: serviceMocks.streamChatCompletions,
}));

import { useChatStore } from '@/store/chatStore';

interface StreamParams {
  mode: ChatMode;
  convUid: string | null;
  userInput: string;
}

function mockStreamAnswer(answerFor: (mode: ChatMode) => string) {
  serviceMocks.streamChatCompletions.mockImplementation(
    (params: StreamParams, callbacks: StreamCallbacks) => {
      callbacks.onDelta(answerFor(params.mode));
      callbacks.onDone();
      return vi.fn();
    },
  );
}

describe('chatStore 引擎会话与兜底', () => {
  beforeEach(() => {
    useChatStore.setState({ sessions: [], current: null, streaming: false });
    taroMocks.getStorageSync.mockReset().mockReturnValue([]);
    taroMocks.setStorageSync.mockReset();
    serviceMocks.createConversation
      .mockReset()
      .mockImplementation((mode: ChatMode) => Promise.resolve(`${mode}-uid`));
    serviceMocks.streamChatCompletions.mockReset();
    mockStreamAnswer((mode) => `${mode}：内容充足的正常回答`);
  });

  it('立即显示问题，连不上后端时用离线回答，恢复后可在同一会话查询', async () => {
    serviceMocks.createConversation.mockResolvedValueOnce(null);
    const input = '新生入学后转专业政策是怎样的？';
    const send = useChatStore.getState().sendMessage(input);
    expect(useChatStore.getState().streaming).toBe(true);
    expect(useChatStore.getState().current?.messages[0].content).toBe(input);
    const sessionUid = useChatStore.getState().current?.convUid;
    await send;
    expect(serviceMocks.streamChatCompletions.mock.calls[0][0].convUid).toBeNull();
    expect(useChatStore.getState().current?.convUids).toEqual({});
    expect(useChatStore.getState().streaming).toBe(false);
    expect(taroMocks.setStorageSync).toHaveBeenCalled();

    await useChatStore.getState().sendMessage(input);
    expect(serviceMocks.streamChatCompletions.mock.calls[1][0].convUid).toBe('chat_knowledge-uid');
    expect(useChatStore.getState().current?.convUid).toBe(sessionUid);
  });

  it('停止后忽略旧的会话创建结果，允许继续提问', async () => {
    let resolveConversation!: (uid: string) => void;
    serviceMocks.createConversation.mockReturnValueOnce(new Promise<string>((resolve) => {
      resolveConversation = resolve;
    }));
    const cancelled = useChatStore.getState().sendMessage('国家专项报考条件');
    useChatStore.getState().cancel();
    await useChatStore.getState().sendMessage('转专业政策');
    resolveConversation('cancelled-uid');
    await cancelled;
    expect(serviceMocks.streamChatCompletions).toHaveBeenCalledTimes(1);
    expect(useChatStore.getState().current?.convUids?.chat_knowledge).toBe('chat_knowledge-uid');
  });

  it('为每个引擎独立创建并复用 convUid', async () => {
    const inputs = [
      ['武汉大学报考条件是什么？', 'chat_knowledge'],
      ['2024年湖北物理类录取分数线', 'chat_with_db_execute'],
      ['近三年湖北录取分数线逐年变化趋势', 'chat_with_db_react'],
      ['继续', 'chat_with_db_react'],
      ['报考材料有哪些？', 'chat_knowledge'],
      ['2023年湖北历史类录取分数线', 'chat_with_db_execute'],
    ] as const;

    for (const [input, mode] of inputs) {
      await useChatStore.getState().sendMessage(input);
      const calls = serviceMocks.streamChatCompletions.mock.calls;
      expect(calls[calls.length - 1][0]).toMatchObject({
        mode,
        convUid: `${mode}-uid`,
      });
    }

    expect(serviceMocks.createConversation.mock.calls.map((call) => call[0])).toEqual([
      'chat_knowledge',
      'chat_with_db_execute',
      'chat_with_db_react',
    ]);
    expect(useChatStore.getState().current?.convUids).toEqual({
      chat_knowledge: 'chat_knowledge-uid',
      chat_with_db_execute: 'chat_with_db_execute-uid',
      chat_with_db_react: 'chat_with_db_react-uid',
    });
  });

  it('知识库短回答不足时仅向数据库兜底一次', async () => {
    mockStreamAnswer((mode) =>
      mode === 'chat_knowledge' ? '暂未收录该政策' : '数据库兜底回答：最低分623',
    );

    await useChatStore.getState().sendMessage('这项报考条件是什么？');

    expect(
      serviceMocks.streamChatCompletions.mock.calls.map((call) => call[0].mode),
    ).toEqual(['chat_knowledge', 'chat_with_db_react']);
    const messages = useChatStore.getState().current?.messages;
    expect(messages?.[messages.length - 1].content).toBe('数据库兜底回答：最低分623');
  });

  it('包含不足提示的长知识回答不重试', async () => {
    const longAnswer = `${'武汉大学报考条件和录取规则说明。'.repeat(12)}以上内容不足部分可参考招生简章。`;
    expect(longAnswer.length).toBeGreaterThan(150);
    mockStreamAnswer(() => longAnswer);

    await useChatStore.getState().sendMessage('武汉大学报考条件是什么？');

    expect(serviceMocks.streamChatCompletions).toHaveBeenCalledTimes(1);
    const messages = useChatStore.getState().current?.messages;
    expect(messages?.[messages.length - 1].content).toBe(longAnswer);
  });

  it.each([
    ['2024年湖北物理类录取分数线', 'chat_with_db_execute'],
    ['近三年湖北录取分数线逐年变化趋势', 'chat_with_db_react'],
  ] as const)('%s 的数据库不足回答不反向重试知识库', async (input, mode) => {
    mockStreamAnswer(() => '未查询到相关数据');

    await useChatStore.getState().sendMessage(input);

    expect(serviceMocks.streamChatCompletions).toHaveBeenCalledTimes(1);
    expect(serviceMocks.streamChatCompletions.mock.calls[0][0].mode).toBe(mode);
    expect(serviceMocks.createConversation).toHaveBeenCalledTimes(1);
    const messages = useChatStore.getState().current?.messages;
    expect(messages?.[messages.length - 1].content).toBe('未查询到相关数据');
  });
});
