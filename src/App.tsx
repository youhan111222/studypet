import { useEffect, useState, useCallback, useRef } from 'react';
import { useStore } from './store/useStore';
import type { WeekStats } from './types';
import { Sidebar } from './components/Sidebar';
import { TaskList } from './components/TaskList';
import { AchievementWall } from './components/AchievementWall';
import { CoachPanel } from './components/CoachPanel';
import { SchedulePanel } from './components/SchedulePanel';
import { ActivityTracker } from './components/ActivityTracker';
import { ScreenTimePanel } from './components/ScreenTimePanel';
import { ImportantPanel } from './components/ImportantPanel';
import { AlertBanner } from './components/AlertBanner';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { StudyTimer } from './components/StudyTimer';

const API = '';  // 走 Vite 代理

export default function App() {
  const activeView = useStore(s => s.activeView);
  const coachOpen = useStore(s => s.coachOpen);
  const toggleCoach = useStore(s => s.toggleCoach);
  const messages = useStore(s => s.messages);
  const syncActivityLogs = useStore(s => s.syncActivityLogs);
  const updateWeekStats = useStore(s => (updates: Partial<WeekStats>) => {
    const state = useStore.getState();
    useStore.setState({ weekStats: { ...state.weekStats, ...updates } });
  });
  const lastMsg = messages[messages.length - 1];

  // 追踪服务状态 (checking → online/offline)
  const [trackerStatus, setTrackerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [retryCount, setRetryCount] = useState(0);
  const MAX_FAST_RETRIES = 3;

  // 启动时健康检查：快速重试 3 次（间隔 2s），之后降级为慢速轮询
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${API}/activity/stats`, { signal: AbortSignal.timeout(3000) });
        if (res.ok) {
          setTrackerStatus('online');
          return;
        }
      } catch {}
      setRetryCount(c => c + 1);
    };
    check();
  }, [retryCount]);

  useEffect(() => {
    if (trackerStatus !== 'checking' || retryCount >= MAX_FAST_RETRIES) return;
    const t = setTimeout(() => setRetryCount(c => c + 1), 2000);
    return () => clearTimeout(t);
  }, [retryCount, trackerStatus]);

  // 快速重试耗尽 → 降级为慢速轮询（30s 间隔），由 syncLoop 驱动恢复
  useEffect(() => {
    if (retryCount >= MAX_FAST_RETRIES && trackerStatus === 'checking') {
      setTrackerStatus('offline');
    }
  }, [retryCount, trackerStatus]);

  // 用 ref 存储 trackerStatus，避免 syncLoop 依赖变化导致 interval 重建
  const trackerStatusRef = useRef(trackerStatus);
  trackerStatusRef.current = trackerStatus;

  // 全局同步真实活动数据到 store，供 CoachPanel、AnalyticsPanel 等使用
  const syncLoop = useCallback(async () => {
    try {
      const res = await fetch(`${API}/activity/stats`);
      const data = await res.json();
      if (data && (data.apps || data.totalActiveMinutes !== undefined)) {
        if (trackerStatusRef.current !== 'online') setTrackerStatus('online');
        const today = new Date().toISOString().slice(0, 10);
        const mapped = (data.apps || []).map((r: any, i: number) => ({
          id: `real-${i}`,
          appName: r.appName,
          category: r.category,
          startTime: '',
          duration: r.duration,
          date: today,
        }));
        syncActivityLogs(mapped);

        const studyMinutes = (data.apps || [])
          .filter((a: any) => a.category === 'study')
          .reduce((sum: number, a: any) => sum + a.duration, 0);
        const focusHours = studyMinutes / 60;
        updateWeekStats({ focusHours });
      }
    } catch {
      if (trackerStatusRef.current === 'online') setTrackerStatus('offline');
    }
  }, [syncActivityLogs, updateWeekStats]);

  useEffect(() => {
    syncLoop();
    const iv = setInterval(syncLoop, 30000);
    return () => clearInterval(iv);
  }, [syncLoop]);

  // 应用挂载时重新校准 streak（修复 persist 可能保存的过期值）
  useEffect(() => {
    const state = useStore.getState();
    const tasks = state.tasks;
    const today = new Date().toISOString().slice(0, 10);
    // 收集所有有完成记录的任务的日期集合
    const completedDates = new Set<string>();
    tasks.forEach(t => {
      if (t.completed) completedDates.add(t.date || today);
    });
    // 重新从今天往回计算连续天数
    let streak = 0;
    const now = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      if (completedDates.has(dateStr)) streak++;
      else break;
    }
    if (streak !== state.streak) {
      useStore.setState({ streak });
    }
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <AlertBanner />
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <StudyTimer />
        {/* 追踪服务离线提示 */}
        {trackerStatus === 'offline' && (
          <div style={{
            background: '#f59e0b15', borderBottom: '1px solid #f59e0b40',
            padding: '6px 16px', fontSize: 12, color: '#f59e0b',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>⚠ 屏幕时间追踪未启动 — 请运行 <b>start_all.bat</b> 或执行 <b>python tracker.py &amp;&amp; python api_server.py</b></span>
            <button onClick={() => { setTrackerStatus('checking'); setRetryCount(0); }} style={{
              padding: '2px 10px', borderRadius: 10, border: '1px solid #f59e0b60',
              background: 'transparent', color: '#f59e0b', cursor: 'pointer', fontSize: 11,
            }}>重试</button>
          </div>
        )}
        {activeView === 'tasks' && <TaskList />}
        {activeView === 'important' && <ImportantPanel />}
        {activeView === 'achievements' && <AchievementWall />}
        {activeView === 'schedule' && <SchedulePanel />}
        {activeView === 'tracking' && <ActivityTracker />}
        {activeView === 'screentime' && <ScreenTimePanel />}
        {activeView === 'analytics' && <AnalyticsPanel />}

        {coachOpen ? (
          <CoachPanel />
        ) : (
          <div onClick={toggleCoach} style={{
            position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
            maxWidth: 520, width: 'calc(100% - 48px)',
            padding: '10px 16px', borderRadius: 20,
            background: 'var(--bg-secondary)', border: '1px solid var(--border)',
            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 2px 12px rgba(0,0,0,0.3)',
          }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%',
              background: 'linear-gradient(135deg, #4ecca3, #0a84ff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, flexShrink: 0,
            }}>🐱</div>
            <div style={{
              fontSize: 12, color: 'var(--text-secondary)',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
            }}>
              {lastMsg?.role === 'coach' ? lastMsg.content.slice(0, 50) + (lastMsg.content.length > 50 ? '...' : '') : '🤖 AI教练在线 · 点击对话'}
            </div>
            <span style={{ fontSize: 14, color: 'var(--text-muted)', flexShrink: 0 }}>💬</span>
          </div>
        )}
      </div>
    </div>
  );
}