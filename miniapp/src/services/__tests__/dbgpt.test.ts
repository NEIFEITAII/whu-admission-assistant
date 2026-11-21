import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const taroMocks = vi.hoisted(() => ({
  request: vi.fn(),
  getStorageSync: vi.fn(),
  setStorageSync: vi.fn(),
}));

vi.mock('@tarojs/taro', () => ({
  default: {
    request: taroMocks.request,
    getStorageSync: taroMocks.getStorageSync,
    setStorageSync: taroMocks.setStorageSync,
  },
}));

import { createConversation, streamChatCompletions } from '@/services/dbgpt';

interface ChunkPayload {
  data: ArrayBuffer;
}

type ChunkHandler = (payload: ChunkPayload) => void;

interface MockTask {
  onChunkReceived: (handler: ChunkHandler) => void;
  abort: ReturnType<typeof vi.fn>;
  then: Promise<void>['then'];
  catch: Promise<void>['catch'];
}

function createRequestTask() {
  let chunkHandler: ChunkHandler | undefined;
  let resolvePromise!: () => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  const task: MockTask = {
    onChunkReceived: (handler) => {
      chunkHandler = handler;
    },
    abort: vi.fn(),
    then: promise.then.bind(promise),
    catch: promise.catch.bind(promise),
  };
  return {
    task,
    emit(raw: string) {
      if (!chunkHandler) throw new Error('Chunk handler 尚未注册');
      const bytes = new TextEncoder().encode(raw);
      chunkHandler({ data: bytes.buffer as ArrayBuffer });
    },
    resolve: () => resolvePromise(),
    reject: (error: Error) => rejectPromise(error),
  };
}

function sse(payload: string): string {
  return `data: ${payload}\n\n`;
}

function delta(content: string): string {
  return sse(JSON.stringify({ choices: [{ delta: { content } }] }));
}

function message(content: string): string {
  return sse(JSON.stringify({ choices: [{ message: { content } }] }));
}

function chartTag(view: object): string {
  const content = JSON.stringify(view)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<chart-view content="${content}" />`;
}

function callbacks() {
  return { onDelta: vi.fn(), onDone: vi.fn(), onError: vi.fn() };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('streamChatCompletions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.TARO_ENV = 'weapp';
    taroMocks.request.mockReset();
    taroMocks.getStorageSync.mockReset().mockReturnValue('');
    taroMocks.setStorageSync.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(process.env, 'TARO_ENV');
  });

  it('会话请求断网时直接使用离线答案', async () => {
    taroMocks.request.mockRejectedValue({ errMsg: 'request:fail' });
    const convUid = await createConversation('chat_knowledge');
    expect(convUid).toBeNull();

    const cb = callbacks();
    streamChatCompletions(
      { mode: 'chat_knowledge', convUid, userInput: '转专业政策' },
      cb,
    );
    await vi.runAllTimersAsync();
    expect(taroMocks.request).toHaveBeenCalledTimes(1);
    expect(cb.onDelta.mock.calls.at(-1)?.[0]).toContain('离线演示数据');
    expect(cb.onDone).toHaveBeenCalledTimes(1);
    expect(cb.onError).not.toHaveBeenCalled();
  });

  it('服务端拒绝创建会话时保留错误信息', async () => {
    taroMocks.request.mockResolvedValue({ data: { success: false, err_msg: '会话未授权' } });
    await expect(createConversation('chat_knowledge')).rejects.toThrow('会话未授权');
  });

  it('知识库按增量帧输出，无 [DONE] 时静默超时收尾', async () => {
    const request = createRequestTask();
    taroMocks.request.mockReturnValue(request.task);
    const cb = callbacks();

    streamChatCompletions(
      { mode: 'chat_knowledge', convUid: 'knowledge-1', userInput: '介绍武汉大学' },
      cb,
    );

    expect(taroMocks.request.mock.calls[0][0]).toMatchObject({
      url: 'http://127.0.0.1:15670/api/v1/chat/completions',
      method: 'POST',
      enableChunked: true,
      data: { chat_mode: 'chat_knowledge', incremental: true },
    });
    request.emit(delta('武汉') + delta('大学'));
    expect(cb.onDelta.mock.calls).toEqual([['武汉'], ['大学']]);
    expect(cb.onDone).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(7999);
    expect(cb.onDone).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(cb.onDone).toHaveBeenCalledTimes(1);
    request.resolve();
    await flushPromises();
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('execute 忽略思考 JSON，以非增量快照覆盖并幂等收尾', async () => {
    const request = createRequestTask();
    taroMocks.request.mockReturnValue(request.task);
    const cb = callbacks();

    streamChatCompletions(
      { mode: 'chat_with_db_execute', convUid: 'execute-1', userInput: '最低分' },
      cb,
    );

    expect(taroMocks.request.mock.calls[0][0].data).toMatchObject({
      chat_mode: 'chat_with_db_execute',
      incremental: false,
    });
    request.emit(message('{"thought":"先生成 SQL"}'));
    expect(cb.onDelta).not.toHaveBeenCalled();

    const finalAnswer = `最终最低分：${chartTag({
      type: 'response_table',
      data: [{ min_score: 623 }],
    })}`;
    request.emit(message(finalAnswer));
    expect(cb.onDelta).toHaveBeenCalledWith('最终最低分：\n\n**623**', true);
    expect(cb.onDone).toHaveBeenCalledTimes(1);

    request.resolve();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10000);
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('知识库收到 [DONE] 后立即完成且只回调一次', async () => {
    const request = createRequestTask();
    taroMocks.request.mockReturnValue(request.task);
    const cb = callbacks();

    streamChatCompletions(
      { mode: 'chat_knowledge', convUid: 'knowledge-2', userInput: '报考条件' },
      cb,
    );
    request.emit(delta('完整答案') + sse('[DONE]'));

    expect(cb.onDelta).toHaveBeenCalledWith('完整答案');
    expect(cb.onDone).toHaveBeenCalledTimes(1);
    request.resolve();
    await flushPromises();
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('ReAct 收到 final 和 done 后展示最终答案并完成', async () => {
    const request = createRequestTask();
    taroMocks.request.mockReturnValue(request.task);
    const cb = callbacks();

    streamChatCompletions(
      { mode: 'chat_with_db_react', convUid: 'react-1', userInput: '对比录取趋势' },
      cb,
    );
    request.emit(
      sse(JSON.stringify({ type: 'final', content: '最终分析' }))
      + sse(JSON.stringify({ type: 'done' })),
    );

    expect(cb.onDelta).toHaveBeenCalledWith('最终分析', true);
    expect(cb.onDone).toHaveBeenCalledTimes(1);
    request.resolve();
    await flushPromises();
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('网络失败时降级为离线演示答案，不再直接报错', async () => {
    const request = createRequestTask();
    taroMocks.request.mockReturnValue(request.task);
    const cb = callbacks();

    streamChatCompletions(
      { mode: 'chat_knowledge', convUid: 'knowledge-1', userInput: '国家专项计划的报考条件' },
      cb,
    );
    request.reject(new Error('request:fail timeout'));
    await flushPromises();

    // 演示模式下不向用户抛错，改为逐字输出内置样例
    expect(cb.onError).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    const last = cb.onDelta.mock.calls.at(-1)?.[0] as string;
    expect(last).toContain('离线演示数据');
    expect(last).toContain('国家专项');
    expect(cb.onDone).toHaveBeenCalledTimes(1);
  });

  it('非网络类错误仍然向上抛出，不被演示模式掩盖', async () => {
    const request = createRequestTask();
    taroMocks.request.mockReturnValue(request.task);
    const cb = callbacks();

    streamChatCompletions(
      { mode: 'chat_knowledge', convUid: 'knowledge-1', userInput: '介绍武汉大学' },
      cb,
    );
    request.reject(new Error('知识库空间未授权'));
    await flushPromises();

    expect(cb.onError).toHaveBeenCalledTimes(1);
    expect(cb.onError.mock.calls[0][0]).toEqual(new Error('知识库空间未授权'));
  });
});
