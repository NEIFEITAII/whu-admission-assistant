import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { questions } from '@/data/questions';
import styles from './index.module.scss';

export default function QuestionsPage() {
  const handleAsk = (question: string) => {
    Taro.setStorageSync('whu_pending_question', { text: question });
    Taro.switchTab({ url: '/pages/chat/index' });
  };

  const total = questions.reduce((n, g) => n + g.items.length, 0);

  return (
    <ScrollView scrollY className={styles.page}>
      <View className={styles.header}>
        <Text className={styles.headerTitle}>常见问题题库</Text>
        <Text className={styles.headerDesc}>点击任意问题，直接发起咨询</Text>
        <View className={styles.headerBadge}>
          <Text className={styles.headerBadgeText}>
            {total} 道精选问题 · 政策与数据全覆盖
          </Text>
        </View>
      </View>

      {questions.map((group) => (
        <View key={group.category} className={styles.section}>
          <View className={styles.sectionHeader}>
            <View className={styles.sectionBar} />
            <Text className={styles.sectionTitle}>{group.category}</Text>
          </View>
          <View className={styles.card}>
            {group.items.map((item, idx) => (
              <View
                key={item.id}
                className={`${styles.questionItem} ${idx === group.items.length - 1 ? styles.lastItem : ''}`}
                onClick={() => handleAsk(item.question)}
              >
                <View className={styles.questionContent}>
                  <Text className={styles.questionText}>{item.question}</Text>
                </View>
                <View className={styles.arrowWrap}>
                  <Text className={styles.arrow}>›</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}

      <View className={styles.footer}>
        <Text className={styles.footerText}>数据范围：湖北省 2023-2024 录取数据</Text>
      </View>
    </ScrollView>
  );
}
