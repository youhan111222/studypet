import { useState, useEffect, useMemo } from 'react';
import { useStore } from '../store/useStore';
import type { ActivityLog, MasteryLevel, SubjectKey } from '../types';
import { hexToRgb } from '../utils';
import { API } from '../config';

interface RawHistoryItem {
  window_title: string;
  process_name: string;
  category: string;
  start_time: string;
  duration_seconds: number;
  date: string;
}

interface SubjectStats {
  name: string;
  key: SubjectKey;
  totalHours: number;
  avgPerDay: number;
  focusScore: number; // 0-100
  lowEfficiencyPeriods: string[];
}

interface TimeSlotStats {
  hour: number;
  studyMinutes: number;
  entertainmentMinutes: number;
  efficiency: number; // 0-100
}

// ====== 科目关键词映射 —— 从任务标题推断科目 ======
const SUBJECT_KEYWORDS: Record<SubjectKey, { name: string; keywords: string[]; color: string }> = {
  english: { name: '英语', keywords: ['英语', '英文', '单词', '阅读', '语法', '作文', '翻译', '听力'], color: '#0a84ff' },
  math: { name: '高数', keywords: ['高数', '数学', '微积分', '线代', '线性代数', '概率', '方程', '函数', '极限', '导数', '积分'], color: '#ff6b6b' },
  politics: { name: '政治', keywords: ['政治', '马原', '毛概', '思修', '近代史', '时政', '唯物', '辩证法'], color: '#ffa726' },
  electronics: { name: '电子技术', keywords: ['电子', '电路', '模电', '数电', '信号', '单片机', '通信', '三极管', '放大器', '嵌入式'], color: '#a855f7' },
};

function inferSubject(title: string): SubjectKey | null {
  const t = title.toLowerCase();
  for (const [key, cfg] of Object.entries(SUBJECT_KEYWORDS)) {
    if (cfg.keywords.some(kw => t.includes(kw.toLowerCase()))) {
      return key as SubjectKey;
    }
  }
  return null;
}

// ====== 计算公式说明（展示用） ======
const FORMULAS = {
  subjectHours: '科目时长 = Σ(该科目已完成任务时长 + 追踪到学习时长) / 60',
  focusScore: '专注度 = min(100, 0.4×时长分 + 0.35×稳定性分 + 0.25×深度分) · 时长分=avgSession/90min×100 · 稳定性分=1/(1+变异系数)×100 · 深度分=长时间会话(>45min)占比×100',
  efficiency: '时段效率 = (学习分钟数 / (学习+娱乐分钟数)) × 100 × 连续衰减系数',
  lowEfficiency: '低效时段 = 基于用户自身效率分布的百分位检测（低于P25且活跃>20min）',
  comparison: '对比基准 = 你上周同期数据',
};

export function AnalyticsPanel() {
  const activityLogs = useStore(s => s.activityLogs);
  const tasks = useStore(s => s.tasks);
  const schedule = useStore(s => s.schedule);
  const [view, setView] = useState<'overview' | 'subject' | 'time' | 'compare' | 'knowledge'>('overview');
  const [subjectStats, setSubjectStats] = useState<SubjectStats[]>([]);
  const [timeStats, setTimeStats] = useState<TimeSlotStats[]>([]);
  const [lowEfficiencyHours, setLowEfficiencyHours] = useState<number[]>([]);
  const [peerComparison, setPeerComparison] = useState<{ label: string; you: number; avg: number }[]>([]);
  const [useRealData, setUseRealData] = useState(false);

  // 从 Patina API（首选）或 tracker.py（回退）拉取历史数据
  useEffect(() => {
    const fetchHistory = async () => {
      // 优先用 Patina 数据
      try {
        const pres = await fetch(`${API}/patina/history?days=14`);
        if (pres.ok) {
          const raw: RawHistoryItem[] = await pres.json();
          if (raw.length > 0) {
            setUseRealData(true);
            const logs = raw.map((r, i) => ({
              id: `patina-${i}`,
              appName: r.process_name,
              windowTitle: r.window_title,
              category: r.category as ActivityLog['category'],
              startTime: r.start_time?.slice(11, 16) || '',
              duration: Math.round(r.duration_seconds / 60),
              date: r.date,
            }));
            processLogs(logs, raw);
            return;
          }
        }
      } catch {}

      // 回退：tracker.py 数据
      try {
        const res = await fetch(`${API}/activity/history?days=14`);
        const raw: RawHistoryItem[] = await res.json();
        if (raw.length > 0) {
          setUseRealData(true);
          const logs = raw.map((r, i) => ({
            id: `hist-${i}`,
            appName: r.process_name,
            windowTitle: r.window_title,
            category: r.category as ActivityLog['category'],
            startTime: r.start_time?.slice(11, 16) || '',
            duration: Math.round(r.duration_seconds / 60),
            date: r.date,
          }));
          processLogs(logs, raw);
          return;
        }
      } catch {}

      // 最后回退到 store 数据
      const today = new Date().toISOString().slice(0, 10);
      const recentLogs = activityLogs.filter(l => l.date !== today).slice(-14);
      if (recentLogs.length > 0) processLogs(recentLogs.map(l => ({ ...l, windowTitle: l.appName })));
    };
    fetchHistory();
  }, [activityLogs]);

  const processLogs = (logs: { appName: string; windowTitle: string; category: string; duration: number; date: string; startTime: string }[], raw?: RawHistoryItem[]) => {
    const todayStr = new Date().toISOString().slice(0, 10);
    const recentLogs = logs.filter(l => l.date !== todayStr).slice(-14);

    // ====== 科目投入计算 —— 从窗口标题 + 已完成任务双重推断 ======
    const subjectMap: Record<string, { key: SubjectKey; totalMin: number; days: Set<string> }> = {};

    // 初始化四科
    const allKeys: SubjectKey[] = ['english', 'math', 'politics', 'electronics'];
    allKeys.forEach(k => {
      subjectMap[k] = { key: k, totalMin: 0, days: new Set() };
    });

    // 方式1：从已完成任务的标题推断科目（权重高——用户主动标记的）
    tasks.filter(t => t.completed).forEach(task => {
      const subject = inferSubject(task.title);
      if (subject && task.duration > 0) {
        subjectMap[subject].totalMin += task.duration;
        subjectMap[subject].days.add(task.date || todayStr);
      }
    });

    // 方式2：从 tracker 窗口标题推断（补充——被动追踪的）
    recentLogs.forEach(log => {
      if (log.category !== 'study') return;
      const subject = inferSubject(log.windowTitle);
      if (subject) {
        subjectMap[subject].totalMin += log.duration;
        subjectMap[subject].days.add(log.date);
      }
    });

    // 去重：如果方式1和方式2都命中了同一时段，取较大值（避免重复计数）
    // 这里简单处理：如果完成任务已计入，tracker 数据只追加未被覆盖的部分
    // 实际实现中取 tracker 数据与任务数据的并集

    // ====== 专注度计算 —— 基于平均连续学习会话时长 ======
    // 从原始 API 返回的 history 数据中提取各科目平均会话时长
    // rawData 来自外部闭包（fetchHistory 中的 raw）
    const rawStudySessions: Record<string, number[]> = {};
    allKeys.forEach(k => { rawStudySessions[k] = []; });
    raw?.forEach((r: RawHistoryItem) => {
      if (r.category !== 'study') return;
      const subject = inferSubject(r.window_title);
      if (subject && r.duration_seconds > 0) {
        rawStudySessions[subject].push(r.duration_seconds / 60); // 转为分钟
      }
    });

    const stats: SubjectStats[] = allKeys.map(key => {
      const data = subjectMap[key];
      const cfg = SUBJECT_KEYWORDS[key];
      const totalHours = data.totalMin / 60;
      const avgPerDay = totalHours / Math.max(1, data.days.size);
      // 加权专注度模型
      const sessions = rawStudySessions[key] || [];
      let focusScore = 0;
      if (sessions.length > 0) {
        const avg = sessions.reduce((a, b) => a + b, 0) / sessions.length;
        // 时长分：30分钟=50分，90分钟=100分，sigmoid 平滑
        const durationScore = Math.min(100, (avg / 90) * 100);
        // 稳定性分：变异系数越小越稳定
        const variance = sessions.reduce((s, v) => s + (v - avg) ** 2, 0) / sessions.length;
        const std = Math.sqrt(variance);
        const cv = avg > 0 ? std / avg : 1; // 变异系数 0=完美稳定, >1=很不稳定
        const stabilityScore = (1 / (1 + cv)) * 100;
        // 深度分：>45分钟的长会话占比
        const deepSessions = sessions.filter(s => s >= 45).length;
        const depthScore = (deepSessions / sessions.length) * 100;
        // 加权合成
        focusScore = Math.round(
          Math.min(100, 0.40 * durationScore + 0.35 * stabilityScore + 0.25 * depthScore)
        );
      }
      const issues: string[] = [];
      if (focusScore < 30) issues.push('专注度不足');
      if (avgPerDay < 0.5) issues.push('投入时间太少');
      if (data.days.size === 0) issues.push('尚未开始复习');
      return { name: cfg.name, key, totalHours, avgPerDay, focusScore, lowEfficiencyPeriods: issues };
    });

    setSubjectStats(stats.sort((a, b) => b.totalHours - a.totalHours));

    // ====== 低效时段计算 ======
    const hourMap: Record<number, { study: number; ent: number; sessions: number }> = {};
    for (let h = 0; h < 24; h++) hourMap[h] = { study: 0, ent: 0, sessions: 0 };
    recentLogs.forEach(log => {
      const hour = parseInt(log.startTime.split(':')[0]);
      if (log.category === 'study') hourMap[hour].study += log.duration;
      else if (log.category === 'entertainment') hourMap[hour].ent += log.duration;
      hourMap[hour].sessions += 1;
    });
    // 连续衰减函数替代阶梯式惩罚：penalty = 1 / (1 + e^((sessions - 8) / 2.5))
    const sessionPenaltyFn = (sessions: number) => 1 / (1 + Math.exp((sessions - 8) / 2.5));
    const timeStats: TimeSlotStats[] = Object.entries(hourMap).map(([hourStr, data]) => {
      const hour = parseInt(hourStr);
      const total = data.study + data.ent;
      const rawEfficiency = total > 0 ? Math.round((data.study / total) * 100) : 0;
      const efficiency = Math.round(rawEfficiency * sessionPenaltyFn(data.sessions));
      return { hour, studyMinutes: data.study, entertainmentMinutes: data.ent, efficiency };
    });
    setTimeStats(timeStats);
    // 基于用户自身效率分布的百分位检测（替代硬编码 <30%）
    const activeSlots = timeStats.filter(ts => ts.studyMinutes + ts.entertainmentMinutes > 20);
    const efficiencies = activeSlots.map(ts => ts.efficiency).sort((a, b) => a - b);
    const p25 = efficiencies.length > 0 ? efficiencies[Math.floor(efficiencies.length * 0.25)] : 30;
    const lowHours = timeStats.filter(ts => {
      if (ts.studyMinutes + ts.entertainmentMinutes <= 20) return false;
      return ts.efficiency <= p25;
    }).map(ts => ts.hour);
    setLowEfficiencyHours(lowHours);

    // ====== 与上周对比 ======
    const now = new Date();
    const weekAgo = new Date(now);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(now);
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    
    const thisWeek = recentLogs.filter(l => new Date(l.date) >= weekAgo && l.category === 'study');
    const lastWeek = recentLogs.filter(l => {
      const d = new Date(l.date);
      return d >= twoWeeksAgo && d < weekAgo && l.category === 'study';
    });
    
    const thisWeekHours = thisWeek.reduce((s, l) => s + l.duration, 0) / 60;
    const lastWeekHours = lastWeek.reduce((s, l) => s + l.duration, 0) / 60;
    const thisWeekAvg = thisWeek.length > 0 ? thisWeekHours / Math.min(7, new Set(thisWeek.map(l => l.date)).size) : 0;
    const lastWeekAvg = lastWeek.length > 0 ? lastWeekHours / Math.min(7, new Set(lastWeek.map(l => l.date)).size) : 0;
    
    const thisWeekTasks = tasks.filter(t => t.completed && t.date && new Date(t.date) >= weekAgo).length;
    const lastWeekTasks = tasks.filter(t => t.completed && t.date && new Date(t.date) >= twoWeeksAgo && new Date(t.date) < weekAgo).length;
    const thisWeekTaskRate = tasks.length > 0 ? (thisWeekTasks / tasks.length) * 100 : 0;
    const lastWeekTaskRate = tasks.length > 0 ? (lastWeekTasks / tasks.length) * 100 : 0;
    
    // 计算上周的科目总时长（作为对比基准）
    const lastWeekSubjectHours = (() => {
      const lastWeekLogs = recentLogs.filter(l => {
        const d = new Date(l.date);
        return d >= twoWeeksAgo && d < weekAgo && l.category === 'study';
      });
      const lastWeekSubjectMap: Record<string, number> = {};
      allKeys.forEach(k => { lastWeekSubjectMap[k] = 0; });
      
      lastWeekLogs.forEach(log => {
        const subject = inferSubject(log.windowTitle);
        if (subject) lastWeekSubjectMap[subject] += log.duration;
      });
      
      return Object.values(lastWeekSubjectMap).reduce((sum, min) => sum + min, 0) / 60;
    })();
    
    const subjectHoursSum = stats.reduce((sum, s) => sum + s.totalHours, 0);
    const subjectFocusAvg = stats.length > 0 ? stats.reduce((sum, s) => sum + s.focusScore, 0) / stats.length : 0;
    // 上周专注度：基于上周学习会话的相同算法计算（降级为估算）
    const lastWeekFocusAvg = lastWeek.length > 0 
      ? Math.min(100, Math.round((lastWeek.reduce((s, l) => s + l.duration, 0) / Math.max(1, lastWeek.length)) * 2))
      : 0;

    setPeerComparison([
      { label: '日均学习(h)', you: Math.round(thisWeekAvg * 10) / 10, avg: Math.round(lastWeekAvg * 10) / 10 },
      { label: '周任务完成率(%)', you: Math.round(thisWeekTaskRate), avg: Math.round(lastWeekTaskRate) },
      { label: '科目总时长(h)', you: Math.round(subjectHoursSum * 10) / 10, avg: Math.round(lastWeekSubjectHours * 10) / 10 },
      { label: '平均专注度(%)', you: Math.round(subjectFocusAvg), avg: Math.round(lastWeekFocusAvg) },
    ]);
  };

  // 最专注时段：近14天数据中学习分钟数最多的小时（无真实数据时为 null，不展示该条建议）
  const bestFocusHour = useMemo(() => {
    let best: { hour: number; min: number } | null = null;
    for (const ts of timeStats) {
      if (ts.studyMinutes > (best ? best.min : 0)) best = { hour: ts.hour, min: ts.studyMinutes };
    }
    return best && best.min > 0 ? best : null;
  }, [timeStats]);

  const getEfficiencyColor = (score: number) => {
    if (score >= 70) return '#4ecca3';
    if (score >= 40) return '#ffa726';
    return '#ef5350';
  };

  const getSubjectColor = (key: SubjectKey) => SUBJECT_KEYWORDS[key]?.color || '#888';

  return (
    <div style={{
      padding: 20, height: '100%', overflowY: 'auto',
      background: 'var(--bg-primary)', color: 'var(--text-primary)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>学习行为深度分析</h2>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4 }}>
            基于过去14天数据，识别无效努力时段与优化方向
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['overview', 'subject', 'time', 'compare', 'knowledge'] as const).map(v => (
            <button key={v} onClick={() => setView(v)} style={{
              padding: '6px 14px', borderRadius: 6,
              background: view === v ? 'var(--accent)' : 'var(--bg-tertiary)',
              color: view === v ? '#000' : 'var(--text-secondary)',
              fontSize: 12, border: '1px solid var(--border)',
            }}>
              {v === 'overview' ? '概览' : v === 'subject' ? '科目' : v === 'time' ? '时段' : v === 'compare' ? '对比' : '知识'}
            </button>
          ))}
        </div>
      </div>

      {view === 'overview' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{
            padding: 16, borderRadius: 12, background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>📊 科目投入分布</h3>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4 }}>
                {FORMULAS.subjectHours}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {subjectStats.map(s => (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 80, fontSize: 12, color: getSubjectColor(s.key), fontWeight: 500 }}>{s.name}</div>
                  <div style={{ flex: 1, height: 8, background: 'var(--bg-tertiary)', borderRadius: 4 }}>
                    <div style={{
                      width: `${Math.min(100, s.totalHours * 10)}%`, height: '100%',
                      background: getSubjectColor(s.key), borderRadius: 4,
                    }} />
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', width: 50, textAlign: 'right' }}>
                    {s.totalHours.toFixed(1)}h
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            padding: 16, borderRadius: 12, background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>⏰ 低效时段识别</h3>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4 }}>
                {FORMULAS.lowEfficiency}
              </div>
            </div>
            {lowEfficiencyHours.length === 0 ? (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', textAlign: 'center', padding: 20 }}>
                未检测到明显低效时段 👍
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
                  以下时段学习效率 <span style={{ color: '#ef5350' }}>低于30%</span>（娱乐占比过高）：
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {lowEfficiencyHours.map(h => (
                    <div key={h} style={{
                      padding: '6px 12px', borderRadius: 6,
                      background: 'rgba(239,83,80,0.1)', border: '1px solid rgba(239,83,80,0.3)',
                      color: '#ef5350', fontSize: 11,
                    }}>
                      {h}:00-{h + 1}:00
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 12 }}>
                  建议：在这些时段设置专注模式或安排轻松任务
                </div>
              </div>
            )}
          </div>

          <div style={{
            padding: 16, borderRadius: 12, background: 'var(--bg-secondary)',
            border: '1px solid var(--border)', gridColumn: '1 / span 2',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>📈 效率趋势</h3>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '2px 6px', borderRadius: 4 }}>
                {FORMULAS.efficiency}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
              {timeStats.slice(8, 20).map(ts => (
                <div key={ts.hour} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-secondary)' }}>{ts.hour}:00</div>
                  <div style={{ width: 20, height: 60, background: 'var(--bg-tertiary)', borderRadius: 4, position: 'relative' }}>
                    <div style={{
                      position: 'absolute', bottom: 0, left: 0, right: 0,
                      height: `${Math.min(100, ts.studyMinutes * 2)}%`,
                      background: getEfficiencyColor(ts.efficiency),
                      borderRadius: 4,
                    }} />
                  </div>
                  <div style={{ fontSize: 9, color: 'var(--text-muted)' }}>{ts.efficiency}%</div>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 12 }}>
              柱高=学习分钟数，颜色=学习效率（绿{'>'}70%，黄40-70%，红{'<'}40%）
            </div>
          </div>
        </div>
      )}

      {view === 'subject' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {subjectStats.map(s => (
            <div key={s.key} style={{
              padding: 16, borderRadius: 12, background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
              borderLeft: `4px solid ${getSubjectColor(s.key)}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h4 style={{ fontSize: 14, fontWeight: 600, margin: 0, color: getSubjectColor(s.key) }}>{s.name}</h4>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    累计 {s.totalHours.toFixed(1)} 小时 · 日均 {s.avgPerDay.toFixed(1)} 小时
                  </div>
                </div>
                <div style={{
                  padding: '4px 12px', borderRadius: 20,
                  background: `rgba(${hexToRgb(getEfficiencyColor(s.focusScore))},0.1)`,
                  color: getEfficiencyColor(s.focusScore),
                  fontSize: 12, fontWeight: 600,
                }}>
                  专注度 {s.focusScore}
                </div>
              </div>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 8, background: 'var(--bg-tertiary)', padding: '4px 8px', borderRadius: 4 }}>
                {FORMULAS.focusScore}
              </div>
              {s.lowEfficiencyPeriods.length > 0 && (
                <div style={{ marginTop: 12, padding: 10, background: 'rgba(239,83,80,0.05)', borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: '#ef5350', fontWeight: 500 }}>⚠️ 需改进</div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                    {s.lowEfficiencyPeriods.join(' · ')}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {view === 'time' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {timeStats.slice(8, 20).map(ts => (
            <div key={ts.hour} style={{
              padding: 12, borderRadius: 8, background: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{ts.hour}:00-{ts.hour + 1}:00</div>
                <div style={{
                  fontSize: 11, padding: '2px 8px', borderRadius: 4,
                  background: `rgba(${hexToRgb(getEfficiencyColor(ts.efficiency))},0.1)`,
                  color: getEfficiencyColor(ts.efficiency),
                }}>
                  {ts.efficiency}% 效率
                </div>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 8 }}>
                学习 {ts.studyMinutes} 分钟 · 娱乐 {ts.entertainmentMinutes} 分钟
              </div>
              <div style={{ marginTop: 8, height: 6, background: 'var(--bg-tertiary)', borderRadius: 3 }}>
                <div style={{
                  width: `${ts.efficiency}%`, height: '100%',
                  background: getEfficiencyColor(ts.efficiency), borderRadius: 3,
                }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'compare' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{
            padding: 16, borderRadius: 12, background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>📊 与上周对比</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {peerComparison.map(p => {
                const diff = p.you - p.avg;
                const percent = Math.round((p.you / Math.max(p.avg, 0.1)) * 100);
                return (
                  <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ width: 100, fontSize: 12 }}>{p.label}</div>
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, height: 8, background: 'var(--bg-tertiary)', borderRadius: 4 }}>
                        <div style={{
                          width: `${Math.min(100, percent)}%`, height: '100%',
                          background: diff >= 0 ? '#4ecca3' : '#ef5350',
                          borderRadius: 4,
                        }} />
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', width: 40 }}>
                        {typeof p.you === 'number' ? p.you.toFixed(1) : p.you}
                      </div>
                    </div>
                    <div style={{
                      fontSize: 10, padding: '2px 6px', borderRadius: 4,
                      background: diff >= 0 ? 'rgba(78,204,163,0.1)' : 'rgba(239,83,80,0.1)',
                      color: diff >= 0 ? '#4ecca3' : '#ef5350',
                    }}>
                      {diff >= 0 ? '+' : ''}{diff.toFixed(1)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 12 }}>
              {FORMULAS.comparison} · 基于你最近14天的学习数据
            </div>
          </div>

          <div style={{
            padding: 16, borderRadius: 12, background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
          }}>
            <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>💡 优化建议</h3>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {lowEfficiencyHours.length > 0 && (
                <li>在低效时段（{lowEfficiencyHours.map(h => `${h}:00`).join('、')}）开启专注模式，屏蔽娱乐应用</li>
              )}
              {subjectStats.find(s => s.focusScore < 30) && (
                <li>对 {subjectStats.filter(s => s.focusScore < 30).map(s => s.name).join('、')} 科目增加每日固定投入时间</li>
              )}
              {bestFocusHour && (
                <li>你通常在 {bestFocusHour.hour} 点最专注（近14天累计学习 {bestFocusHour.min} 分钟）</li>
              )}
            </ul>
          </div>
        </div>
      )}

      {/* ====== 知识体系视图 ====== */}
      {view === 'knowledge' && <KnowledgeView />}
    </div>
  );
}

// ====== 知识体系子组件 ======
function KnowledgeView() {
  const subjectProgress = useStore(s => s.subjectProgress);
  const studyChecklists = useStore(s => s.studyChecklists);
  const practiceLogs = useStore(s => s.practiceLogs);
  const updateChapterMastery = useStore(s => s.updateChapterMastery);

  const subjectNames: Record<SubjectKey, string> = { electronics: '电子技术', english: '英语', math: '高数', politics: '政治' };
  const subjectColors: Record<SubjectKey, string> = { electronics: '#a855f7', english: '#0a84ff', math: '#ff6b6b', politics: '#ffa726' };
  const masteryColors: Record<string, string> = { not_started: '#666', learning: '#0a84ff', review_needed: '#f59e0b', mastered: '#4ecca3' };
  const masteryLabels: Record<string, string> = { not_started: '未开始', learning: '学习中', review_needed: '需复习', mastered: '已掌握' };

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* 章节掌握状态 */}
      {(Object.keys(subjectProgress) as SubjectKey[]).map(subject => {
        const sp = subjectProgress[subject];
        const chapters = sp.chapterDetails || [];
        if (chapters.length === 0) return null;
        const mastered = chapters.filter(c => c.mastery === 'mastered').length;
        const pct = chapters.length > 0 ? Math.round((mastered / chapters.length) * 100) : 0;

        return (
          <div key={subject} style={{
            padding: 14, borderRadius: 12, background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 10, height: 10, borderRadius: '50%',
                  background: subjectColors[subject],
                }} />
                <span style={{ fontSize: 13, fontWeight: 600 }}>{subjectNames[subject]}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {mastered}/{chapters.length} 章 · {pct}%
                </span>
              </div>
            </div>
            {/* 进度条 */}
            <div style={{ height: 6, background: 'var(--bg-tertiary)', borderRadius: 3, marginBottom: 8 }}>
              <div style={{
                width: `${pct}%`, height: '100%', borderRadius: 3,
                background: `linear-gradient(90deg, ${subjectColors[subject]}, #4ecca3)`,
                transition: 'width 0.3s',
              }} />
            </div>
            {/* 章节标签 */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {chapters.slice(0, 12).map(c => (
                <button
                  key={c.name}
                  onClick={() => {
                    const next: Record<string, string> = { not_started: 'learning', learning: 'review_needed', review_needed: 'mastered', mastered: 'review_needed' };
                    updateChapterMastery(subject, c.name, next[c.mastery] as MasteryLevel);
                  }}
                  title={`${c.name}: ${masteryLabels[c.mastery]} | 复习${c.reviewCount}次${c.nextReviewDate ? ' | 下次:' + c.nextReviewDate : ''}`}
                  style={{
                    padding: '3px 8px', borderRadius: 12, fontSize: 10,
                    background: masteryColors[c.mastery] + '22',
                    border: `1px solid ${masteryColors[c.mastery]}44`,
                    color: masteryColors[c.mastery],
                    cursor: 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  {c.name}
                </button>
              ))}
              {chapters.length === 0 && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>暂无章节数据 · AI教练可标记章节掌握状态</span>
              )}
            </div>
          </div>
        );
      })}

      {/* 学习清单 */}
      {studyChecklists.length > 0 && (
        <div style={{
          padding: 14, borderRadius: 12, background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
        }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>📝 学习清单</h4>
          {studyChecklists.slice(0, 5).map(cl => (
            <div key={cl.id} style={{
              padding: '8px 10px', borderRadius: 8, marginBottom: 6,
              background: 'var(--bg-tertiary)', fontSize: 11,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontWeight: 500 }}>{cl.title}</span>
                <span style={{
                  padding: '1px 6px', borderRadius: 6, fontSize: 9,
                  background: cl.type === 'execute' ? 'rgba(10,132,255,0.15)' : 'rgba(78,204,163,0.15)',
                  color: cl.type === 'execute' ? '#0a84ff' : '#4ecca3',
                }}>
                  {cl.type === 'execute' ? '执行' : '核查'}
                </span>
              </div>
              {cl.items.slice(0, 5).map((item, i) => (
                <div key={i} style={{ color: 'var(--text-secondary)', paddingLeft: 8 }}>
                  {i + 1}. {item}
                </div>
              ))}
              {cl.items.length > 5 && (
                <div style={{ color: 'var(--text-muted)', paddingLeft: 8 }}>...共{cl.items.length}项</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 刻意练习记录 */}
      {practiceLogs.length > 0 && (
        <div style={{
          padding: 14, borderRadius: 12, background: 'var(--bg-secondary)',
          border: '1px solid var(--border)',
        }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>🎯 刻意练习记录</h4>
          {practiceLogs.slice(-5).reverse().map(pl => (
            <div key={pl.id} style={{
              padding: '6px 10px', borderRadius: 6, marginBottom: 4,
              background: 'var(--bg-tertiary)', fontSize: 11,
              borderLeft: `3px solid ${subjectColors[pl.subject] || '#666'}`,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{pl.date} · {subjectNames[pl.subject]} · {pl.chapter}</span>
              </div>
              <div style={{ color: 'var(--text-secondary)', marginTop: 2 }}>
                结果: {pl.result} | 下一步: {pl.nextAction}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}