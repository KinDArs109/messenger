import { useEffect, useState } from "react";
import type { InvitePreview, ServerDto } from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { initial } from "@/lib/utils";

/**
 * Приглашение на сервер — карточкой прямо в переписке.
 *
 * Раньше друг получал в личку голую ссылку: её надо было заметить,
 * нажать, уйти из приложения в браузер и вернуться. Теперь он видит,
 * куда его зовут и сколько там людей, и нажимает «Принять» на месте.
 *
 * Ссылка при этом никуда не делась — она осталась внутри сообщения
 * и работает как раньше. Просто её больше не приходится читать
 * глазами: карточка рисуется по ней.
 */
export function InviteCard({ code }: { code: string }) {
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const servers = useStore((s) => s.servers);

  // Уже состоим — узнаём из своего же списка, не спрашивая сервер:
  // после «Принять» карточка должна поменяться сразу.
  const joined = preview ? servers.some((s) => s.id === preview.server.id) : false;

  useEffect(() => {
    let cancelled = false;
    api
      .get<InvitePreview>(`/invites/${code}`)
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err) => {
        if (cancelled) return;
        // Протухшее приглашение — обычное дело, а не поломка.
        setError(err instanceof ApiError ? err.message : "Приглашение не открылось");
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  async function accept() {
    setJoining(true);
    setError(null);
    try {
      const r = await api.post<{ server: ServerDto }>(`/invites/${code}/join`);
      const store = useStore.getState();
      store.setServers([...store.servers.filter((s) => s.id !== r.server.id), r.server]);
      store.selectServer(r.server.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось принять");
    } finally {
      setJoining(false);
    }
  }

  if (error) {
    return (
      <div className="mt-1 w-fit max-w-[400px] rounded-lg border border-line bg-rail px-3 py-2 text-sm text-muted">
        {error}
      </div>
    );
  }

  return (
    <div className="mt-1 w-fit max-w-[400px] rounded-lg border border-line bg-rail p-3">
      <p className="mb-2 text-xs font-bold tracking-wide text-muted uppercase">
        Приглашение на сервер
      </p>

      {!preview ? (
        <div className="flex items-center gap-3">
          <span className="size-12 shrink-0 animate-pulse rounded-2xl bg-raised" />
          <span className="h-4 w-32 animate-pulse rounded bg-raised" />
        </div>
      ) : (
        <div className="flex items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-lg font-semibold text-white">
            {initial(preview.server.name)}
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate font-semibold text-bright">{preview.server.name}</div>
            <div className="truncate text-xs text-muted">
              {preview.memberCount} уч. · позвал {preview.inviter}
            </div>
          </div>
          {joined || preview.alreadyMember ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={() => useStore.getState().selectServer(preview.server.id)}
            >
              Перейти
            </Button>
          ) : (
            <Button size="sm" loading={joining} onClick={() => void accept()}>
              Принять
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Код приглашения из текста сообщения — по нашей же ссылке.
 *
 *  Только свой адрес: карточка ходит на сервер по этому коду, и
 *  превращать в неё чужие ссылки нельзя. */
export function findInviteCode(content: string): string | null {
  // Разбираем ссылку как ссылку, а не сравниваем строки: собирать
  // регулярное выражение из адреса — верный способ ошибиться
  // на экранировании и однажды принять чужой домен за свой.
  for (const match of content.matchAll(/https?:\/\/\S+/g)) {
    try {
      const url = new URL(match[0]);
      if (url.origin !== location.origin) continue;
      const code = /^\/invite\/([a-z0-9]{4,16})\/?$/.exec(url.pathname)?.[1];
      if (code) return code;
    } catch {
      // Похоже на ссылку, но ссылкой не является.
    }
  }
  return null;
}
