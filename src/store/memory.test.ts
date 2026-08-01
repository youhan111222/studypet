// 教练记忆提取器单测：多信号分类
import { describe, it, expect } from 'vitest';
import { extractMemoriesFromConversation } from './memory';

describe('extractMemoriesFromConversation', () => {
  it('目标类：强信号命中', () => {
    const items = extractMemoriesFromConversation('我的目标院校是广州城市理工学院，一定要考上');
    expect(items.some(i => i.type === 'goal')).toBe(true);
    expect(items[0]?.priority ?? 0).toBeGreaterThanOrEqual(7);
  });

  it('偏好类：学习时段偏好', () => {
    const items = extractMemoriesFromConversation('我习惯晚上效率最高，喜欢在晚上学习高数');
    expect(items.some(i => i.type === 'preference')).toBe(true);
  });

  it('洞察类：薄弱科目', () => {
    const items = extractMemoriesFromConversation('我的薄弱点是英语，完全不会语法');
    expect(items.some(i => i.type === 'insight' && i.tags?.includes('weakness'))).toBe(true);
  });

  it('无信号文本 → 空数组', () => {
    expect(extractMemoriesFromConversation('好的')).toEqual([]);
    expect(extractMemoriesFromConversation('')).toEqual([]);
  });

  it('优先级封顶 10', () => {
    const items = extractMemoriesFromConversation('我的目标院校是广州城市理工学院，一定要考上，这是我的梦想学校，我要拿奖学金');
    expect(Math.max(...items.map(i => i.priority ?? 0))).toBeLessThanOrEqual(10);
  });
});
