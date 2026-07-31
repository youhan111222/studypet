import { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { API } from '../config';
import type { ActivityLog } from '../types';

const catColors: Record<string, string> = {
  study: 'var(--accent)',
  dev: '#61afef',
  tools: '#8a8a8a',
  system: '#6b6b6b',
  browser: '#0a84ff',
  entertainment: 'var(--red-soft)',
  social: '#ffa726',
  other: 'var(--text-muted)',
  idle: 'var(--text-muted)',
};

const catLabels: Record<string, string> = {
  study: '学习',
  dev: '开发',
  tools: '工具',
  system: '系统',
  browser: '浏览器',
  entertainment: '娱乐',
  social: '社交',
  other: '其他',
  idle: '空闲',
};

const catIcons: Record<string, string> = {
  study: '📖', dev: '💻', tools: '🔧', system: '🖥️',
  browser: '🌐', entertainment: '🎮', social: '💬', other: '📂', idle: '💤',
};

const catOrder = ['study', 'dev', 'entertainment', 'social', 'tools', 'system', 'browser', 'other'];

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

  const groups: Record<string, { total: number; logs: typeof logs }> = {};
  for (const l of logs) {
    const key = l.appName;
    if (!groups[key]) groups[key] = { total: 0, logs: [] };
    groups[key].total += l.duration;
    groups[key].logs.push(l);
  }

  return (
    <div className="flex-1 flex flex-col p-[20px_24px] overflow-hidden">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-[18px] font-semibold m-0">屏幕活动追踪</h2>
          <span className={`text-[10px] ${useReal ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]'}`}>
            {useReal ? '● 实时采集 · 每5秒刷新' : '○ 演示数据 · 启动 tracker.py 接入真实数据'}
          </span>
        </div>
      </div>

      <div className="flex gap-3 mb-5 flex-wrap">
        {catOrder.filter(cat => (stats?.categories && (stats.categories[cat] || 0) > 0) || (!useReal && logs.some(l => l.category === cat))).map(cat => (
          <div key={cat} className="flex-1 min-w-[100px] p-[14px] rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-center">
            <div className="text-[20px]">{catIcons[cat]}</div>
            <div className="text-[16px] font-bold mt-1" style={{ color: catColors[cat] }}>
              {Math.floor((stats?.categories?.[cat] || logs.filter(l => l.category === cat).reduce((s, l) => s + l.duration, 0)) / 60)}h {(stats?.categories?.[cat] || logs.filter(l => l.category === cat).reduce((s, l) => s + l.duration, 0)) % 60}m
            </div>
            <div className="text-[11px] text-[var(--text-secondary)]">{catLabels[cat]}</div>
            <div className="h-[3px] bg-[var(--border)] rounded-sm mt-[6px] overflow-hidden">
              <div
                className="h-full rounded-sm"
                style={{
                  width: `${totalAll > 0 ? ((stats?.categories?.[cat] || logs.filter(l => l.category === cat).reduce((s, l) => s + l.duration, 0)) / totalAll) * 100 : 0}%`,
                  background: catColors[cat],
                }}
              />
            </div>
          </div>
        ))}
        <div className="flex-1 p-[14px] rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-center">
          <div className="text-[20px]">⏰</div>
          <div className="text-[16px] font-bold mt-1 text-[var(--text-primary)]">
            {Math.floor(totalAll / 60)}h {totalAll % 60}m
          </div>
          <div className="text-[11px] text-[var(--text-secondary)]">总时长（含空闲）</div>
        </div>
        {useReal && idleMinutes > 0 && (
          <div className="flex-1 p-[14px] rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-center">
            <div className="text-[20px]">💤</div>
            <div className="text-[16px] font-bold mt-1 text-[var(--text-muted)]">
              {Math.floor(idleMinutes / 60)}h {idleMinutes % 60}m
            </div>
            <div className="text-[11px] text-[var(--text-secondary)]">空闲（离开电脑）</div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        <h3 className="text-[14px] font-semibold mb-[10px]">
          应用详情（按进程合并）
        </h3>
        <div className="flex flex-col gap-[6px]">
          {Object.entries(groups).sort((a, b) => b[1].total - a[1].total).map(([name, group]) => {
            const cat = group.logs[0]?.category || 'other';
            const pct = totalAll > 0 ? Math.round((group.total / totalAll) * 100) : 0;
            return (
              <div key={name} className="flex items-center gap-[10px] px-3 py-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)]">
                <div className="w-2 h-2 rounded-full shrink-0" style={{ background: catColors[cat] }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-medium">{name}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">
                    {catLabels[cat]} · {useReal ? `${group.logs.length} 个会话` : `${group.logs.length} 条记录`}
                  </div>
                </div>
                <div className="text-[12px] font-semibold" style={{ color: catColors[cat] }}>
                  {Math.floor(group.total / 60)}h {group.total % 60}m
                </div>
                <div className="text-[11px] text-[var(--text-muted)]">{pct}%</div>
              </div>
            );
          })}
          {Object.keys(groups).length === 0 && (
            <div className="text-center py-10 text-[var(--text-muted)] text-[13px]">
              {useReal ? '暂无活动数据，等待窗口切换...' : '暂无数据'}
            </div>
          )}
        </div>
      </div>

      {!useReal && (
        <div className="mt-3 p-[10px] rounded-lg bg-[rgba(10,132,255,0.1)] border border-[rgba(10,132,255,0.2)] text-[11px] text-[var(--text-secondary)]">
          提示：运行 <code className="text-[var(--accent)]">python tracker.py</code> 启动真实屏幕活动追踪，数据实时写入 SQLite 并由 API 服务提供。
        </div>
      )}
    </div>
  );
}
