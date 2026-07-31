import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { API } from '../config';
import type { ActivityLog } from '../types';

const catColors: Record<string, string> = {
  study: 'var(--accent)',
  entertainment: 'var(--red-soft)',
  social: '#0a84ff',
  other: 'var(--text-muted)',
  idle: 'var(--text-muted)',
};

const catLabels: Record<string, string> = {
  study: '学习',
  entertainment: '娱乐',
  social: '社交',
  other: '其他',
  idle: '空闲',
};

interface RealActivity {
  appName: string;
  category: string;
  duration: number;
  sessions: number;
  title: string;
}

interface StatsResponse {
  apps: RealActivity[];
  categories: Record<string, number>;
  idleMinutes: number;
  totalActiveMinutes: number;
  date: string;
}

export function ActivityTracker() {
  const activityLogs = useStore(s => s.activityLogs);
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [trackerRunning, setTrackerRunning] = useState(false);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${API}/activity/stats`);
        const data: StatsResponse = await res.json();
        if (data.apps.length > 0 || data.idleMinutes > 0) {
          setTrackerRunning(true);
          setStats(data);
          // 不在此处 syncActivityLogs，由 App.tsx 全局统一同步，避免数据竞争
        }
      } catch {}
    };
    poll();
    const iv = setInterval(poll, 5000);
    return () => clearInterval(iv);
  }, []);

  const useReal = stats !== null;
  const logs = useReal
    ? stats.apps.map((r, i) => ({
        id: `r-${i}`,
        appName: r.appName,
        category: r.category as ActivityLog['category'],
        startTime: '',
        duration: r.duration,
        date: stats.date,
      }))
    : activityLogs;

  const totalActive = useReal ? stats.totalActiveMinutes : logs.reduce((s, l) => s + l.duration, 0);
  const idleMinutes = useReal ? stats.idleMinutes : 0;
  const totalAll = totalActive + idleMinutes;

  const studyMin = useReal ? (stats.categories['study'] || 0) : logs.filter(l => l.category === 'study').reduce((s, l) => s + l.duration, 0);
  const entMin = useReal ? (stats.categories['entertainment'] || 0) : logs.filter(l => l.category === 'entertainment').reduce((s, l) => s + l.duration, 0);
  const socialMin = useReal ? (stats.categories['social'] || 0) : logs.filter(l => l.category === 'social').reduce((s, l) => s + l.duration, 0);
  const otherMin = useReal ? (stats.categories['other'] || 0) : logs.filter(l => l.category === 'other').reduce((s, l) => s + l.duration, 0);

  const groups: Record<string, { total: number; logs: typeof logs }> = {};
  for (const l of logs) {
    const key = l.appName;
    if (!groups[key]) groups[key] = { total: 0, logs: [] };
    groups[key].total += l.duration;
    groups[key].logs.push(l);
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '20px 24px', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>屏幕活动追踪</h2>
          <span style={{
            fontSize: 10,
            color: useReal ? 'var(--accent)' : 'var(--text-muted)',
          }}>
            {useReal ? '● 实时采集 · 每5秒刷新' : '○ 演示数据 · 启动 tracker.py 接入真实数据'}
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
        {[
          { cat: 'study', value: studyMin, icon: '📖' },
          { cat: 'entertainment', value: entMin, icon: '🎮' },
          { cat: 'social', value: socialMin, icon: '💬' },
          { cat: 'other', value: otherMin, icon: '📂' },
        ].map(item => (
          <div key={item.cat} style={{
            flex: 1, padding: 14, borderRadius: 8,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 20 }}>{item.icon}</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: catColors[item.cat], marginTop: 4 }}>
              {Math.floor(item.value / 60)}h {item.value % 60}m
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{catLabels[item.cat]}</div>
            <div style={{
              height: 3, background: 'var(--border)', borderRadius: 2, marginTop: 6, overflow: 'hidden',
            }}>
              <div style={{
                width: `${totalAll > 0 ? (item.value / totalAll) * 100 : 0}%`,
                height: '100%', background: catColors[item.cat], borderRadius: 2,
              }} />
            </div>
          </div>
        ))}
        <div style={{
          flex: 1, padding: 14, borderRadius: 8,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: 20 }}>⏰</div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>
            {Math.floor(totalAll / 60)}h {totalAll % 60}m
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>总时长（含空闲）</div>
        </div>
        {useReal && idleMinutes > 0 && (
          <div style={{
            flex: 1, padding: 14, borderRadius: 8,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            textAlign: 'center',
          }}>
            <div style={{ fontSize: 20 }}>💤</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-muted)', marginTop: 4 }}>
              {Math.floor(idleMinutes / 60)}h {idleMinutes % 60}m
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>空闲（离开电脑）</div>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflowY: 'auto' }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>
          应用详情（按进程合并）
        </h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(groups).sort((a, b) => b[1].total - a[1].total).map(([name, group]) => {
            const cat = group.logs[0]?.category || 'other';
            const pct = totalAll > 0 ? Math.round((group.total / totalAll) * 100) : 0;
            return (
              <div key={name} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 12px', borderRadius: 8,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: catColors[cat], flexShrink: 0,
                }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 500 }}>{name}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                    {catLabels[cat]} · {useReal ? `${group.logs.length} 个会话` : `${group.logs.length} 条记录`}
                  </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: catColors[cat] }}>
                  {Math.floor(group.total / 60)}h {group.total % 60}m
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{pct}%</div>
              </div>
            );
          })}
          {Object.keys(groups).length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 13 }}>
              {useReal ? '暂无活动数据，等待窗口切换...' : '暂无数据'}
            </div>
          )}
        </div>
      </div>

      {!useReal && (
        <div style={{
          marginTop: 12, padding: 10, borderRadius: 8,
          background: 'rgba(10,132,255,0.1)', border: '1px solid rgba(10,132,255,0.2)',
          fontSize: 11, color: 'var(--text-secondary)',
        }}>
          提示：运行 <code style={{ color: 'var(--accent)' }}>python tracker.py</code> 启动真实屏幕活动追踪，数据实时写入 SQLite 并由 API 服务提供。
        </div>
      )}
    </div>
  );
}