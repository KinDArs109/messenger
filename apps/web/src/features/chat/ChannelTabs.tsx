import { useMemo } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AtSign, Hash, Volume2, X } from "lucide-react";
import {
  describeChannel,
  hasUnread,
  useStore,
  type ActiveChannel,
  type ChannelSource,
} from "@/lib/store";
import { cn } from "@/lib/utils";

/** Полоса открытых каналов над лентой.
 *
 *  Смысл ровно тот же, что у вкладок браузера: держать под рукой
 *  несколько разговоров и прыгать между ними одним кликом, не ища
 *  каждый раз нужный канал в списке слева. Вкладки общие для всех
 *  серверов — переход по вкладке сам переключит и сервер. */
export function ChannelTabs() {
  const openChannels = useStore((s) => s.openChannels);
  const channelId = useStore((s) => s.channelId);
  const servers = useStore((s) => s.servers);
  const dms = useStore((s) => s.dms);
  const me = useStore((s) => s.me);
  const readStates = useStore((s) => s.readStates);
  const selectChannel = useStore((s) => s.selectChannel);
  const closeChannel = useStore((s) => s.closeChannel);

  // Собираем описания разом и запоминаем: describeChannel строит
  // новый объект на каждый вызов, и без useMemo полоса пересчитывалась
  // бы на любое изменение состояния.
  const tabs = useMemo(() => {
    const source: ChannelSource = { servers, dms, me };
    return openChannels
      .map((id) => describeChannel(source, id))
      .filter((tab): tab is ActiveChannel => Boolean(tab));
  }, [openChannels, servers, dms, me]);

  // Одна вкладка — это не выбор, а лишняя полоса на экране.
  if (tabs.length < 2) return null;

  return (
    <div className="flex shrink-0 items-stretch gap-1 overflow-x-auto border-b border-line bg-rail/40 px-2 pt-1.5">
      <AnimatePresence initial={false}>
        {tabs.map((tab) => {
          const active = tab.id === channelId;
          const read = readStates.get(tab.id);
          const unread = !active && hasUnread(read);
          const mentions = read?.mentionCount ?? 0;
          const Icon = tab.isDm ? AtSign : tab.type === "VOICE" ? Volume2 : Hash;

          return (
            <motion.div
              key={tab.id}
              layout
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
              className="relative shrink-0 overflow-hidden"
            >
              <button
                type="button"
                onClick={() => selectChannel(tab.id)}
                // Подпись обрезается по ширине и лежит во вложенном
                // span рядом со счётчиком — имя задаём явно.
                aria-label={tab.name}
                aria-current={active ? "true" : undefined}
                className={cn(
                  "flex h-9 max-w-[200px] items-center gap-1.5 rounded-t-md py-0 pr-8 pl-3 text-sm",
                  "transition-colors duration-150",
                  active
                    ? "bg-chat font-medium text-bright"
                    : unread
                      ? "font-semibold text-bright hover:bg-hover"
                      : "text-muted hover:bg-hover hover:text-body",
                )}
              >
                <Icon className="size-4 shrink-0 text-faint" />
                <span className="truncate">{tab.name}</span>

                {mentions > 0 && (
                  <span className="shrink-0 rounded-full bg-danger px-1.5 text-[11px] leading-4 font-bold text-white">
                    {mentions > 99 ? "99+" : mentions}
                  </span>
                )}
              </button>

              {/* Крестик — отдельная кнопка рядом, а не внутри вкладки.
                  Кнопка внутри кнопки недопустима: разметка невалидна,
                  а скринридер читает такую пару как одну сущность. */}
              <button
                type="button"
                aria-label={`Закрыть ${tab.name}`}
                onClick={() => closeChannel(tab.id)}
                className="absolute top-1/2 right-1 -translate-y-1/2 rounded p-0.5 text-faint hover:bg-active hover:text-bright"
              >
                <X className="size-3.5" />
              </button>

              {active && (
                <motion.span
                  layoutId="channel-tab-underline"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-accent"
                />
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
