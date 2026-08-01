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
import { AnalyticsPanel } from './components/AnalyticsPanel';
import { AchievementWall } from './components/AchievementWall';
import { ImportantPanel } from './components/ImportantPanel';
import { ScreenTimePanel } from './components/ScreenTimePanel';
import { ReminderHost } from './hooks/useReminders';
import { API } from './config';
import { localDateStr, localToday } from './utils';

export default function App() {
  const sessions = useStore(s => s.sessions);
  const activeSessionDate = useStore(s => s.activeSessionDate);
  const todaySession = sessions.find(s => s.date === activeSessionDate);
  const lastMsg = todaySession?.messages[todaySession.messages.length - 1];
  const coachOpen = useStore(s => s.coachOpen);
  const toggleCoach = useStore(s => s.toggleCoach);
  const syncActivityLogs = useStore(s => s.syncActivityLogs);
  const updateWeekStats = useCallback((updates: Partial<WeekStats>) => {
    const state = useStore.getState();
    useStore.setState({ weekStats: { ...state.weekStats, ...updates } });
  }, []);

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
        const today = localToday();
        const mapped = (data.apps || []).map((r: any) => ({
          id: `real-${r.appName}-${r.category}`, appName: r.appName, category: r.category,
          startTime: '', duration: r.duration, date: today,
        }));
        syncActivityLogs(mapped);
        const studyMinutes = data.effectiveStudyMinutes ?? (
          (data.apps || []).filter((a: any) => a.category === 'study').reduce((s: number, a: any) => s + a.duration, 0)
        );
        // 学习时长纳入连胜判定（每天 ≥30 分钟有效学习也算打卡）
        useStore.getState().recordStudyMinutes(today, studyMinutes);
        // 本周专注 = 本周一到今天的真实累计（不能拿今日值冒充周值）
        const st = useStore.getState();
        const now = new Date();
        const monday = new Date(now);
        monday.setDate(now.getDate() - (now.getDay() === 0 ? 6 : now.getDay() - 1));
        const mondayStr = localDateStr(monday);
        let weekMin = 0;
        for (const [d, m] of Object.entries(st.studyDays)) {
          if (d >= mondayStr && d <= today) weekMin += m;
        }
        updateWeekStats({ focusHours: weekMin / 60 });
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
    const today = localToday();
    const completedDates = new Set<string>();
    tasks.forEach(t => { if (t.completed) completedDates.add(t.date || today); });
    let streak = 0;
    const now = new Date();
    for (let i = 0; i < 365; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      if (completedDates.has(localDateStr(d))) streak++;
      else break;
    }
    if (streak !== state.streak) useStore.setState({ streak });
  }, []);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col relative">
        <StudyTimer />
        {trackerStatus === 'offline' && (
          <div className="bg-[#f59e0b15] border-b border-[#f59e0b40] p-[6px_16px] text-[12px] text-[#f59e0b] flex items-center justify-between">
            <span>⚠ 屏幕时间追踪未启动 — 运行 <b>StudyPet_Launcher.ps1</b></span>
            <button onClick={() => { setTrackerStatus('checking'); setRetryCount(0); }} className="p-[2px_10px] rounded-[10px] border border-[#f59e0b60] bg-transparent text-[#f59e0b] cursor-pointer text-[11px]">重试</button>
          </div>
        )}

        <ReminderHost />
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/quiz/:subject" element={<QuizPanel />} />
          <Route path="/review" element={<ReviewPanel />} />
          <Route path="/stats" element={<StatsPanel />} />
          <Route path="/tasks" element={<TaskList />} />
          <Route path="/schedule" element={<SchedulePanel />} />
          <Route path="/analytics" element={<AnalyticsPanel />} />
          <Route path="/achievements" element={<AchievementWall />} />
          <Route path="/important" element={<ImportantPanel />} />
          <Route path="/screentime" element={<ScreenTimePanel />} />
        </Routes>

        {coachOpen ? (
          <CoachPanel />
        ) : (
          <div onClick={toggleCoach} className="absolute bottom-[16px] left-1/2 -translate-x-1/2 max-w-[520px] w-[calc(100%-48px)] p-[10px_16px] rounded-[20px] bg-[var(--bg-secondary)] border border-[var(--border)] cursor-pointer flex items-center gap-[10px] shadow-[0_2px_12px_rgba(0,0,0,0.3)]">
            <div className="w-[32px] h-[32px] rounded-full bg-[linear-gradient(135deg,_#4ecca3,_#0a84ff)] flex items-center justify-center text-[16px] shrink-0">🐱</div>
            <div className="text-[12px] text-[var(--text-secondary)] overflow-hidden text-ellipsis whitespace-nowrap flex-1">
              {lastMsg?.role === 'coach' ? lastMsg.content.slice(0, 50) + (lastMsg.content.length > 50 ? '...' : '') : '🤖 AI教练在线 · 点击对话'}
            </div>
            <span className="text-[14px] text-[var(--text-muted)] shrink-0">💬</span>
          </div>
        )}
      </div>
    </div>
  );
}
