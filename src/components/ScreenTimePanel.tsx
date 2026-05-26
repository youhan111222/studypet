import { useEffect, useState } from 'react';

const API = '';  // 走 Vite 代理 → /activity → 19998

const catMeta: Record<string, { label: string; color: string; icon: string }> = {
  study: { label: '学习', color: '#4ecca3', icon: '📖' },
  entertainment: { label: '娱乐', color: '#ef5350', icon: '🎮' },
  social: { label: '社交', color: '#0a84ff', icon: '💬' },
  other: { label: '其他', color: '#9e9e9e', icon: '📂' },
};

interface AppEntry { appName: string; category: string; duration: number; sessions: number; title: string; }
interface StatsResponse { apps: AppEntry[]; categories: Record<string, number>; idleMinutes: number; totalActiveMinutes: number; date: string; }

interface HourData { hour: number; active: number; idle: number; }

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
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
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
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '24px 28px', overflow: 'hidden' }}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>屏幕使用时间</h2>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {stats.date} · 每10秒自动刷新
          </p>
        </div>
        <div style={{
          padding: '10px 18px', borderRadius: 10, background: 'var(--bg-card)',
          border: '1px solid var(--border)', textAlign: 'center',
        }}>
          <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--text-primary)', lineHeight: 1 }}>
            {Math.floor(totalAll / 60)}<span style={{ fontSize: 16 }}>h</span> {totalAll % 60}<span style={{ fontSize: 16 }}>m</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>今日屏幕总时长</div>
        </div>
      </div>

      {/* 三列概览 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 24 }}>
        <MiniCard icon="⏱️" label="活跃时长" value={`${Math.floor(totalActive / 60)}h ${totalActive % 60}m`} color="#4ecca3" />
        <MiniCard icon="💤" label="空闲时长" value={`${Math.floor(idleMin / 60)}h ${idleMin % 60}m`} color="#9e9e9e" />
        <MiniCard
          icon="📊"
          label="活跃占比"
          value={`${totalAll > 0 ? Math.round((totalActive / totalAll) * 100) : 0}%`}
          color={totalAll > 0 && totalActive / totalAll > 0.7 ? '#4ecca3' : '#ffa726'}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, flex: 1, minHeight: 0, overflow: 'hidden' }}>
        {/* 左列：分类占比 + 应用排行 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, overflow: 'hidden' }}>
          {/* 分类占比 */}
          <div style={{ padding: 16, borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 12px', flexShrink: 0 }}>分类占比</h3>
            {catEntries.length === 0 ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>暂无数据</div>
            ) : (
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {catEntries.map(([cat, min]) => {
                  const meta = catMeta[cat] || { label: cat, color: '#9e9e9e', icon: '📌' };
                  const pct = totalActive > 0 ? Math.round((min / totalActive) * 100) : 0;
                  return (
                    <div key={cat}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 3 }}>
                        <span style={{ fontSize: 12, fontWeight: 500 }}>{meta.icon} {meta.label}</span>
                        <span style={{ fontSize: 12, color: meta.color, fontWeight: 600 }}>
                          {Math.floor(min / 60)}h {min % 60}m · {pct}%
                        </span>
                      </div>
                      <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${pct}%`, height: '100%', background: meta.color, borderRadius: 3,
                          transition: 'width 0.5s',
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
        <div style={{ padding: 16, borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 12px', flexShrink: 0 }}>应用排行 Top 10</h3>
          {sortedApps.length === 0 ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 12 }}>暂无数据</div>
          ) : (
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {sortedApps.slice(0, 10).map((app, i) => {
                const meta = catMeta[app.category] || { color: '#9e9e9e' };
                const pct = totalActive > 0 ? Math.round((app.duration / totalActive) * 100) : 0;
                return (
                  <div key={app.appName} style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', borderRadius: 6,
                    background: i % 2 === 0 ? 'var(--bg-secondary)' : 'transparent',
                  }}>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)', width: 20, flexShrink: 0 }}>
                      {i + 1}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {app.appName}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <div style={{ flex: 1, height: 3, background: 'var(--bg-tertiary)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{
                            width: `${pct}%`, height: '100%', background: meta.color, borderRadius: 2, transition: 'width 0.5s',
                          }} />
                        </div>
                        <span style={{ fontSize: 9, color: 'var(--text-muted)', flexShrink: 0 }}>{pct}%</span>
                      </div>
                    </div>
                    <span style={{ fontSize: 11, fontWeight: 600, color: meta.color, flexShrink: 0 }}>
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
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
        {/* 过去7天趋势 */}
        <div style={{ padding: 14, borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 10px' }}>过去7天屏幕时间</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 80 }}>
            {history.map((min, i) => {
              const h = Math.round((min / maxDay) * 100);
              const today = new Date();
              const d = new Date(today);
              d.setDate(d.getDate() - (6 - i));
              const isToday = i === 6;
              const dayLabels = ['日', '一', '二', '三', '四', '五', '六'];
              return (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 9, color: isToday ? 'var(--accent)' : 'var(--text-muted)', fontWeight: isToday ? 700 : 400 }}>
                    {Math.floor(min / 60)}h
                  </span>
                  <div style={{
                    width: '100%', height: `${Math.max(4, h)}%`, borderRadius: 4,
                    background: isToday ? 'var(--accent)' : 'var(--bg-tertiary)',
                    minHeight: 4, transition: 'height 0.5s',
                  }} />
                  <span style={{ fontSize: 9, color: isToday ? 'var(--accent)' : 'var(--text-muted)', fontWeight: isToday ? 600 : 400 }}>
                    {dayLabels[d.getDay()]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 今日时段分布 */}
        <div style={{ padding: 14, borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <h3 style={{ fontSize: 13, fontWeight: 600, margin: '0 0 10px' }}>今日时段分布</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 80 }}>
            {hourly.map(h => {
              const pct = maxHour > 0 ? (h.active / maxHour) * 100 : 0;
              const now = new Date().getHours();
              const isNow = h.hour === now;
              return (
                <div key={h.hour} style={{
                  flex: 1, height: `${Math.max(4, pct)}%`, borderRadius: 2,
                  background: isNow ? 'var(--accent)' : '#4ecca3',
                  minHeight: 2, opacity: isNow ? 1 : 0.5, transition: 'height 0.5s',
                  position: 'relative',
                }} title={`${h.hour}:00 - ${Math.floor(h.active / 60)}h ${h.active % 60}m`} />
              );
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 9, color: 'var(--text-muted)' }}>
            <span>0时</span><span>6时</span><span>12时</span><span>18时</span><span>23时</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function MiniCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  return (
    <div style={{ padding: '14px 16px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ fontSize: 22, flexShrink: 0 }}>{icon}</div>
      <div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{label}</div>
        <div style={{ fontSize: 16, fontWeight: 700, color }}>{value}</div>
      </div>
    </div>
  );
}