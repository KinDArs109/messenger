import { useState } from "react";
import { UserCheck, UserPlus } from "lucide-react";
import type { FriendshipDto } from "@messenger/shared";
import { api, ApiError } from "@/lib/api";
import { useAcquaintance, useStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";

/**
 * Полоса над перепиской с тем, кто вам не друг.
 *
 * Написать здесь может кто угодно — общего сервера и того не нужно.
 * Так и задумано: знакомятся в мессенджере, а не в паспортном столе.
 * Но одинаковый вид у друга и у незнакомца — это уже не свобода,
 * а ловушка: в списке переписок они стоят рядом, одинаковым шрифтом,
 * и понять, кто из них кто, можно было только по памяти.
 *
 * Отсюда полоса. Она же и кнопка: чаще всего незнакомец — это просто
 * друг, которого забыли добавить, и добавить его надо там, где о нём
 * вспомнили, а не в отдельном разделе по логину.
 *
 * Закрыть её нельзя, и это нарочно: закрытая метка перестаёт быть
 * меткой. Она исчезает сама, когда исчезает причина.
 */
export function StrangerNotice({ channelId }: { channelId: string }) {
  const me = useStore((s) => s.me);
  const dm = useStore((s) => s.dms.find((d) => d.id === channelId));
  const other = dm?.participants.find((p) => p.id !== me?.id);
  const friendship = useStore((s) => s.friendships.find((f) => f.user.id === other?.id));
  const kind = useAcquaintance()(other?.id ?? "");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Групповую переписку не размечаем: там «мы не друзья» — вопрос
  // не про одного человека, а про каждого, и одной строкой на всех
  // он не отвечается.
  if (!other || dm?.type !== "DM") return null;
  if (kind === "unknown" || kind === "friend") return null;

  async function add() {
    if (!other) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ friendship: FriendshipDto }>("/friends", {
        username: other.username,
      });
      useStore.getState().upsertFriendship(r.friendship);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  async function answer(agree: boolean) {
    if (!friendship) return;
    setBusy(true);
    setError(null);
    try {
      if (agree) await api.post(`/friends/${friendship.id}/accept`);
      else await api.delete(`/friends/${friendship.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Не получилось");
    } finally {
      setBusy(false);
    }
  }

  const incoming = kind === "incoming";

  return (
    <div className="shrink-0 border-b border-line bg-panel px-3 py-2 md:px-4">
      {/* Переносим по строкам: на телефоне имя и две кнопки в одну
          строку не встают, а обрезать здесь нечего — тут всё нужное. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {incoming ? (
          <UserCheck className="size-4 shrink-0 text-online" />
        ) : (
          <UserPlus className="size-4 shrink-0 text-idle" />
        )}

        <p className="min-w-0 flex-1 text-sm text-muted">
          {incoming ? (
            <>
              <span className="font-medium text-bright">{other.displayName}</span> хочет добавить
              вас в друзья
            </>
          ) : kind === "outgoing" ? (
            <>Заявка отправлена — ждём ответа</>
          ) : (
            <>
              Вы не друзья
              {/* Логин — только там, где он помещается в ту же строку.
                  На телефоне он уводил подпись на вторую, а сказано
                  ею было бы ровно то же самое. */}
              <span className="hidden text-faint sm:inline">: @{other.username}</span>
            </>
          )}
        </p>

        {incoming ? (
          <span className="flex shrink-0 gap-2">
            <Button size="sm" loading={busy} onClick={() => void answer(true)}>
              Принять
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void answer(false)}>
              Отклонить
            </Button>
          </span>
        ) : kind === "stranger" ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={() => void add()}>
            Добавить в друзья
          </Button>
        ) : null}
      </div>

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
