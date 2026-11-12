import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useDidShow } from '@tarojs/taro';
import { useChatStore } from '@/store/chatStore';
import { formatDate } from '@/utils/format';
import styles from './index.module.scss';

export default function HistoryPage() {
  const sessions = useChatStore((s) => s.sessions);
  const init = useChatStore((s) => s.init);
  const openSession = useChatStore((s) => s.openSession);
  const deleteSession = useChatStore((s) => s.deleteSession);

  useDidShow(() => {
    init();
  });

  const handleOpen = (convUid: string) => {
    openSession(convUid);
    Taro.switchTab({ url: '/pages/chat/index' });
  };

  const handleDelete = (convUid: string, title: string) => {
    Taro.showModal({
      title: '删除会话',
      content: `确定删除「${title}」吗？`,
      confirmColor: '#f53f3f',
      success: (res) => {
        if (res.confirm) deleteSession(convUid);
      },
    });
  };

  return (
    <ScrollView scrollY className={styles.page}>
      {sessions.length === 0 ? (
        <View className={styles.empty}>
          <View className={styles.emptyIcon}>
            <View className={styles.emptyIconBubble} />
          </View>
          <Text className={styles.emptyTitle}>暂无历史会话</Text>
          <Text className={styles.emptyDesc}>去咨询页提出第一个问题吧</Text>
          <View
            className={styles.emptyBtn}
            onClick={() => Taro.switchTab({ url: '/pages/chat/index' })}
          >
            <Text className={styles.emptyBtnText}>开始咨询</Text>
          </View>
        </View>
      ) : (
        <View className={styles.list}>
          <Text className={styles.count}>共 {sessions.length} 个会话</Text>
          {sessions.map((s) => {
            const lastMsg = s.messages[s.messages.length - 1];
            const preview = lastMsg
              ? lastMsg.content.replace(/\n/g, ' ').slice(0, 50)
              : '暂无消息';
            return (
              <View
                key={s.convUid}
                className={styles.sessionCard}
                onClick={() => handleOpen(s.convUid)}
              >
                <View className={styles.sessionMain}>
                  <View className={styles.sessionTop}>
                    <Text className={styles.sessionTitle}>{s.title}</Text>
                  </View>
                  <Text className={styles.sessionPreview}>{preview}</Text>
                  <View className={styles.sessionBottom}>
                    <Text className={styles.sessionTime}>{formatDate(s.updatedAt)}</Text>
                    <Text className={styles.sessionCount}>{s.messages.length} 条消息</Text>
                  </View>
                </View>
                <View
                  className={styles.deleteBtn}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(s.convUid, s.title);
                  }}
                >
                  <Text className={styles.deleteText}>删除</Text>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </ScrollView>
  );
}
