import Taro from '@tarojs/taro';
import { View, Text } from '@tarojs/components';
import classnames from 'classnames';
import { ChatMessage } from '@/types/chat';
import MarkdownText from '@/components/MarkdownText';
import BrandMark from '@/components/BrandMark';
import styles from './index.module.scss';

interface Props {
  message: ChatMessage;
  streaming?: boolean;
  onSourcesClick?: (message: ChatMessage) => void;
}

export default function MessageBubble({ message, streaming, onSourcesClick }: Props) {
  // 系统提示：居中浅色小胶囊（模式切换等）
  if (message.role === 'system') {
    return (
      <View className={styles.noticeRow}>
        <Text className={styles.noticeText}>{message.content}</Text>
      </View>
    );
  }

  const isUser = message.role === 'user';
  const isDb = message.mode === 'chat_with_db_execute';

  return (
    <View
      className={classnames(styles.messageRow, {
        [styles.userRow]: isUser,
        [styles.assistantRow]: !isUser,
      })}
    >
      {!isUser && (
        <View className={styles.avatarSlot}>
          <BrandMark size={32} />
        </View>
      )}

      <View className={styles.bubbleWrap}>
        <View
          className={classnames(styles.bubble, {
            [styles.userBubble]: isUser,
            [styles.assistantBubble]: !isUser,
            [styles.errorBubble]: message.error,
          })}
        >
          {isUser ? (
            <Text className={styles.userText}>{message.content}</Text>
          ) : (
            <View className={styles.assistantContent}>
              {message.content ? (
                <MarkdownText content={message.content} />
              ) : streaming ? (
                <View className={styles.typing}>
                  <View className={styles.dot} />
                  <View className={styles.dot} />
                  <View className={styles.dot} />
                  <Text className={styles.typingHint}>
                    {message.status || (isDb ? '正在查询数据库…' : '正在检索知识库…')}
                  </Text>
                </View>
              ) : null}
              {streaming && !!message.content && (
                <View className={styles.cursor} />
              )}
            </View>
          )}
        </View>
        {!isUser && !!message.content && !streaming && <View className={styles.answerActions}>
          <Text onClick={() => Taro.setClipboardData({ data: message.content })}>复制回答</Text>
          {!!message.sources?.length && <Text onClick={() => onSourcesClick?.(message)}>查看 {message.sources.length} 条依据 ↗</Text>}
          {typeof message.seconds === 'number' && <Text>{message.seconds} 秒</Text>}
        </View>}
      </View>

      {isUser && (
        <View className={classnames(styles.avatar, styles.avatarUser)}>
          <Text className={styles.avatarText}>我</Text>
        </View>
      )}
    </View>
  );
}

