import { useMemo, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Hash, LogOut, Plus, Settings, UserPlus, Volume2 } from "lucide-react";
import { can, type ChannelDto, type ChannelType } from "@messenger/shared";
import { currentServer, hasUnread, useStore } from "@/lib/store";
import { Tabs } from "@/components/ui/Tabs";
import { Avatar } from "@/components/Avatar";
import { InviteDialog } from "@/features/invites/InviteDialog";
import { DmSidebar } from "@/features/dms/DmSidebar";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { VoiceBar } from "@/features/voice/VoiceBar";
import { VoiceMembers } from "@/features/voice/VoiceMembers";
import { useVoice } from "@/features/voice/useVoice";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { api } from "@/lib/api";
import { setAccessToken } from "@/lib/api";
import { disconnectSocket } from "@/lib/socket";
import { cn } from "@/lib/utils";

export function ChannelSidebar() {
  const server = useStore(currentServer);
  const channelId = useStore((s) => s.channelId);
  const selectChannel = useStore((s) => s.selectChannel);
  const me = useStore((s) => s.me);
  const sidebarTab = useStore((s) => s.sidebarTab);
  const setSidebarTab = useStore((s) => s.setSidebarTab);
  const dms = useStore((s) => s.dms);
  const readStates = useStore((s) => s.readStates);

  const [inviting, setInviting] = useState(false);
  const [creating, setCreating] = useState<ChannelType | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const { join: joinVoice } = useVoice();

  const text = server?.channels.filter((c) => c.type === "TEXT") ?? [];
  const voice = server?.channels.filter((c) => c.type === "VOICE") ?? [];
  const mayCreate = server ? can(server.role, "channel:create") : false;

  // Счётчик на вкладке «Личные»: сколько переписок ждут ответа.
  // Без него, уйдя в каналы, о новом сообщении можно узнать только
  // случайно — список ЛС в этот момент не виден.
  const dmsWaiting = useMemo(
    () => dms.filter((dm) => dm.id !== channelId && hasUnread(readStates.get(dm.id))).length,
    [dms, readStates, channelId],
  );

  const tabs = [
    { value: "channels" as const, label: "Каналы" },
    { value: "dms" as const, label: "Личные", badge: dmsWaiting },
  ];

  // Вкладки нужны только внутри сервера. В разделе ЛС переключать
  // нечего: каналов там нет по определению.
  const showTabs = Boolean(server);
  const showDms = !server || sidebarTab === "dms";

  async function logout() {
    await api.post("/auth/logout").catch(() => undefined);
    setAccessToken(null);
    disconnectSocket();
    useStore.getState().reset();
  }

  return (
    <div className="flex w-side shrink-0 flex-col bg-sidebar">
      {/* Раздел ЛС занимает то же место, что список каналов: панель
          пользователя внизу общая для обоих. */}
      {server && (
        <div className="flex h-head shrink-0 items-center gap-2 px-4 font-semibold text-bright shadow-[0_1px_0_rgba(0,0,0,0.2)]">
          <span className="truncate">{server.name}</span>
          <button
            onClick={() => setInviting(true)}
            title="Пригласить друзей"
            aria-label="Пригласить друзей"
            className="ml-auto shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-body"
          >
            <UserPlus className="size-5" />
          </button>
        </div>
      )}

      {showTabs && (
        <div className="px-2 pt-2">
          <Tabs items={tabs} value={sidebarTab} onChange={setSidebarTab} />
        </div>
      )}

      {/* mode="wait" обязателен: без него старый список ещё уезжает,
          пока новый уже въезжает, и на полсекунды видно два списка
          друг на друге. */}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={showDms ? "dms" : "channels"}
          initial={{ opacity: 0, x: showDms ? 12 : -12 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: showDms ? -12 : 12 }}
          transition={{ duration: 0.16, ease: [0.2, 0, 0.2, 1] }}
          className="flex min-h-0 flex-1 flex-col"
        >
          {showDms ? (
            <DmSidebar withHeader={!server} />
          ) : (
            <div className="flex-1 overflow-y-auto p-2">
              <Category
                title="Текстовые каналы"
                channels={text}
                active={channelId}
                onSelect={selectChannel}
                onAdd={mayCreate ? () => setCreating("TEXT") : undefined}
              />
              {/* Голосовой канал открывается кликом не как текстовый:
                  нажатие сразу подключает к разговору. Заходить
                  в «пустую комнату», а потом искать кнопку «войти» —
                  лишний шаг там, где смысл канала ровно один. */}
              <Category
                title="Голосовые каналы"
                channels={voice}
                active={voiceChannelId}
                onSelect={(id) => void joinVoice(id)}
                onAdd={mayCreate ? () => setCreating("VOICE") : undefined}
                renderAfter={(id) => <VoiceMembers channelId={id} />}
              />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <VoiceBar />

      {me && (
        <div className="flex h-[52px] shrink-0 items-center gap-2 bg-panel px-2">
          <Avatar user={me} size={32} status={me.status} />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-semibold text-bright">{me.displayName}</div>
            <div className="truncate text-xs text-muted">@{me.username}</div>
          </div>
          <button
            onClick={() => setSettingsOpen(true)}
            title="Настройки"
            aria-label="Настройки"
            className="rounded p-1.5 text-muted hover:bg-hover hover:text-bright"
          >
            <Settings className="size-5" />
          </button>
          <button
            onClick={() => void logout()}
            title="Выйти"
            aria-label="Выйти"
            className="rounded p-1.5 text-muted hover:bg-hover hover:text-danger"
          >
            <LogOut className="size-5" />
          </button>
        </div>
      )}

      {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}

      {inviting && server && (
        <InviteDialog serverId={server.id} onClose={() => setInviting(false)} />
      )}
      {creating && server && (
        <CreateChannelDialog
          serverId={server.id}
          initialType={creating}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  );
}

function Category({
  title,
  channels,
  active,
  onSelect,
  onAdd,
  renderAfter,
}: {
  title: string;
  channels: ChannelDto[];
  active: string | null;
  onSelect: (id: string) => void;
  onAdd?: () => void;
  /** Что дорисовать под каналом — список участников разговора.
   *  Через проп, а не внутри Category: категория не должна знать
   *  ничего про голос. */
  renderAfter?: (channelId: string) => ReactNode;
}) {
  const readStates = useStore((s) => s.readStates);

  return (
    <section className="group/cat">
      <div className="flex items-center pt-4 pb-1">
        <h2 className="flex-1 px-2 text-xs font-bold tracking-wide text-muted uppercase">
          {title}
        </h2>
        {onAdd && (
          <button
            onClick={onAdd}
            title={`Создать канал: ${title.toLowerCase()}`}
            aria-label={`Создать канал: ${title.toLowerCase()}`}
            className="mr-1 rounded p-0.5 text-muted opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100 hover:text-bright"
          >
            <Plus className="size-4" />
          </button>
        )}
      </div>

      {channels.length === 0 ? (
        <p className="px-2 pb-1 text-xs text-faint">пока пусто</p>
      ) : (
        <ul>
          {channels.map((channel) => {
            const isActive = channel.id === active;
            const Icon = channel.type === "VOICE" ? Volume2 : Hash;
            const read = readStates.get(channel.id);
            const unread = !isActive && hasUnread(read);
            const mentions = read?.mentionCount ?? 0;

            return (
              <li key={channel.id} className="relative">
                {/* Белая метка слева — то же сообщение, что и жирный
                    шрифт, но её видно боковым зрением. */}
                {unread && (
                  <span
                    aria-hidden
                    className="absolute top-1/2 -left-2 h-2 w-1 -translate-y-1/2 rounded-r bg-bright"
                  />
                )}
                <button
                  onClick={() => onSelect(channel.id)}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "flex h-8 w-full items-center gap-1.5 rounded px-2 text-[15px]",
                    isActive
                      ? "bg-active font-medium text-bright"
                      : unread
                        ? "font-semibold text-bright hover:bg-hover"
                        : "font-medium text-muted hover:bg-hover hover:text-body",
                  )}
                >
                  <Icon className="size-5 shrink-0 text-faint" />
                  <span className="truncate">{channel.name}</span>
                  {mentions > 0 && (
                    <span
                      title={`Упоминаний: ${mentions}`}
                      className="ml-auto rounded-full bg-danger px-1.5 text-xs font-bold text-white"
                    >
                      {mentions > 99 ? "99+" : mentions}
                    </span>
                  )}
                </button>
                {renderAfter?.(channel.id)}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
