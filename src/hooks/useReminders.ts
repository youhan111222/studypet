import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';

/**
 * 常驻提醒 hook：与页面是否打开「重要事项」面板无关。
 * 每 30 秒扫描 store 中未完成且设置了 remindAt 的重要事项，
 * 当前时间与 remindAt（HH:MM）相差 ≤1 分钟时触发提醒：
 *   1. 浏览器 Notification（权限已授予时）
 *   2. 页面级 toast（直接挂到 document.body，不依赖任何组件）
 * 同日同一条事项只提醒一次（useRef 集合去重）。
 */
export function useReminders() {
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const check = () => {
      const now = new Date();
      const nowMin = now.getHours() * 60 + now.getMinutes();
      const dateKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
      const items = useStore.getState().importantItems;
      for (const item of items) {
        if (item.done || !item.remindAt) continue;
        const [h, m] = item.remindAt.split(':').map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) continue;
        if (Math.abs(nowMin - (h * 60 + m)) > 1) continue;
        const key = `${item.id}@${dateKey}`;
        if (firedRef.current.has(key)) continue;
        firedRef.current.add(key);
        // 通道 1：浏览器通知（权限已授予时）
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          try { new Notification('StudyPet 提醒', { body: item.title }); } catch { /* 通知被拦截时忽略 */ }
        }
        // 通道 2：document 级 toast（不依赖组件，切页也生效）
        showDocumentToast(item.title);
      }
    };
    check();
    const id = window.setInterval(check, 30000);
    return () => window.clearInterval(id);
  }, []);
}

/** 页面级 toast：直接创建 DOM 挂到 body，6 秒后自动移除 */
function showDocumentToast(title: string) {
  try {
    const el = document.createElement('div');
    el.textContent = `⏰ ${title}`;
    el.style.cssText = [
      'position:fixed',
      'right:16px',
      'bottom:16px',
      'zIndex:9999',
      'padding:10px 16px',
      'borderRadius:10px',
      'fontSize:13px',
      'background:var(--bg-card,#fff)',
      'border:1px solid var(--border-strong,rgba(120,120,120,0.5))',
      'boxShadow:0 4px 16px rgba(0,0,0,0.3)',
      'pointerEvents:none',
    ].join(';');
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 6000);
  } catch { /* DOM 操作被拦截时忽略 */ }
}

/**
 * 挂载宿主：主任务在 App.tsx 顶层（Routes 外层）渲染 <ReminderHost /> 即可，
 * 内部调用 useReminders()，本身不渲染任何 UI。
 */
export function ReminderHost() {
  useReminders();
  return null;
}
