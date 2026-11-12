import { View, Image } from '@tarojs/components';
import classnames from 'classnames';
import logoWhu from '@/assets/logo-whu.png';
import styles from './index.module.scss';

interface Props {
  /** 显示尺寸档位：136 用于欢迎页 hero，64 用于消息气泡 */
  size?: 136 | 64;
  className?: string;
}

/**
 * 品牌标识：武汉大学校徽
 * 白色圆底衬托，避免校徽底色与深绿 hero 撞色
 * 注意：尺寸必须用 SCSS 的 rpx 类，行内 style 写 rpx 在 H5 端不会被转换
 */
export default function BrandMark({ size = 64, className }: Props) {
  return (
    <View className={classnames(styles.mark, size === 136 ? styles.lg : styles.sm, className)}>
      <Image className={styles.img} src={logoWhu} mode="aspectFill" />
    </View>
  );
}
