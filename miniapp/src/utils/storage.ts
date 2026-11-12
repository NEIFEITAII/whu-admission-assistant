import Taro from '@tarojs/taro';
import { ChatSession } from '@/types/chat';

const SESSIONS_KEY = 'whu_sessions_v1';

export function loadSessions(): ChatSession[] {
  try {
    const raw = Taro.getStorageSync(SESSIONS_KEY);
    if (Array.isArray(raw)) return raw;
  } catch (e) {
    console.error('[Storage] loadSessions error', e);
  }
  return [];
}

export function saveSessions(sessions: ChatSession[]) {
  try {
    Taro.setStorageSync(SESSIONS_KEY, sessions);
  } catch (e) {
    console.error('[Storage] saveSessions error', e);
  }
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
