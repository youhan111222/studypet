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

// 记忆提取与关联函数
export function extractMemoriesFromConversation(text: string): Partial<MemoryItem>[] {
  const items: Partial<MemoryItem>[] = [];
  const lower = text.toLowerCase();

  // 检测长期目标
  if (lower.includes('想去') || lower.includes('希望') || lower.includes('目标') || lower.includes('梦想')) {
    const goalMatch = text.match(/想去(.+?)(实习|工作|公司|学校)/) ||
                     text.match(/希望(.+?)(实现|完成|达到)/) ||
                     text.match(/目标(.+?)(是|为)/);
    if (goalMatch) {
      items.push({
        type: 'goal',
        content: goalMatch[0],
        tags: ['goal', 'long-term'],
        priority: 9,
      });
    }
  }

  // 检测偏好
  if (lower.includes('喜欢') || lower.includes('习惯') || lower.includes('偏好') || lower.includes('效率')) {
    const prefMatch = text.match(/喜欢(.+?)(效率|时候|时间)/) ||
                     text.match(/习惯(.+?)(学习|工作)/);
    if (prefMatch) {
      items.push({
        type: 'preference',
        content: prefMatch[0],
        tags: ['preference', 'productivity'],
        priority: 6,
      });
    }
  }

  // 检测薄弱环节
  if (lower.includes('薄弱') || lower.includes('不擅长') || lower.includes('需要提高') || lower.includes('难点')) {
    const weakMatch = text.match(/(薄弱|不擅长|难点)(.+?)(章节|科目|部分)/);
    if (weakMatch) {
      items.push({
        type: 'insight',
        content: weakMatch[0],
        tags: ['weakness', 'improvement'],
        priority: 8,
      });
    }
  }

  return items;
}