import { useEffect, useState, useCallback, useRef } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import type { WeekStats } from './types';
import { Sidebar } from './components/Sidebar';
import { CoachPanel } from './components/CoachPanel';
import { StudyTimer } from './components/StudyTimer';
import { Dashboard } from './components/Dashboard';
import { QuizPanel } from './components/QuizPanel';
import { ReviewPanel } from './components/ReviewPanel';
import { StatsPanel } from './components/StatsPanel';
import { TaskList } from './components/TaskList';
import { SchedulePanel } from './components/SchedulePanel';
import { ActivityTracker } from './components/ActivityTracker';
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { AchievementWall } from './components/AchievementWall';
import { ImportantPanel } from './components/ImportantPanel';
import { ScreenTimePanel } from './components/ScreenTimePanel';
import { API } from './config';

export default function App() {
  const sessions = useStore(s => s.sessions);
  const activeSessionDate = useStore(s => s.activeSessionDate);
  const todaySession = sessions.find(s => s.date === activeSessionDate);
  const lastMsg = todaySession?.messages[todaySession.messages.length - 1];
  const coachOpen = useStore(s => s.coachOpen);
  const toggleCoach = useStore(s => s.toggleCoach);
  const syncActivityLogs = useStore(s => s.syncActivityLogs);
  const updateWeekStats = useStore(s => (updates: Partial<WeekStats>) => {
    const state = useStore.getState();
    useStore.setState({ weekStats: { ...state.weekStats, ...updates } });
  });

  const [trackerStatus, setTrackerStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [retryCount, setRetryCount] = useState(0);
  const MAX_FAST_RETRIES = 10;

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch(`${API}/activity/stats`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) { setTrackerStatus('online'); return; }
      } catch {}
      setRetryCount(c => c + 1);
    };
    check();
  }, [retryCount]);

  useEffect(() => {
    if (trackerStatus !== 'checking' || retryCount >= MAX_FAST_RETRIES) return;
    const t = setTimeout(() => setRetryCount(c => c + 1), 3000);
    return () => clearTimeout(t);
  }, [retryCount, trackerStatus]);

  useEffect(() => {
    if (retryCount >= MAX_FAST_RETRIES && trackerStatus === 'checking') setTrackerStatus('offline');
  }, [retryCount, trackerStatus]);

  const trackerStatusRef = useRef(trackerStatus);
  trackerStatusRef.current = trackerStatus;

  const syncLoop = useCallback(async () => {
    try {
      const res = await fetch(`${API}/activity/stats`);
      const data = await res.json();
      if (data?.apps || data?.totalActiveMinutes !== undefined) {
        if (trackerStatusRef.current !== 'online') setTrackerStatus('online');
        const today = new Date().toISOString().slice(0, 10);
        const mapped = (data.apps || []).map((r: any, i: number) => ({
          id: `real-${i}`, appName: r.appName, category: r.category,
          startTime: '', duration: r.duration, date: today,
        }));
        syncActivityLogs(mapped);
        const studyMinutes = data.effectiveStudyMinutes ?? (
          (data.apps || []).filter((a: any) => a.category === 'study').reduce((s: number, a: any) => s + a.duration, 0)
        );
        updateWeekStats({ focusHours: studyMinutes / 60 });
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

  useEffect(() => {
    const state = useStore.getState();
    const tasks = state.tasks;
    const today = new Date().toISOString().slice(0, 10);
    const completedDates = new Set<string>();
    tasks.forEach(t => { if (t.completed) completedDates.add(t.date || today); });
    let streak = 0;
    const now = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      if (completedDates.has(d.toISOString().slice(0, 10))) streak++;
      else break;
    }
    if (streak !== state.streak) useStore.setState({ streak });
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', position: 'relative' }}>
        <StudyTimer />
        {trackerStatus === 'offline' && (
          <div style={{
            background: '#f59e0b15', borderBottom: '1px solid #f59e0b40',
            padding: '6px 16px', fontSize: 12, color: '#f59e0b',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span>⚠ 屏幕时间追踪未启动 — 运行 <b>StudyPet_Launcher.ps1</b></span>
            <button onClick={() => { setTrackerStatus('checking'); setRetryCount(0); }} style={{
              padding: '2px 10px', borderRadius: 10, border: '1px solid #f59e0b60',
              background: 'transparent', color: '#f59e0b', cursor: 'pointer', fontSize: 11,
            }}>重试</button>
          </div>
        )}

        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/quiz/:subject" element={<QuizPanel />} />
          <Route path="/review" element={<ReviewPanel />} />
          <Route path="/stats" element={<StatsPanel />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/schedule" element={<SchedulePanel />} />
          <Route path="/tracking" element={<ActivityTracker />} />
          <Route path="/analytics" element={<AnalyticsPanel />} />
          <Route path="/achievements" element={<AchievementWall />} />
          <Route path="/important" element={<ImportantPanel />} />
          <Route path="/screentime" element={<ScreenTimePanel />} />
        </Routes>

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
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
              flexShrink: 0,
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
