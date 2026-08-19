import { useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Hash, Pencil, Plus, Settings, UserPlus, Volume2 } from "lucide-react";
import { can, type ChannelDto, type ChannelType, type ChosenStatus } from "@messenger/shared";
import { currentServer, hasUnread, usePresence, useStore } from "@/lib/store";
import { Avatar } from "@/components/Avatar";
import { InviteDialog } from "@/features/invites/InviteDialog";
import { DmSidebar } from "@/features/dms/DmSidebar";
import { SettingsDialog } from "@/features/settings/SettingsDialog";
import { VoiceBar } from "@/features/voice/VoiceBar";
import { VoiceMembers } from "@/features/voice/VoiceMembers";
import { SelfAudioControls } from "@/features/voice/SelfAudioControls";
import { useVoice } from "@/features/voice/useVoice";
import { ServerSettingsDialog } from "@/features/servers/ServerSettingsDialog";
import { CreateChannelDialog } from "./CreateChannelDialog";
import { StatusMenu } from "@/features/shell/StatusMenu";
import { api } from "@/lib/api";
import { setAccessToken } from "@/lib/api";
import { disconnectSocket } from "@/lib/socket";
import { forgetEverything } from "@/lib/offline";
import { cn } from "@/lib/utils";

export function ChannelSidebar() {
  const server = useStore(currentServer);
  const channelId = useStore((s) => s.channelId);
  const selectChannel = useStore((s) => s.selectChannel);
  const me = useStore((s) => s.me);
  const statusOf = usePresence();

  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState<ChannelType | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const myStatus = useStore((s) => s.myStatus);
  const voiceChannelId = useStore((s) => s.voiceChannelId);
  const { join: joinVoice } = useVoice();

  const text = server?.channels.filter((c) => c.type === "TEXT") ?? [];
  const voice = server?.channels.filter((c) => c.type === "VOICE") ?? [];
  const mayCreate = server ? can(server.role, "channel:create") : false;

  // Вкладок «Каналы / Личные» здесь больше нет: они дублировали
  // кнопку личных сообщений в рейле слева, которая делает ровно то же
  // самое. Раздел выбирается там же, где сервер, — одним способом,
  // а не двумя. Счётчик непрочитанных переписок переехал на ту кнопку.
  const showDms = !server;

  async function logout() {
    await api.post("/auth/logout").catch(() => undefined);
    setAccessToken(null);
    disconnectSocket();
    // Стираем и сохранённую переписку. Иначе «выйти» означало бы
    // «выйти, но всё осталось лежать на диске и откроется без пароля
    // у любого, кто откроет приложение без сети».
    forgetEverything();
    useStore.getState().reset();
  }

  return (
    // w-60 (240) до md и w-side (264) от него: шире столбец нужен там,
    // где рядом стоит лента, а не там, где он её закрывает.
    <div className="flex w-60 shrink-0 flex-col bg-sidebar md:w-side">
      {/* Раздел ЛС занимает то же место, что список каналов: панель
          пользователя внизу общая для обоих. */}
      {/* Баннер сервера — награда второго уровня. Стоит над всем
          остальным и ничего не закрывает: это картинка, а не фон,
          и текст поверх неё не читался бы. */}
      {server?.bannerUrl && (
        <img
          src={server.bannerUrl}
          alt=""
          className="h-24 w-full shrink-0 object-cover"
        />
      )}

      {server && (
        <div className="flex h-head shrink-0 items-center gap-1 px-4 pt-safe font-semibold text-bright shadow-[0_1px_0_rgba(0,0,0,0.2)]">
          <span className="mr-auto truncate">{server.name}</span>
          {/* Настройки сервера — только тем, кто может его править.
              Остальным кнопка, которая всегда отвечает «нельзя»,
              не нужна. */}
          {can(server.role, "server:edit") && (
            <button
              onClick={() => setEditing(true)}
              title="Настройки сервера"
              aria-label="Настройки сервера"
              className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-body"
            >
              <Pencil className="size-5" />
            </button>
          )}
          <button
            onClick={() => setInviting(true)}
            title="Пригласить друзей"
            aria-label="Пригласить друзей"
            className="shrink-0 rounded p-1 text-muted hover:bg-hover hover:text-body"
          >
            <UserPlus className="size-5" />
          </button>
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
            <DmSidebar />
          ) : (
            <div className="flex-1 overflow-y-auto p-2">
              <Category
                title="Текстовые каналы"
                channels={text}
                active={channelId}
                onSelect={selectChannel}
                onAdd={mayCreate ? () => setCreating("TEXT") : undefined}
              />
              {/* Клик по голосовому каналу делает две вещи сразу:
                  подключает к разговору и открывает сам канал справа.
                  Заходить в «пустую комнату», а потом искать кнопку
                  «войти» — лишний шаг там, где смысл канала ровно один.
                  А открывать надо потому, что иначе не видно ни состава,
                  ни демонстраций — в том числе своей. */}
              <Category
                title="Голосовые каналы"
                channels={voice}
                active={voiceChannelId}
                onSelect={(id) => {
                  selectChannel(id);
                  void joinVoice(id);
                }}
                onAdd={mayCreate ? () => setCreating("VOICE") : undefined}
                renderAfter={(id) => <VoiceMembers channelId={id} />}
              />

              {/* Участников здесь больше нет — ни на каком экране.
                  На обычном они стоят своим столбцом справа, на телефоне
                  выезжают своей шторкой, тоже справа. Под каналами они
                  делили с ними прокрутку: до «кто в сети» приходилось
                  листать мимо всех каналов сервера, и находились они
                  слева, хотя всюду стоят справа. */}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <VoiceBar />

      {me && (
        // min-h вместо h: снизу добавляется безопасная зона телефона,
        // и при жёсткой высоте она съедала бы саму строку.
        <div className="relative flex min-h-[52px] shrink-0 items-center gap-0.5 bg-panel px-2 pb-safe">
          {/* Нажатие на себя открывает выбор статуса — там же, где
              человек его и ищет: на собственном имени в углу.
              Имя ужимается первым: кнопки нужны целиком, а имя
              и в обрезанном виде узнаётся. */}
          <button
            onClick={() => setStatusOpen((open) => !open)}
            title="Статус"
            aria-label="Выбрать статус"
            aria-haspopup="menu"
            aria-expanded={statusOpen}
            className="flex min-w-0 flex-1 items-center gap-2 rounded p-1 text-left hover:bg-hover"
          >
            <Avatar user={me} size={32} status={statusOf(me)} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold text-bright">
                {me.displayName}
              </span>
              <span className="block truncate text-xs text-muted">
                {STATUS_WORD[myStatus]}
              </span>
            </span>
          </button>

          {statusOpen && <StatusMenu onClose={() => setStatusOpen(false)} />}

          {/* Микрофон и наушники здесь, а не в полоске разговора:
              выключить микрофон бывает надо и до входа в разговор,
              а полоска появляется только внутри него. */}
          <SelfAudioControls />

          <button
            onClick={() => setSettingsOpen(true)}
            title="Настройки"
            aria-label="Настройки"
            className="shrink-0 rounded p-2 text-muted hover:bg-hover hover:text-bright md:p-1"
          >
            <Settings className="size-5" />
          </button>
        </div>
      )}

      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} onLogout={() => void logout()} />
      )}

      {inviting && server && (
        <InviteDialog serverId={server.id} onClose={() => setInviting(false)} />
      )}
      {editing && server && (
        <ServerSettingsDialog server={server} onClose={() => setEditing(false)} />
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
            // Пальцем навести нельзя, и кнопка «создать канал»
            // на телефоне просто не существовала. Показываем её там
            // всегда — прятать нечего, места она не занимает.
            className="mr-1 rounded p-2 text-muted opacity-0 group-hover/cat:opacity-100 focus-visible:opacity-100 hover:text-bright md:p-0.5 pointer-coarse:opacity-100"
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

/** Подпись под именем: что человек сам о себе выбрал.
 *
 *  Раньше там стоял «@логин» — тот же, что и в профиле, и в шапке,
 *  и никому в третий раз не нужный. Статус же меняется, и видеть
 *  его надо ровно там, где его меняют. */
const STATUS_WORD: Record<ChosenStatus, string> = {
  online: "В сети",
  idle: "Неактивен",
  dnd: "Не беспокоить",
  invisible: "Невидимый",
};
