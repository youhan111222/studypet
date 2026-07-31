import { useEffect, useState } from 'react';
import { API } from '../config';

const catMeta: Record<string, { label: string; color: string; icon: string }> = {
  study: { label: '学习', color: '#4ecca3', icon: '📖' },
  dev: { label: '开发', color: '#61afef', icon: '💻' },
  tools: { label: '工具', color: '#8a8a8a', icon: '🔧' },
  system: { label: '系统', color: '#6b6b6b', icon: '🖥️' },
  browser: { label: '浏览器', color: '#0a84ff', icon: '🌐' },
  entertainment: { label: '娱乐', color: '#ef5350', icon: '🎮' },
  social: { label: '社交', color: '#ffa726', icon: '💬' },
  other: { label: '其他', color: '#9e9e9e', icon: '📂' },
};

interface AppEntry { appName: string; category: string; duration: number; sessions: number; title: string; }
interface StatsResponse { apps: AppEntry[]; categories: Record<string, number>; idleMinutes: number; totalActiveMinutes: number; date: string; }

interface HourData { hour: number; active: number; idle: number; }

// ====== 卡片通用样式 ======
const CARD_CLS = 'p-4 rounded-[10px] bg-[var(--bg-card)] border border-[var(--border)]';
const CARD_TITLE_CLS = 'text-[13px] font-semibold mb-3 shrink-0';
const EMPTY_CLS = 'flex-1 flex items-center justify-center text-[var(--text-muted)] text-xs';

export function ScreenTimePanel() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [history, setHistory] = useState<number[]>([]); // 过去7天每日活跃分钟数
  const [hourly, setHourly] = useState<HourData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [statRes, histRes] = await Promise.all([
          fetch(`${API}/activity/stats`),
          fetch(`${API}/activity/history?days=7`),
        ]);
        const s: StatsResponse = await statRes.json();
        const raw: any[] = await histRes.json();
        setStats(s);

        // 过去7天每日活跃时长
        const dayMap: Record<string, number> = {};
        raw.forEach((r: any) => {
          dayMap[r.date] = (dayMap[r.date] || 0) + Math.round(r.duration_seconds / 60);
        });
        const today = new Date();
        const days: number[] = [];
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const key = d.toISOString().slice(0, 10);
          days.push(dayMap[key] || 0);
        }
        setHistory(days);

        // 按小时分布
        const hourMap: Record<number, number> = {};
        raw.forEach((r: any) => {
          if (!r.start_time) return;
          const h = parseInt(r.start_time.slice(11, 13));
          hourMap[h] = (hourMap[h] || 0) + Math.round(r.duration_seconds / 60);
        });
        const hourlyData: HourData[] = [];
        for (let h = 0; h < 24; h++) {
          hourlyData.push({ hour: h, active: hourMap[h] || 0, idle: 0 });
        }
        setHourly(hourlyData);
      } catch { } finally { setLoading(false); }
    };
    load();
    const iv = setInterval(load, 10000);
    return () => clearInterval(iv);
  }, []);

  if (loading || !stats) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-muted)] text-sm">
        {loading ? '加载中...' : '暂无屏幕时间数据，请确保 tracker.py 已启动'}
      </div>
    );
  }

  const totalActive = stats.totalActiveMinutes;
  const idleMin = stats.idleMinutes;
  const totalAll = totalActive + idleMin;
  const sortedApps = [...stats.apps].sort((a, b) => b.duration - a.duration);
  const maxDay = Math.max(1, ...history);
  const maxHour = Math.max(1, ...hourly.map(h => h.active));

  // 分类占比
  const catEntries = Object.entries(stats.categories).sort((a, b) => b[1] - a[1]);

  return (
    <div className="flex-1 flex flex-col p-[24px_28px] overflow-hidden">
      {/* 头部 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-[22px] font-bold m-0">屏幕使用时间</h2>
          <p className="text-xs text-[var(--text-muted)] m-[4px_0_0]">
            {stats.date} · 每10秒自动刷新
          </p>
        </div>
        <div className="p-[10px_18px] rounded-[10px] bg-[var(--bg-card)] border border-[var(--border)] text-center">
          <div className="text-[26px] font-extrabold text-[var(--text-primary)] leading-none">
            {Math.floor(totalAll / 60)}<span className="text-base">h</span> {totalAll % 60}<span className="text-base">m</span>
          </div>
          <div className="text-[11px] text-[var(--text-muted)] mt-[2px]">今日屏幕总时长</div>
        </div>
      </div>

      {/* 三列概览 */}
      <div className="grid grid-cols-3 gap-[14px] mb-6">
        <MiniCard icon="⏱️" label="活跃时长" value={`${Math.floor(totalActive / 60)}h ${totalActive % 60}m`} color="#4ecca3" />
        <MiniCard icon="💤" label="空闲时长" value={`${Math.floor(idleMin / 60)}h ${idleMin % 60}m`} color="#9e9e9e" />
        <MiniCard
          icon="📊"
          label="活跃占比"
          value={`${totalAll > 0 ? Math.round((totalActive / totalAll) * 100) : 0}%`}
          color={totalAll > 0 && totalActive / totalAll > 0.7 ? '#4ecca3' : '#ffa726'}
        />
      </div>

      <div className="grid grid-cols-2 gap-[14px] flex-1 min-h-0 overflow-hidden">
        {/* 左列：分类占比 + 应用排行 */}
        <div className="flex flex-col gap-[14px] overflow-hidden">
          {/* 分类占比 */}
          <div className={`${CARD_CLS} flex-1 overflow-hidden flex flex-col`}>
            <h3 className={CARD_TITLE_CLS}>分类占比</h3>
            {catEntries.length === 0 ? (
              <div className={EMPTY_CLS}>暂无数据</div>
            ) : (
              <div className="flex-1 overflow-y-auto flex flex-col gap-2">
                {catEntries.map(([cat, min]) => {
                  const meta = catMeta[cat] || { label: cat, color: '#9e9e9e', icon: '📌' };
                  const pct = totalActive > 0 ? Math.round((min / totalActive) * 100) : 0;
                  return (
                    <div key={cat}>
                      <div className="flex justify-between mb-[3px]">
                        <span className="text-xs font-medium">{meta.icon} {meta.label}</span>
                        <span className="text-xs font-semibold" style={{ color: meta.color }}>
                          {Math.floor(min / 60)}h {min % 60}m · {pct}%
                        </span>
                      </div>
                      <div className="h-[6px] bg-[var(--bg-tertiary)] rounded-[3px] overflow-hidden">
                        <div className="h-full rounded-[3px] transition-[width] duration-500" style={{
                          width: `${pct}%`,
                          background: meta.color,
                        }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 右列：应用排行 */}
        <div className={`${CARD_CLS} overflow-hidden flex flex-col`}>
          <h3 className={CARD_TITLE_CLS}>应用排行 Top 10</h3>
          {sortedApps.length === 0 ? (
            <div className={EMPTY_CLS}>暂无数据</div>
          ) : (
            <div className="flex-1 overflow-y-auto flex flex-col gap-1">
              {sortedApps.slice(0, 10).map((app, i) => {
                const meta = catMeta[app.category] || { color: '#9e9e9e' };
                const pct = totalActive > 0 ? Math.round((app.duration / totalActive) * 100) : 0;
                return (
                  <div key={app.appName} className={`flex items-center gap-2 p-[6px_10px] rounded-[6px] ${i % 2 === 0 ? 'bg-[var(--bg-secondary)]' : 'bg-transparent'}`}>
                    <span className="text-[11px] text-[var(--text-muted)] w-5 shrink-0">
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium overflow-hidden text-ellipsis whitespace-nowrap">
                        {app.appName}
                      </div>
                      <div className="flex items-center gap-[6px] mt-[2px]">
                        <div className="flex-1 h-[3px] bg-[var(--bg-tertiary)] rounded-[2px] overflow-hidden">
                          <div className="h-full rounded-[2px] transition-[width] duration-500" style={{
                            width: `${pct}%`,
                            background: meta.color,
                          }} />
                        </div>
                        <span className="text-[9px] text-[var(--text-muted)] shrink-0">{pct}%</span>
                      </div>
                    </div>
                    <span className="text-[11px] font-semibold shrink-0" style={{ color: meta.color }}>
                      {Math.floor(app.duration / 60)}h {app.duration % 60}m
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* 底部：过去7天趋势 + 今日时段 */}
      <div className="grid grid-cols-2 gap-[14px] mt-[14px]">
        {/* 过去7天趋势 */}
        <div className="p-[14px] rounded-[10px] bg-[var(--bg-card)] border border-[var(--border)]">
          <h3 className="text-[13px] font-semibold mb-[10px]">过去7天屏幕时间</h3>
          <div className="flex items-end gap-2 h-20">
            {history.map((min, i) => {
              const h = Math.round((min / maxDay) * 100);
              const today = new Date();
              const d = new Date(today);
              d.setDate(d.getDate() - (6 - i));
              const isToday = i === 6;
              const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className={`text-[9px] ${isToday ? 'text-[var(--accent)] font-bold' : 'text-[var(--text-muted)] font-normal'}`}>
                    {Math.floor(min / 60)}h
                  </span>
                  <div className={`w-full rounded min-h-[4px] transition-[height] duration-500 ${isToday ? 'bg-[var(--accent)]' : 'bg-[var(--bg-tertiary)]'}`} style={{ height: `${Math.max(4, h)}%` }} />
                  <span className={`text-[9px] ${isToday ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-muted)] font-normal'}`}>
                    {dayLabels[d.getDay()]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 今日时段分布 */}
        <div className="p-[14px] rounded-[10px] bg-[var(--bg-card)] border border-[var(--border)]">
          <h3 className="text-[13px] font-semibold mb-[10px]">今日时段分布</h3>
          <div className="flex items-end gap-[2px] h-20">
            {hourly.map(h => {
              const pct = maxHour > 0 ? (h.active / maxHour) * 100 : 0;
              const now = new Date().getHours();
              const isNow = h.hour === now;
              return (
                <div key={h.hour} className={`flex-1 rounded-[2px] min-h-[2px] relative transition-[height] duration-500 ${isNow ? 'bg-[var(--accent)] opacity-100' : 'bg-[#4ecca3] opacity-50'}`} style={{ height: `${Math.max(4, pct)}%` }} title={`${h.hour}:00 - ${Math.floor(h.active / 60)}h ${h.active % 60}m`} />
              );
            })}
          </div>
          <div className="flex justify-between mt-1 text-[9px] text-[var(--text-muted)]">
            <span>0时</span><span>6时</span><span>12时</span><span>18时</span><span>23时</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div className="p-[14px_16px] rounded-[10px] bg-[var(--bg-card)] border border-[var(--border)] flex items-center gap-3">
      <div className="text-[22px] shrink-0">{icon}</div>
      <div>
        <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
        <div className="text-base font-bold" style={{ color }}>{value}</div>
      </div>
    </div>
  );
}
