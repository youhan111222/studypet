import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface MemoryItem {
  id: string;
  type: 'goal' | 'preference' | 'achievement' | 'insight';
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  priority: number; // 1-10
  relatedTaskIds?: string[];
  relatedSubject?: string;
  metadata?: Record<string, any>;
}

interface MemoryStore {
  memories: MemoryItem[];
  addMemory: (item: Omit<MemoryItem, 'id' | 'createdAt' | 'updatedAt'>) => void;
  updateMemory: (id: string, updates: Partial<MemoryItem>) => void;
  deleteMemory: (id: string) => void;
  getMemoriesByTag: (tag: string) => MemoryItem[];
  getRelatedMemories: (taskId: string, subject?: string) => MemoryItem[];
  clearOldMemories: (olderThanDays: number) => void;
}

const defaultMemories: MemoryItem[] = [];

export const useMemoryStore = create<MemoryStore>()(
  persist(
    (set, get) => ({
      memories: defaultMemories,

      addMemory: (item) => {
        const newItem: MemoryItem = {
          ...item,
          id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          createdAt: new Date().toISOString().slice(0, 10),
          updatedAt: new Date().toISOString().slice(0, 10),
        };
        set(state => ({ memories: [...state.memories, newItem] }));
      },

      updateMemory: (id, updates) => {
        set(state => ({
          memories: state.memories.map(m =>
            m.id === id
              ? { ...m, ...updates, updatedAt: new Date().toISOString().slice(0, 10) }
              : m
          ),
        }));
      },

      deleteMemory: (id) => {
        set(state => ({ memories: state.memories.filter(m => m.id !== id) }));
      },

      getMemoriesByTag: (tag) => {
        return get().memories.filter(m => m.tags.includes(tag));
      },

      getRelatedMemories: (taskId, subject) => {
        const memories = get().memories;
        return memories.filter(m => {
          if (m.relatedTaskIds?.includes(taskId)) return true;
          if (subject && m.relatedSubject === subject) return true;
          return false;
        });
      },

      clearOldMemories: (olderThanDays) => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - olderThanDays);
        const cutoffStr = cutoff.toISOString().slice(0, 10);

        set(state => ({
          memories: state.memories.filter(m => {
            if (m.priority >= 8) return true; // 保留高优先级
            return m.updatedAt >= cutoffStr;
          }),
        }));
      },
    }),
    {
      name: 'studypet-memory',
      version: 1,
    }
  )
);

// ====== 多信号语义分类器 ======
// 替代死板的正则关键词匹配，使用加权特征向量 + 信号融合评分

interface CategorySignal {
  type: MemoryItem['type'];
  /** 强信号词：权重 3.0 — 几乎确定该意图 */
  strongWords: string[];
  /** 中信号词：权重 1.5 — 强烈暗示该意图 */
  mediumWords: string[];
  /** 弱信号词：权重 0.5 — 弱暗示 */
  weakWords: string[];
  /** 上下文模式：正则匹配特定语法结构 */
  patterns: RegExp[];
  /** 默认优先级（实际优先级 = 基础 + 信号强度加成） */
  basePriority: number;
  tags: string[];
}

const CATEGORY_SIGNALS: CategorySignal[] = [
  {
    type: 'goal',
    strongWords: ['目标院校', '想考', '志愿', '梦想学校', '一定要考上'],
    mediumWords: ['目标', '梦想', '想去', '希望考上', '冲刺', '打算报'],
    weakWords: ['想', '希望', '计划', '将来', '以后', '未来', '准备'],
    patterns: [
      /(?:目标|梦想|想去|希望).{0,10}(?:大学|学校|院校|公司|专业)/g,
      /(?:一定要|必须|决心|立志).{0,15}(?:考上|通过|达到|完成)/g,
      /(?:将来|以后|未来).{0,10}(?:想|要|打算|计划).{0,10}(?:做|当|成为|从事)/g,
    ],
    basePriority: 7, tags: ['goal', 'long-term'],
  },
  {
    type: 'preference',
    strongWords: ['效率最高', '最佳学习时间', '最适合', '一直这么学'],
    mediumWords: ['喜欢', '习惯', '偏好', '适合', '效率'],
    weakWords: ['感觉', '觉得', '比较', '倾向于', '舒服'],
    patterns: [
      /(?:喜欢|习惯|偏好|适合).{0,15}(?:在|用|通过|以).{0,10}(?:学习|复习|工作|记忆)/g,
      /(?:效率).{0,10}(?:最高|最好|最佳).{0,10}(?:时候|时间|时段)/g,
      /(?:我).{0,5}(?:发现|觉得|感觉).{0,10}(?:更|比较).{0,5}(?:适合|有效|好用)/g,
    ],
    basePriority: 5, tags: ['preference', 'productivity'],
  },
  {
    type: 'insight',
    strongWords: ['完全不会', '一窍不通', '零基础', '从头学', '根本听不懂', '最差'],
    mediumWords: ['薄弱', '不擅长', '需要提高', '难点', '很难', '吃力', '搞不懂'],
    weakWords: ['不太会', '有点难', '不太熟', '忘记了', '需要加强'],
    patterns: [
      /(?:薄弱|不擅长|难点|短板).{0,10}(?:是|在).{0,10}(?:英语|数学|政治|电子|高数|[A-Za-z]+)/g,
      /(?:需要提高|需要加强|要补).{0,10}(?:英语|数学|政治|电子|高数|[A-Za-z]+)/g,
      /(?:完全|根本|一点都).{0,5}(?:不会|不懂|不理解)/g,
    ],
    basePriority: 6, tags: ['weakness', 'improvement'],
  },
  {
    type: 'achievement',
    strongWords: ['考试通过', '满分', '第一名', '年级前', '奖学金'],
    mediumWords: ['进步', '提高', '突破', '掌握了', '学会了', '做到了'],
    weakWords: ['完成了', '达到了', '实现了', '做完了', '考了'],
    patterns: [
      /(?:考试|测验|模拟).{0,10}(?:通过|高分|进步).{0,10}/g,
      /(?:终于|成功).{0,10}(?:掌握|学会|理解|突破).{0,10}/g,
      /(?:这次|最近).{0,5}(?:比).{0,5}(?:之前|以前|上次).{0,5}(?:好|高|强)/g,
    ],
    basePriority: 4, tags: ['achievement', 'milestone'],
  },
];

function scoreTextAgainstCategory(text: string, signal: CategorySignal): number {
  const lower = text.toLowerCase();
  let score = 0;

  // 词级信号计分
  for (const word of signal.strongWords) {
    if (lower.includes(word.toLowerCase())) score += 3.0;
  }
  for (const word of signal.mediumWords) {
    if (lower.includes(word.toLowerCase())) score += 1.5;
  }
  for (const word of signal.weakWords) {
    if (lower.includes(word.toLowerCase())) score += 0.5;
  }

  // 语法模式匹配加分
  for (const pattern of signal.patterns) {
    const matches = text.match(pattern);
    if (matches) score += matches.length * 2.0;
  }

  // 特异性加成：文本越长、越具体，信号越可信
  const specificityBonus = Math.min(1.0, text.length / 200) * 1.5;
  score += specificityBonus;

  return score;
}

function extractContent(text: string, signal: CategorySignal): string {
  // 从匹配的模式中提取最相关片段
  for (const pattern of signal.patterns) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  // 降级：返回前100个字符
  return text.slice(0, 100);
}

export function extractMemoriesFromConversation(text: string): Partial<MemoryItem>[] {
  const items: Partial<MemoryItem>[] = [];
  if (!text || text.trim().length < 3) return items;

  // 对每个类别评分
  const scored = CATEGORY_SIGNALS.map(signal => ({
    signal,
    score: scoreTextAgainstCategory(text, signal),
  })).filter(s => s.score > 2.5); // 最低信号阈值

  // 按得分降序排列
  scored.sort((a, b) => b.score - a.score);

  for (const { signal, score } of scored) {
    // 优先级 = 基础优先级 + 信号强度加成（最高10）
    const priority = Math.min(10, signal.basePriority + Math.floor(score / 4));

    items.push({
      type: signal.type,
      content: extractContent(text, signal),
      tags: signal.tags,
      priority,
    });
  }

  return items;
}