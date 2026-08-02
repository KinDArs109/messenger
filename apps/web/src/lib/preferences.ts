import { useSyncExternalStore } from "react";

/** Личные настройки внешнего вида.
 *
 *  Живут в localStorage, а не на сервере, и это осознанно: это
 *  свойства устройства, а не учётной записи. На рабочем мониторе
 *  уместна компактная лента, на ноутбуке в дороге — нет, и тащить
 *  такое между устройствами было бы вредно. */
export interface Preferences {
  compact: boolean;
  reducedMotion: boolean;
  alwaysTime: boolean;
}

const DEFAULTS: Preferences = {
  compact: false,
  reducedMotion: false,
  alwaysTime: false,
};

const KEY = "messenger:prefs";

function read(): Preferences {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    // Ключи сверяем с умолчаниями, а не берём как есть: в хранилище
    // может лежать что угодно из прошлой версии или чужой вкладки.
    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      compact: parsed.compact ?? DEFAULTS.compact,
      reducedMotion: parsed.reducedMotion ?? DEFAULTS.reducedMotion,
      alwaysTime: parsed.alwaysTime ?? DEFAULTS.alwaysTime,
    };
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** Класс на <html> — чтобы стили могли реагировать без пробрасывания
 *  настройки через десяток компонентов. */
export function applyPreferences(prefs: Preferences = current): void {
  const root = document.documentElement;
  root.classList.toggle("prefs-compact", prefs.compact);
  root.classList.toggle("prefs-still", prefs.reducedMotion);
  root.classList.toggle("prefs-always-time", prefs.alwaysTime);
}

export function setPreference<K extends keyof Preferences>(key: K, value: Preferences[K]): void {
  current = { ...current, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    // Приватный режим может запретить запись. Настройка всё равно
    // применится к текущей сессии — это лучше, чем упасть.
  }
  applyPreferences();
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePreferences(): {
  prefs: Preferences;
  setPref: typeof setPreference;
} {
  const prefs = useSyncExternalStore(
    subscribe,
    () => current,
    () => DEFAULTS,
  );
  return { prefs, setPref: setPreference };
}
