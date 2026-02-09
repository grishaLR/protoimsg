import { useCallback, useState } from 'react';

const STORAGE_KEY = 'chatmosphere:collapsed-groups';

function loadCollapsed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // Ignore corrupt data
  }
  return new Set();
}

function saveCollapsed(collapsed: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...collapsed]));
}

export function useCollapsedGroups() {
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed);

  const toggle = useCallback((name: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      saveCollapsed(next);
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
