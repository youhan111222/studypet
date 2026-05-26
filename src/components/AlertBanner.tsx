import { useEffect, useState, useRef } from 'react';
import { useStore } from '../store/useStore';

interface Alert {
  id: string;
  type: 'ddl_conflict' | 'procrastination' | 'efficiency_drop' | 'focus_reminder';
  title: string;
  message: string;
  timestamp: number;
}

export function AlertBanner() {
  const tasks = useStore(s => s.tasks);
  const activityLogs = useStore(s => s.activityLogs);
  const autoPlan = useStore(s => s.autoPlan);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [focusMode, setFocusMode] = useState(false);
  const lastCheckRef = useRef<number>(0);
  const synthRef = useRef<SpeechSynthesis | null>(null);

  useEffect(() => {
    synthRef.current = window.speechSynthesis;
    return () => { synthRef.current?.cancel(); };
  }, []);

  const speak = (text: string) => {
    if (!synthRef.current) return;
    synthRef.current.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.0;
    u.pitch = 1.1;
    synthRef.current.speak(u);
  };

  const notify = (title: string, body: string) => {
    if (Notification.permission === 'granted') {
      new Notification(title, { body, icon: '🐱' });
    }
    speak(body);
  };

  useEffect(() => {
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  useEffect(() => {
    const checkAlerts = () => {
      const now = Date.now();
      if (now - lastCheckRef.current < 30000) return;
      lastCheckRef.current = now;

      const remaining = tasks.filter(t => !t.completed);
      const newAlerts: Alert[] = [];

      // DDL 冲突检查
      const ddlTasks = remaining.filter(t => t.deadline);
      const urgentDdl = ddlTasks.filter(t =>
        t.deadline?.includes('今天') || t.deadline?.includes('明天')
      );
      if (urgentDdl.length >= 2) {
        const names = urgentDdl.map(t => t.title).join('、');
        const alert: Alert = {
          id: `ddl-${now}`,
          type: 'ddl_conflict',
          title: '⚠️ DDL 冲突预警',
          message: `${names} 都临近截止！马上打开 AI 教练制定优先级方案`,
          timestamp: now,
        };
        newAlerts.push(alert);
        notify('DDL 冲突预警', `${names} 都在今天/明天截止，需要立即行动！`);
      }

      // 拖延检查
      const overdueTasks = remaining.filter(t =>
        t.deadline && (t.deadline.includes('今天') || t.deadline.includes('昨天'))
      );
      if (overdueTasks.length > 0 && autoPlan) {
        const alert: Alert = {
          id: `proc-${now}`,
          type: 'procrastination',
          title: '⏰ 拖延警告',
          message: `${overdueTasks.map(t => t.title).join('、')} 已超期，立即开始！`,
          timestamp: now,
        };
        newAlerts.push(alert);
        notify('拖延警告', `你还有 ${overdueTasks.length} 个任务已超期，不要再拖了！`);
      }

      // 效率下降检查
      const todayDate = new Date().toISOString().slice(0, 10);
      const todayStudy = activityLogs
        .filter(l => l.date === todayDate && l.category === 'study')
        .reduce((s, l) => s + l.duration * 60, 0);
      const recentLogs = activityLogs.filter(l => l.date !== todayDate).slice(-3);
      const recentStudySec = recentLogs.filter(l => l.category === 'study').reduce((s, l) => s + l.duration * 60, 0);
      const avgStudy = recentLogs.length > 0 ? recentStudySec / recentLogs.length : 0;

      if (todayStudy > 0 && avgStudy > 3600 && todayStudy < avgStudy * 0.5) {
        const alert: Alert = {
          id: `eff-${now}`,
          type: 'efficiency_drop',
          title: '📉 学习效率下降',
          message: `今日学习时长仅 ${Math.floor(todayStudy / 60)} 分钟，远低于过去均值 ${Math.floor(avgStudy / 60)} 分钟`,
          timestamp: now,
        };
        newAlerts.push(alert);
      }

      if (newAlerts.length > 0) {
        setAlerts(prev => [...prev, ...newAlerts].slice(-5));
      }
    };

    checkAlerts();
    const interval = setInterval(checkAlerts, 30000);
    return () => clearInterval(interval);
  }, [tasks, activityLogs, autoPlan]);

  const dismiss = (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  const dismissAll = () => setAlerts([]);

  const toggleFocusMode = () => {
    setFocusMode(prev => {
      const newVal = !prev;
      if (newVal) {
        speak('专注模式已开启，娱乐应用将被锁定');
        notify('🔒 专注模式', '已锁定娱乐应用，直到你手动关闭');
        
        // 记录专注开始时间到 localStorage
        localStorage.setItem('focusModeStart', Date.now().toString());
        localStorage.setItem('focusModeActive', 'true');
        
        // 设置定时检查（每5秒检查一次）
        const checkInterval = setInterval(() => {
          const startTime = parseInt(localStorage.getItem('focusModeStart') || '0');
          const currentTime = Date.now();
          const elapsedMinutes = Math.floor((currentTime - startTime) / 60000);
          
          // 每30分钟提醒一次进度
          if (elapsedMinutes > 0 && elapsedMinutes % 30 === 0) {
            speak(`专注模式已持续 ${elapsedMinutes} 分钟，继续保持！`);
          }
        }, 5000);
        
        // 存储 interval ID 以便清理
        localStorage.setItem('focusModeInterval', checkInterval.toString());
        
        // 阻止访问娱乐网站（通过监听 beforeunload 和 visibilitychange）
        const blockEntertainment = (e: BeforeUnloadEvent) => {
          const blockedSites = [
            'bilibili.com', 'douyin.com', 'weibo.com', 'tiktok.com',
            'youtube.com', 'netflix.com', 'twitter.com', 'facebook.com',
            'instagram.com', 'reddit.com'
          ];
          
          const currentUrl = window.location.href;
          if (blockedSites.some(site => currentUrl.includes(site))) {
            e.preventDefault();
            e.returnValue = '专注模式期间禁止访问娱乐网站！';
            return '专注模式期间禁止访问娱乐网站！';
          }
        };
        
        window.addEventListener('beforeunload', blockEntertainment);
        localStorage.setItem('focusModeListener', 'true');
        
      } else {
        speak('专注模式已关闭');
        notify('🔓 专注模式已关闭', '娱乐应用已解锁');
        
        // 清理专注模式数据
        localStorage.removeItem('focusModeStart');
        localStorage.removeItem('focusModeActive');
        
        // 清除定时器
        const intervalId = parseInt(localStorage.getItem('focusModeInterval') || '0');
        if (intervalId) clearInterval(intervalId);
        localStorage.removeItem('focusModeInterval');
        
        // 移除事件监听器
        window.removeEventListener('beforeunload', () => {});
        localStorage.removeItem('focusModeListener');
      }
      return newVal;
    });
  };

  if (alerts.length === 0 && !focusMode) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 12px',
      pointerEvents: 'none',
    }}>
      <div style={{
        display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap',
        pointerEvents: 'auto',
      }}>
        {focusMode && (
          <div style={{
            padding: '8px 16px', borderRadius: 8,
            background: 'linear-gradient(135deg, rgba(233,69,96,0.9), rgba(255,107,107,0.9))',
            color: '#fff', fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 10,
            boxShadow: '0 4px 16px rgba(233,69,96,0.3)',
          }}>
            🔒 专注模式 · 娱乐已锁定
            <button onClick={toggleFocusMode} style={{
              padding: '3px 10px', borderRadius: 4,
              background: 'rgba(255,255,255,0.2)', color: '#fff',
              fontSize: 11, border: '1px solid rgba(255,255,255,0.3)',
            }}>关闭</button>
          </div>
        )}

        {alerts.map(alert => (
          <div key={alert.id} style={{
            padding: '8px 14px', borderRadius: 8,
            background: alert.type === 'ddl_conflict'
              ? 'linear-gradient(135deg, rgba(233,69,96,0.9), rgba(255,107,107,0.9))'
              : alert.type === 'procrastination'
              ? 'linear-gradient(135deg, rgba(255,140,0,0.9), rgba(255,165,0,0.9))'
              : 'linear-gradient(135deg, rgba(10,132,255,0.9), rgba(78,204,163,0.9))',
            color: '#fff', fontSize: 12, fontWeight: 500,
            display: 'flex', alignItems: 'center', gap: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            animation: 'slideIn 0.3s ease',
          }}>
            <span>{alert.title}</span>
            <span style={{ opacity: 0.9, fontSize: 11 }}>{alert.message}</span>
            <button onClick={() => dismiss(alert.id)} style={{
              background: 'rgba(255,255,255,0.2)', color: '#fff',
              fontSize: 12, padding: '2px 6px', borderRadius: 4,
              border: 'none', marginLeft: 4,
            }}>×</button>
          </div>
        ))}

        {alerts.length > 1 && (
          <button onClick={dismissAll} style={{
            padding: '8px 14px', borderRadius: 8,
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', fontSize: 11,
            backdropFilter: 'blur(8px)',
          }}>全部忽略</button>
        )}
      </div>

      {!focusMode && alerts.length === 0 && (
        <div style={{
          display: 'flex', justifyContent: 'center', pointerEvents: 'auto',
        }}>
          <button onClick={toggleFocusMode} style={{
            padding: '6px 14px', borderRadius: 16,
            background: 'rgba(255,255,255,0.08)', border: '1px solid var(--border)',
            color: 'var(--text-secondary)', fontSize: 11,
            backdropFilter: 'blur(8px)',
          }}>🔒 开启专注模式</button>
        </div>
      )}
    </div>
  );
}