import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Textarea, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import classnames from 'classnames';
import { useChatStore } from '@/store/chatStore';
import MessageBubble from '@/components/MessageBubble';
import BrandMark from '@/components/BrandMark';
import { questions, QuestionItem } from '@/data/questions';
import styles from './index.module.scss';

// 从题库里挑 6 个覆盖四类场景、且能稳定出数据/出答案的高频问题
const ALL_QUESTIONS = questions.reduce<QuestionItem[]>((acc, g) => acc.concat(g.items), []);
const QUICK_QUESTIONS = ['q1', 'q2', 'q14', 'q9', 'q12', 'q8']
  .map((id) => ALL_QUESTIONS.find((q) => q.id === id))
  .filter((q): q is QuestionItem => !!q);

// 数据覆盖度统计（让用户感知智能体"知道什么"）
const DATA_STATS = [
  { value: '2018-2025', label: '录取数据' },
  { value: '2021-2025', label: '招生计划' },
  { value: '620+', label: '政策文档' },
];

export default function ChatPage() {
  const current = useChatStore((s) => s.current);
  const streaming = useChatStore((s) => s.streaming);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const cancel = useChatStore((s) => s.cancel);

  const [input, setInput] = useState('');
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef(0);

  const scrollToBottom = () => {
    scrollRef.current += 1;
    setScrollTop(scrollRef.current * 100000);
  };

  useEffect(() => {
    scrollToBottom();
  }, [current?.messages.length, current?.messages[current.messages.length - 1]?.content]);

  // 接收题库页跳转过来的问题
  useDidShow(() => {
    try {
      const pending = Taro.getStorageSync('whu_pending_question');
      if (pending && pending.text) {
        Taro.removeStorageSync('whu_pending_question');
        setTimeout(() => {
          sendMessage(pending.text);
        }, 100);
      }
    } catch (e) {
      console.error('[Chat] pending question error', e);
    }
  });

  const handleSend = () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    sendMessage(text);
  };

  const handleQuickAsk = (text: string) => {
    if (streaming) return;
    sendMessage(text);
  };

  const messages = current?.messages || [];
  const isEmpty = messages.length === 0;

  return (
    <View className={styles.page}>
      {isEmpty ? (
        <ScrollView scrollY className={styles.emptyScroll}>
          <View className={styles.welcome}>
            {/* Hero 区：渐变背景 + 光晕 */}
            <View className={styles.hero}>
              <View className={classnames(styles.orb, styles.orbGreen)} />
              <View className={classnames(styles.orb, styles.orbPink)} />

              <View className={styles.logoWrap}>
                <View className={styles.logoRing} />
                <BrandMark size={136} />
              </View>

              <Text className={styles.welcomeTitle}>武汉大学招生咨询</Text>
              <Text className={styles.welcomeDesc}>
                招生政策、分数线、位次、招生计划，都可以直接问我
              </Text>

              {/* 数据覆盖度统计条 */}
              <View className={styles.statsRow}>
                {DATA_STATS.map((s, i) => (
                  <View key={s.label} className={styles.statItem} style={{ animationDelay: `${i * 0.08}s` }}>
                    <Text className={styles.statValue}>{s.value}</Text>
                    <Text className={styles.statLabel}>{s.label}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* 快捷提问 */}
            <View className={styles.quickSection}>
              <View className={styles.quickHead}>
                <View className={styles.quickBar} />
                <Text className={styles.quickTitle}>试试这些问题</Text>
              </View>
              <View className={styles.quickList}>
                {QUICK_QUESTIONS.map((q) => (
                  <View
                    key={q.id}
                    className={styles.quickChip}
                    onClick={() => handleQuickAsk(q.question)}
                  >
                    <View className={styles.quickChipDot} />
                    <Text className={styles.quickChipText}>{q.question}</Text>
                    <Text className={styles.quickChipArrow}>›</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>
      ) : (
        <ScrollView
          scrollY
          className={styles.messageScroll}
          scrollTop={scrollTop}
          scrollWithAnimation
        >
          <View className={styles.messageList}>
            {messages.map((msg, idx) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                streaming={streaming && idx === messages.length - 1 && msg.role === 'assistant'}
              />
            ))}
            <View className={styles.bottomSpacer} />
          </View>
        </ScrollView>
      )}

      <View className={styles.inputBar}>
        <View className={styles.inputWrap}>
          <Textarea
            className={styles.textarea}
            value={input}
            onInput={(e) => setInput(e.detail.value)}
            placeholder="输入你的问题，政策、分数、计划都能问..."
            placeholderClass={styles.placeholder}
            autoHeight
            maxlength={500}
            cursorSpacing={16}
            adjustPosition
            showConfirmBar={false}
            confirmType="send"
            onConfirm={handleSend}
          />
        </View>
        {streaming ? (
          <Button className={classnames(styles.sendBtn, styles.stopBtn)} onClick={cancel}>
            <Text className={styles.sendBtnText}>停止</Text>
          </Button>
        ) : (
          <Button
            className={classnames(styles.sendBtn, { [styles.sendBtnDisabled]: !input.trim() })}
            onClick={handleSend}
            disabled={!input.trim()}
          >
            <Text className={styles.sendBtnText}>发送</Text>
          </Button>
        )}
      </View>
    </View>
  );
}
