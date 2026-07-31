import { useStore } from '../store/useStore';

export function AchievementWall() {
  const achievements = useStore(s => s.achievements);

  const unlocked = achievements.filter(a => a.unlocked).length;

  return (
    <div className="flex-1 flex flex-col p-[20px_24px] overflow-hidden">
      <div className="flex items-center justify-between mb-[16px]">
        <h2 className="text-[18px] font-semibold">成就墙</h2>
        <span className="text-[12px] text-[var(--text-secondary)]">
          {unlocked}/{achievements.length} 已解锁
        </span>
      </div>

      <div className="flex-1 overflow-y-auto grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-[10px] content-start">
        {achievements.map(ach => (
          <div key={ach.id} className={`p-[14px_16px] rounded-[10px] border ${ach.unlocked ? 'bg-[var(--bg-card)] border-[var(--border)] opacity-100' : 'bg-[rgba(30,30,58,0.4)] border-[rgba(37,37,80,0.4)] opacity-40'}`}>
            <div className="text-[28px] mb-[6px]">{ach.icon}</div>
            <div className="text-[14px] font-semibold">{ach.title}</div>
            <div className="text-[11px] text-[var(--text-secondary)] mt-[2px]">
              {ach.desc}
            </div>
            {!ach.unlocked && (
              <div className="mt-[8px]">
                <div className="h-[4px] bg-[rgba(37,37,80,0.5)] rounded-[2px] overflow-hidden">
                  <div className="h-full bg-[var(--accent)] rounded-[2px]" style={{ width: `${(ach.progress / ach.total) * 100}%` }} />
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-[2px]">
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