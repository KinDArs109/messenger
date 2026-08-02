import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Link2, Send } from "lucide-react";
import type { DmChannelDto, PublicUser } from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Dialog } from "@/components/Dialog";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/ui/Button";

interface Invite {
  code: string;
  expiresAt: string | null;
}

/** Приглашение: ссылкой или прямо друзьям из списка.
 *
 *  Ссылка остаётся для тех, кого в друзьях нет — переслать её можно
 *  куда угодно. Друзьям же удобнее отправить приглашение отсюда,
 *  не выходя в другой мессенджер за пересылкой. */
export function InviteDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setInvite(await api.post<Invite>(`/servers/${serverId}/invites`, {}));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Не удалось создать ссылку");
      }
    })();
  }, [serverId]);

  const url = invite ? `${location.origin}/invite/${invite.code}` : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Буфер обмена доступен только в защищённом контексте. По http
      // с чужого устройства его не будет — тогда просто выделяем текст.
      const node = document.getElementById("invite-url");
      if (node) document.getSelection()?.selectAllChildren(node);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Dialog title="Пригласить друзей" description="Ссылка действует неделю" onClose={onClose}>
      {error ? (
        <p role="alert" className="rounded-sm bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : (
        <div className="flex items-center gap-2 rounded bg-rail p-2">
          <Link2 className="ml-1 size-4 shrink-0 text-faint" />
          <code id="invite-url" className="min-w-0 flex-1 truncate font-mono text-sm text-body">
            {invite ? url : "создаём ссылку…"}
          </code>
          <button
            onClick={() => void copy()}
            disabled={!invite}
            className="flex shrink-0 items-center gap-1.5 rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? "Готово" : "Копировать"}
          </button>
        </div>
      )}

      <FriendInvites serverId={serverId} url={url} />

      <p className="mt-4 text-xs text-faint">
        Ссылка работает, пока включён компьютер с мессенджером. Отправляйте её только тем, кого
        действительно зовёте: по ней вступают без подтверждения.
      </p>
    </Dialog>
  );
}

/** Друзья, которых ещё нет на сервере.
 *
 *  Приглашение уходит обычным личным сообщением со ссылкой, а не
 *  особой сущностью «приглашение». Так у получателя не появляется
 *  ничего нового: он видит сообщение от друга и переходит по ссылке
 *  ровно так же, как если бы её переслали из другого мессенджера. */
function FriendInvites({ serverId, url }: { serverId: string; url: string }) {
  const friendships = useStore((s) => s.friendships);
  const members = useStore((s) => s.members);
  const servers = useStore((s) => s.servers);
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serverName = servers.find((s) => s.id === serverId)?.name ?? "сервер";

  // Тех, кто уже на сервере, не показываем: звать их некуда.
  const candidates = useMemo(() => {
    const onServer = new Set(members.map((m) => m.id));
    return friendships
      .filter((f) => f.status === "ACCEPTED" && !onServer.has(f.user.id))
      .map((f) => f.user);
  }, [friendships, members]);

  async function invite(user: PublicUser) {
    setBusy(user.id);
    setError(null);
    try {
      const dm = await api.post<{ dm: DmChannelDto }>("/dms", { userId: user.id });
      useStore.getState().addDm(dm.dm);
      await api.post(`/channels/${dm.dm.id}/messages`, {
        content: `Приглашаю на сервер «${serverName}»: ${url}`,
      });
      setSent(new Set([...sent, user.id]));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось отправить");
    } finally {
      setBusy(null);
    }
  }

  if (!url) return null;

  return (
    <div className="mt-5 border-t border-line pt-4">
      <h3 className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">Позвать друзей</h3>

      {candidates.length === 0 ? (
        <p className="text-sm text-muted">
          {friendships.some((f) => f.status === "ACCEPTED")
            ? "Все ваши друзья уже здесь."
            : "Друзей пока нет — добавьте по имени пользователя в разделе «Друзья»."}
        </p>
      ) : (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {candidates.map((user) => (
            <li key={user.id} className="flex items-center gap-3 rounded px-1 py-1">
              <Avatar user={user} size={28} />
              <div className="min-w-0 flex-1 leading-tight">
                <div className="truncate text-sm text-bright">{user.displayName}</div>
                <div className="truncate text-xs text-muted">@{user.username}</div>
              </div>
              <Button
                size="sm"
                variant={sent.has(user.id) ? "ghost" : "secondary"}
                disabled={sent.has(user.id)}
                loading={busy === user.id}
                onClick={() => void invite(user)}
              >
                {sent.has(user.id) ? (
                  <>
                    <Check className="size-4" />
                    Отправлено
                  </>
                ) : (
                  <>
                    <Send className="size-4" />
                    Позвать
                  </>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
    </div>
  );
}
