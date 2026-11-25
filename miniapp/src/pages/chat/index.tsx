import { useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, Textarea, Button } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import classnames from 'classnames';
import { useChatStore } from '@/store/chatStore';
import MessageBubble from '@/components/MessageBubble';
import BrandMark from '@/components/BrandMark';
import { questions, QuestionItem } from '@/data/questions';
import { getBaseUrl } from '@/services/dbgpt';
import { ChatMessage } from '@/types/chat';
import styles from './index.module.scss';

const ALL_QUESTIONS = questions.flatMap((g) => g.items);
const QUICK_QUESTIONS = ['q1', 'q2', 'q14', 'q9', 'q12', 'q8']
  .map((id) => ALL_QUESTIONS.find((q) => q.id === id))
  .filter((q): q is QuestionItem => !!q);
const CATEGORIES = ['通知公告', '招生政策', '保送生', '艺术类招生', '高水平运动队', '高水平艺术团', '强基计划', '农村学生自强计划', '港澳台招生'];

export default function ChatPage() {
  const { current, sessions, streaming, sendMessage, cancel, newSession, openSession } = useChatStore();
  const [input, setInput] = useState('');
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(process.env.TARO_ENV === 'h5' && typeof window !== 'undefined' && window.innerWidth >= 1280);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [selected, setSelected] = useState<ChatMessage | null>(null);
  const [activeCategory, setActiveCategory] = useState('');
  const [service, setService] = useState('正在连接');
  const [stats, setStats] = useState<{ pages?: number; entities?: number; edges?: number }>({});
  const [scrollTop, setScrollTop] = useState(0);
  const scrollRef = useRef(0);
  const messages = current?.messages || [];
  const latest = [...messages].reverse().find((m) => m.role === 'assistant');
  const evidence = selected && messages.some((m) => m.id === selected.id) ? selected : latest;
  const sources = evidence?.sources || [];

  useEffect(() => {
    scrollRef.current += 1;
    setScrollTop(scrollRef.current * 100000);
  }, [current?.convUid, messages.length, latest?.content]);

  useEffect(() => {
    Taro.request({ url: `${getBaseUrl()}/api/v1/test`, timeout: 10000 })
      .then((r) => { const data = r.data as any; setService(data === 'service status is UP' ? '服务已连接' : '服务准备中'); })
      .catch(() => setService('服务未连接'));
  }, []);

  useDidShow(() => {
    const pending = Taro.getStorageSync('whu_pending_question');
    if (pending?.text) { Taro.removeStorageSync('whu_pending_question'); sendMessage(pending.text); }
  });

  const ask = (text: string) => {
    if (!text.trim() || streaming) return;
    setInput(''); setSelected(null); sendMessage(text.trim());
  };
  const reset = () => { if (!streaming) { newSession(); setSelected(null); setLeftOpen(false); setInput(''); } };
  const openSources = (message: ChatMessage) => { setSelected(message); setRightOpen(true); };
  const openOriginal = (url?: string) => {
    if (!url || !/^https?:\/\//i.test(url)) return;
    if (process.env.TARO_ENV === 'h5') window.open(url, '_blank', 'noopener,noreferrer');
    else Taro.setClipboardData({ data: url });
  };

  return (
    <View className={classnames('whuChat', styles.page, { [styles.leftCollapsed]: leftCollapsed })} style={process.env.TARO_ENV !== 'h5' ? { height: '100vh' } : undefined}>
      {(leftOpen || rightOpen) && <View className={styles.backdrop} onClick={() => { setLeftOpen(false); setRightOpen(false); }} />}
      <View className={classnames(styles.leftSidebar, { [styles.drawerOpen]: leftOpen })}>
        <View className={styles.brand}><BrandMark size={64} /><View><Text className={styles.brandTitle}>武大招生助手</Text><Text className={styles.brandSub}>武汉大学本科招生咨询</Text></View></View>
        <Button className={styles.newChat} onClick={reset} disabled={streaming}>＋　开启新对话</Button>
        <View className={styles.sideHeading}><Text>问题分类</Text><Text className={styles.muted}>招办栏目</Text></View>
        <ScrollView scrollY className={styles.sidebarScroll}>
          {CATEGORIES.map((name) => <View key={name} className={classnames(styles.category, { [styles.categoryActive]: activeCategory === name })} onClick={() => { setActiveCategory(name); setInput(`请介绍武汉大学${name}的相关信息，并注明年份和来源。`); setLeftOpen(false); }}><Text>{name}</Text><Text className={styles.categoryArrow}>›</Text></View>)}
          <Text className={styles.sectionLabel}>最近对话</Text>
          {sessions.slice(0, 8).map((s) => <View key={s.convUid} className={classnames(styles.session, { [styles.sessionActive]: current?.convUid === s.convUid })} onClick={() => { if (!streaming) { openSession(s.convUid); setSelected(null); setLeftOpen(false); } }}><Text>{s.title}</Text></View>)}
          {!sessions.length && <Text className={styles.emptyHistory}>开始提问后，会话会保存在这里</Text>}
        </ScrollView>
        <View className={styles.sideFooter}><Text onClick={() => Taro.switchTab({ url: '/pages/questions/index' })}>问题库 ↗</Text><Text onClick={() => Taro.switchTab({ url: '/pages/mine/index' })}>连接设置</Text></View>
      </View>

      <View className={styles.workspace}>
        <View className={styles.topbar}>
          <View className={styles.titleGroup}><Text className={styles.menuButton} onClick={() => { if (Taro.getSystemInfoSync().windowWidth >= 768) setLeftCollapsed(!leftCollapsed); else setLeftOpen(!leftOpen); }}>☰</Text><View><Text className={styles.topTitle}>{current?.title || '招生咨询'}</Text><Text className={styles.topSubtitle}>政策与数据，一处提问</Text></View></View>
          <View className={styles.topActions}><Text className={styles.connection}><Text className={styles.statusDot}>●</Text> {service}</Text><Text className={styles.sourcesToggle} onClick={() => setRightOpen(!rightOpen)}>参考资料 {sources.length ? `· ${sources.length}` : ''}</Text></View>
        </View>

        {!messages.length ? (
          <ScrollView scrollY className={styles.emptyScroll}><View className={styles.welcome}>
            <Text className={styles.eyebrow}>WHU ADMISSIONS</Text>
            <Text className={styles.welcomeTitle}>你的武大之路，<Text className={styles.green}>从这里问起。</Text></Text>
            <Text className={styles.welcomeDesc}>{'了解招生政策、查询分数位次，或比较历年招生计划。\n直接描述你的问题，助手会选择合适的查询方式。'}</Text>
            <View className={styles.quickList}>{QUICK_QUESTIONS.map((q, i) => <View key={q.id} className={styles.quickCard} onClick={() => ask(q.question)}><Text className={styles.cardLabel}>{['录取分数', '专业组投档', '招生计划', '报考政策', '数据分析', '招生章程'][i]}</Text><Text className={styles.cardQuestion}>{q.question}</Text><Text className={styles.cardArrow}>↗</Text></View>)}</View>
          </View></ScrollView>
        ) : (
          <ScrollView scrollY className={styles.messageScroll} scrollTop={scrollTop} scrollWithAnimation>
            <View className={styles.messageList}>{messages.map((msg, i) => <MessageBubble key={msg.id} message={msg} streaming={streaming && i === messages.length - 1 && msg.role === 'assistant'} onSourcesClick={openSources} />)}<View className={styles.bottomSpacer} /></View>
          </ScrollView>
        )}

        <View className={styles.composerArea}><View className={styles.composer}>
          <Textarea className={styles.textarea} value={input} onInput={(e) => setInput(e.detail.value)} placeholder="问问招生政策、分数位次或招生计划…" placeholderClass={styles.placeholder} autoHeight maxlength={1500} cursorSpacing={16} adjustPosition showConfirmBar={false} confirmType="send" onConfirm={() => ask(input)} />
          <View className={styles.composerBottom}><Text className={styles.composerHint}>{streaming ? (latest?.status || '正在生成回答…') : '通用问答 · 自动选择知识检索或数据查询'}</Text><Button className={classnames(styles.sendBtn, { [styles.sendBtnDisabled]: !input.trim() && !streaming })} disabled={!input.trim() && !streaming} onClick={() => streaming ? cancel() : ask(input)}>{streaming ? '停止' : '发送 ↑'}</Button></View>
        </View><Text className={styles.disclaimer}>回答供信息查询参考，招生事项请以对应年份的官方公告为准。</Text></View>
      </View>

      <View className={classnames(styles.rightSidebar, { [styles.rightExpanded]: rightOpen })}>
        <View className={styles.sourcesHead}><Text>参考资料</Text><Text className={styles.closeSources} onClick={() => setRightOpen(false)}>×</Text></View>
        <ScrollView scrollY className={styles.evidenceScroll}>
          {sources.length ? <View><Text className={styles.evidenceIntro}>本轮回答依据 {sources.length} 条资料</Text>{sources.map((s, i) => <View key={`${s.title}-${i}`} className={styles.sourceCard}><Text className={styles.sourceTag}>{s.kind === 'database' ? '数据库查询' : `文档 ${i + 1}`}</Text><Text className={styles.sourceTitle}>{s.title}</Text>{!!s.date && <Text className={styles.sourceDate}>{s.date}</Text>}{!!s.text && <Text className={styles.sourceExcerpt}>{s.text}</Text>}{!!s.url && <Text className={styles.sourceLink} onClick={() => openOriginal(s.url)}>查看原始文件 ↗</Text>}</View>)}</View> : <View className={styles.noSources}><Text className={styles.noSourcesIcon}>▤</Text><Text className={styles.noSourcesTitle}>每个答案，都有据可查</Text><Text>提问后，这里会展示本轮引用的招生文档或数据库查询依据。</Text></View>}
          <View className={styles.coverage}><Text className={styles.coverageTitle}>当前资料范围</Text><View><Text>分数位次</Text><Text>2018—2025</Text></View><View><Text>分专业录取</Text><Text>2019—2025</Text></View><View><Text>专业组投档</Text><Text>2022—2026</Text></View><View><Text>政策文档</Text><Text>{stats.pages ? `${stats.pages} 份` : '正在核对'}</Text></View><Text className={styles.coverageNote}>部分年份、类别仍有缺失，具体以查询结果和来源标记为准。</Text></View>
        </ScrollView>
      </View>
    </View>
  );
}

