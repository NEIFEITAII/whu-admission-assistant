import React from 'react';
import { useDidShow } from '@tarojs/taro';
import { useChatStore } from '@/store/chatStore';
import './app.scss';

function App(props: { children: React.ReactNode }) {
  useDidShow(() => {
    useChatStore.getState().init();
  });

  return props.children;
}

export default App;
