// 数据备份/恢复：导出 localStorage 到 JSON 文件，或从文件恢复
// 存储格式与 zustand/persist 一致：{ state: {...}, version: number }
const STORAGE_KEY = 'studypet-data';

interface PersistedPayload {
  state: unknown;
  version?: number;
}

function readPersisted(): PersistedPayload | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedPayload;
  } catch {
    return null;
  }
}

export function exportBackup(): void {
  const persisted = readPersisted();
  if (!persisted) {
    alert('当前没有可导出的本地数据');
    return;
  }
  const payload = {
    app: 'studypet',
    kind: 'local-data-backup',
    exportedAt: new Date().toISOString(),
    version: persisted.version ?? 0,
    data: persisted,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const day = new Date().toISOString().slice(0, 10);
  a.download = 'studypet-backup-' + day + '.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function importBackup(file: File): Promise<void> {
  return file.text().then((text) => {
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error('备份文件不是有效的 JSON');
    }
    const obj = payload as Record<string, unknown>;
    const inner = (obj.data ?? obj) as PersistedPayload | undefined;
    if (!inner || typeof inner !== 'object' || inner.state === undefined || inner.state === null) {
      throw new Error('备份文件缺少 state 数据，格式无效');
    }
    const prev = readPersisted();
    const version = typeof inner.version === 'number' ? inner.version : (prev?.version ?? 0);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: inner.state, version }));
    location.reload();
  });
}
