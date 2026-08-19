import { useEffect, useState } from "react";
import { Monitor, AppWindow } from "lucide-react";
import { Dialog } from "@/components/Dialog";
import { Tabs } from "@/components/ui/Tabs";
import { desktop } from "@/lib/desktop";
import { usePreferences } from "@/lib/preferences";
import { ScreenQuality } from "./ScreenQuality";

/**
 * Выбор того, что показывать — внутри приложения.
 *
 * В браузере это окно рисует сам браузер и здесь не появляется вовсе.
 * В оболочке своего выбора нет, и раньше на его месте открывалось
 * отдельное окно системы: со своей рамкой, заголовком и иконкой
 * в панели задач. Посреди мессенджера оно выглядело чужим.
 */

export interface ScreenSource {
  id: string;
  name: string;
  kind: "screen" | "window";
  thumbnail: string;
}

export function ScreenPicker() {
  const [sources, setSources] = useState<ScreenSource[] | null>(null);
  const [kind, setKind] = useState<"screen" | "window">("screen");
  const { prefs } = usePreferences();

  useEffect(() => {
    const bridge = desktop();
    if (!bridge) return;
    return bridge.onScreenPick((list) => {
      setSources(list);
      // Экраны первыми: показывают чаще всего именно экран целиком.
      setKind(list.some((s) => s.kind === "screen") ? "screen" : "window");
    });
  }, []);

  if (!sources) return null;

  function choose(id: string | null) {
    setSources(null);
    desktop()?.screenPicked(id);
  }

  const shown = sources.filter((source) => source.kind === kind);

  return (
    <Dialog
      title="Что показать"
      // Число кадров называем настоящее, а не жёстко зашитое: оно
      // выбирается тут же, ниже, и подпись обязана за ним следовать.
      description={`Изображение пойдёт напрямую собеседникам, ${prefs.screenFps} кадров в секунду.`}
      width={560}
      // Закрыли крестиком или Escape — тот же отказ, что и «Отмена».
      // Не ответить оболочке нельзя: она ждёт решения.
      onClose={() => choose(null)}
    >
      <Tabs
        items={[
          { value: "screen" as const, label: "Экраны", icon: <Monitor className="size-4" /> },
          { value: "window" as const, label: "Окна", icon: <AppWindow className="size-4" /> },
        ]}
        value={kind}
        onChange={setKind}
        className="mb-4"
      />

      {shown.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted">Ничего не нашлось</p>
      ) : (
        <ul className="grid max-h-[320px] grid-cols-2 gap-3 overflow-y-auto">
          {shown.map((source) => (
            <li key={source.id}>
              <button
                type="button"
                onClick={() => choose(source.id)}
                className="w-full rounded-lg border-2 border-transparent bg-raised p-2 text-left transition-colors hover:border-accent focus-visible:border-accent focus-visible:outline-none"
              >
                <img
                  src={source.thumbnail}
                  alt=""
                  className="aspect-video w-full rounded bg-black object-cover"
                />
                {/* Имя окна пишет посторонняя программа — только
                    текстом, никакой разметки. */}
                <span className="mt-1.5 block truncate text-xs text-muted" title={source.name}>
                  {source.name}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Качество — здесь, а не в настройках: его выбирают ровно
          в эту секунду, а в настройки перед показом никто не ходит.
          Сводка слева, шестерёнка справа: обычно менять ничего не надо,
          а развёрнутый список занимал полокна и мешал выбирать. */}
      <div className="mt-4 border-t border-line pt-3">
        <ScreenQuality />
      </div>
    </Dialog>
  );
}
