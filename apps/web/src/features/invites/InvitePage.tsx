import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { InvitePreview, ServerDto } from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { useStore } from "@/lib/store";
import { initial } from "@/lib/utils";

/** Страница по ссылке-приглашению.
 *
 *  Предпросмотр показывается и без входа: человек должен увидеть,
 *  куда его зовут, прежде чем заводить учётную запись. Если он не
 *  авторизован — под карточкой появляется форма, и после регистрации
 *  вступление происходит само, без второго клика по ссылке. */
export function InvitePage({ code, onDone }: { code: string; onDone: () => void }) {
  const me = useStore((s) => s.me);
  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setPreview(await api.get<InvitePreview>(`/invites/${code}`));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Не удалось открыть приглашение");
      }
    })();
  }, [code, me]);

  async function join() {
    setJoining(true);
    setError(null);
    try {
      const r = await api.post<{ server: ServerDto }>(`/invites/${code}/join`);
      const store = useStore.getState();
      const servers = store.servers.some((s) => s.id === r.server.id)
        ? store.servers
        : [...store.servers, { ...r.server, role: "MEMBER" as const }];
      store.setServers(servers);
      store.selectServer(r.server.id);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не удалось вступить");
      setJoining(false);
    }
  }

  if (error && !preview) {
    return (
      <Centered>
        <h1 className="mb-2 text-xl font-semibold text-bright">Ссылка недействительна</h1>
        <p className="mb-6 text-muted">{error}</p>
        <button onClick={onDone} className="rounded-sm bg-accent px-6 py-2.5 font-medium text-white hover:bg-accent-hover">
          На главную
        </button>
      </Centered>
    );
  }

  if (!preview) {
    return (
      <Centered>
        <Loader2 className="size-8 animate-spin text-muted" />
      </Centered>
    );
  }

  return (
    <Centered>
      <div
        aria-hidden
        className="mb-4 flex size-20 items-center justify-center rounded-3xl bg-accent text-3xl font-semibold text-white"
      >
        {initial(preview.server.name)}
      </div>

      <p className="text-muted">
        <b className="font-semibold text-body">{preview.inviter}</b> приглашает вас на сервер
      </p>
      <h1 className="mt-1 mb-1 text-2xl font-semibold text-bright">{preview.server.name}</h1>
      <p className="mb-6 text-sm text-muted">
        {preview.memberCount} {plural(preview.memberCount, "участник", "участника", "участников")}
      </p>

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}

      {me ? (
        <button
          onClick={() => void join()}
          disabled={joining}
          className="flex w-full items-center justify-center gap-2 rounded-sm bg-accent px-6 py-2.5 font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {joining && <Loader2 className="size-4 animate-spin" />}
          {preview.alreadyMember ? "Открыть сервер" : "Принять приглашение"}
        </button>
      ) : (
        <p className="text-sm text-muted">Войдите или зарегистрируйтесь, чтобы принять</p>
      )}
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-chat p-4">
      <div className="flex w-full max-w-[420px] flex-col items-center rounded-md bg-sidebar p-8 text-center">
        {children}
      </div>
    </div>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
