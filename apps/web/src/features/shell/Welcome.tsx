import { useState } from "react";
import { Compass, Link2, Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { CreateServerDialog } from "@/features/servers/CreateServerDialog";
import { MobileTopBar } from "@/features/shell/MobileShell";

/** Экран для того, у кого ещё ничего нет.
 *
 *  Раньше здесь было «выберите канал слева», хотя выбирать было
 *  не из чего. Пустой экран без единого действия — самый надёжный
 *  способ потерять человека на первой минуте. */
export function Welcome() {
  const me = useStore((s) => s.me);
  const [creating, setCreating] = useState(false);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <MobileTopBar title="Мессенджер" />
      <div className="flex flex-1 items-center justify-center overflow-y-auto p-6 md:p-8">
        <div className="w-full max-w-[440px] text-center">
          <Compass className="mx-auto mb-4 size-16 text-faint" />

          <h1 className="text-2xl font-semibold text-bright">Привет, {me?.displayName}!</h1>
          <p className="mt-2 mb-8 text-muted">Вы пока никуда не вступили. Есть два пути.</p>

          <div className="space-y-3 text-left">
            <button
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-4 rounded-lg bg-sidebar p-4 text-left hover:bg-raised"
            >
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-online text-white">
                <Plus className="size-6" />
              </span>
              <span>
                <span className="block font-semibold text-bright">Создать свой сервер</span>
                <span className="block text-sm text-muted">
                  Внутри сразу появятся каналы, а друзей позовёте ссылкой
                </span>
              </span>
            </button>

            <div className="flex w-full items-center gap-4 rounded-lg bg-sidebar p-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-raised text-muted">
                <Link2 className="size-6" />
              </span>
              <span>
                <span className="block font-semibold text-bright">Перейти по приглашению</span>
                <span className="block text-sm text-muted">
                  Если вам прислали ссылку вида <code className="text-faint">/invite/…</code> —
                  откройте её
                </span>
              </span>
            </div>
          </div>

          {creating && <CreateServerDialog onClose={() => setCreating(false)} />}
        </div>
      </div>
    </div>
  );
}
