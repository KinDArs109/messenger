import { useState } from "react";
import { Rocket } from "lucide-react";
import { BOOST_TIERS, boostsToNext, type ServerDto } from "@messenger/shared";
import { api } from "@/lib/api";
import { useStore } from "@/lib/store";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

/**
 * Поддержка сервера — то, что в дискорде зовётся бустом.
 *
 * С одной существенной разницей: денег здесь нет. Продавать вам
 * снятие ограничений, которые поставили мы же, было бы странно —
 * сервер ваш, платить пришлось бы себе. Поэтому буст остался
 * механикой: один голос от каждого, и на каждом уровне открывается
 * что-то настоящее.
 *
 * Пороги маленькие, потому что и компания маленькая: четверо друзей.
 * Четырнадцать бустов, как в дискорде, здесь означали бы «никогда».
 */
export function BoostPanel({ server }: { server: ServerDto }) {
  const meId = useStore((s) => s.me?.id);
  const applyBoost = useStore((s) => s.applyBoost);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const boosts = server.boostedBy.length;
  const mine = meId ? server.boostedBy.includes(meId) : false;
  const need = boostsToNext(boosts);

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const patch = mine
        ? await api.delete<{
            serverId: string;
            boostedBy: string[];
            level: number;
            bannerUrl: string | null;
          }>(`/servers/${server.id}/boost`)
        : await api.put<{
            serverId: string;
            boostedBy: string[];
            level: number;
            bannerUrl: string | null;
          }>(`/servers/${server.id}/boost`);
      // Своё состояние правим ответом, чужие — событием сокета.
      // Считает уровень в обоих случаях сервер: два счёта одного
      // и того же однажды разойдутся.
      applyBoost(patch);
    } catch {
      setError("Не получилось — попробуйте ещё раз");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            server.level > 0 ? "bg-accent/20 text-accent" : "bg-raised text-faint",
          )}
        >
          <Rocket className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-bright">
            {server.level > 0 ? `Уровень ${server.level}` : "Уровня пока нет"}
          </div>
          <div className="text-xs text-muted">
            {/* Слово «буст» склоняем руками: «1 буст», «2 буста»,
                «5 бустов» — иначе получается «1 бустов». */}
            {boosts} {plural(boosts, "буст", "буста", "бустов")}
            {need !== null && ` · до следующего уровня ещё ${need}`}
          </div>
        </div>
        <Button size="sm" variant={mine ? "ghost" : "primary"} loading={pending} onClick={() => void toggle()}>
          {mine ? "Убрать" : "Поддержать"}
        </Button>
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}

      {/* Что даёт каждый уровень. Список честный: всё, что здесь
          написано, работает — иначе это не уровни, а надпись. */}
      <ul className="space-y-1.5">
        {BOOST_TIERS.map((tier) => {
          const reached = server.level >= tier.level;
          return (
            <li
              key={tier.level}
              className={cn(
                "flex items-start gap-2 rounded-md px-2 py-1.5 text-xs",
                reached ? "bg-online/10 text-body" : "text-muted",
              )}
            >
              <span
                className={cn(
                  "mt-px flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                  reached ? "bg-online text-white" : "bg-raised text-faint",
                )}
              >
                {tier.level}
              </span>
              <span>
                {tier.unlocks}
                <span className="text-faint">
                  {" "}
                  · {tier.boosts} {plural(tier.boosts, "буст", "буста", "бустов")}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Русские числительные: 1 буст, 2 буста, 5 бустов. */
function plural(n: number, one: string, few: string, many: string): string {
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 14) return many;
  const mod10 = n % 10;
  if (mod10 === 1) return one;
  if (mod10 >= 2 && mod10 <= 4) return few;
  return many;
}
