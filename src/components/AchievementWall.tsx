import { useStore } from '../store/useStore';

export function AchievementWall() {
  const achievements = useStore(s => s.achievements);

  const unlocked = achievements.filter(a => a.unlocked).length;

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      padding: '20px 24px', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>成就墙</h2>
        <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
          {unlocked}/{achievements.length} 已解锁
        </span>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto',
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
        gap: 10, alignContent: 'start',
      }}>
        {achievements.map(ach => (
          <div key={ach.id} style={{
            padding: '14px 16px', borderRadius: 10,
            background: ach.unlocked ? 'var(--bg-card)' : 'rgba(30,30,58,0.4)',
            border: `1px solid ${ach.unlocked ? 'var(--border)' : 'rgba(37,37,80,0.4)'}`,
            opacity: ach.unlocked ? 1 : 0.4,
          }}>
            <div style={{ fontSize: 28, marginBottom: 6 }}>{ach.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{ach.title}</div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>
              {ach.desc}
            </div>
            {!ach.unlocked && (
              <div style={{ marginTop: 8 }}>
                <div style={{
                  height: 4, background: 'rgba(37,37,80,0.5)', borderRadius: 2,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${(ach.progress / ach.total) * 100}%`,
                    height: '100%', background: 'var(--accent)',
                    borderRadius: 2,
                  }} />
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {ach.progress}/{ach.total}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}