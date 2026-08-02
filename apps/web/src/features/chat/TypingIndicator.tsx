import { useEffect } from "react";
import { useStore } from "@/lib/store";

export function TypingIndicator() {
  const typing = useStore((s) => s.typing);
  const members = useStore((s) => s.members);
  const sweep = useStore((s) => s.sweepTyping);

  // Сервер шлёт событие, но не шлёт «перестал печатать»: это был бы
  // лишний трафик на каждое нажатие. Гасим по времени сами.
  useEffect(() => {
    const timer = setInterval(sweep, 1000);
    return () => clearInterval(timer);
  }, [sweep]);

  const names = [...typing.keys()]
    .map((id) => members.find((m) => m.id === id)?.displayName)
    .filter((name): name is string => Boolean(name));

  return (
    <div className="h-6 shrink-0 px-4 text-sm text-body" aria-live="polite">
      {names.length > 0 && (
        <>
          <b className="font-semibold">{names.join(", ")}</b>{" "}
          {names.length > 1 ? "печатают…" : "печатает…"}
        </>
      )}
    </div>
  );
}
