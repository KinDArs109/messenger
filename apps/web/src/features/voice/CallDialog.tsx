import { motion } from "motion/react";
import { Phone, PhoneOff } from "lucide-react";
import { useStore } from "@/lib/store";
import { Avatar } from "@/components/Avatar";
import { useCalls } from "./useCalls";

/** Чем кончился звонок — человеческими словами. */
const ENDINGS: Record<string, string> = {
  declined: "Отклонил",
  cancelled: "Звонок отменён",
  missed: "Не ответил",
  busy: "Занято",
  offline: "Не в сети",
  accepted: "Соединяю…",
};

/**
 * Окно входящего звонка.
 *
 * Поверх всего приложения, а не внутри переписки: звонок застаёт
 * человека где угодно, в том числе на другом сервере, и прятать его
 * за выбором канала бессмысленно.
 *
 * Исходящий звонок сюда больше не попадает. Раньше попадал — и окно
 * закрывало собой переписку ровно тогда, когда звонящий на неё
 * и смотрит: он же только что оттуда позвонил. Теперь исходящий идёт
 * полосой в самой переписке, как разговор, в который он превратится.
 */
export function CallDialog() {
  const call = useStore((s) => s.call);
  const { accept, decline, cancel } = useCalls();

  if (!call || !call.incoming) return null;

  const ending = call.state ? ENDINGS[call.state] : null;
  const name = call.peer?.displayName ?? "Собеседник";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={call.incoming ? `Входящий звонок: ${name}` : `Звоню: ${name}`}
    >
      <motion.div
        initial={{ scale: 0.94, y: 8 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 420, damping: 30 }}
        className="w-full max-w-[340px] rounded-2xl border border-line bg-chat p-6 text-center shadow-2xl"
      >
        {call.peer ? (
          <div className="mx-auto mb-4 w-fit">
            <Avatar user={call.peer} size={88} />
          </div>
        ) : (
          <div className="mx-auto mb-4 size-[88px] rounded-full bg-raised" />
        )}

        <h2 className="truncate text-lg font-semibold text-bright">{name}</h2>
        <p className="mt-1 text-sm text-muted">
          {call.error ?? ending ?? (call.incoming ? "Входящий звонок" : "Звоню…")}
        </p>

        {/* Пока идёт — кнопки. Кончился — только надпись: нажимать
            уже нечего, а кнопка «ответить» на «не ответил» выглядит
            издевательством. */}
        {!ending && !call.error && (
          <div className="mt-6 flex items-center justify-center gap-4">
            {call.incoming && (
              <button
                onClick={accept}
                title="Ответить"
                aria-label="Ответить"
                className="flex size-14 items-center justify-center rounded-full bg-online text-white transition-transform hover:scale-105"
              >
                <Phone className="size-6" />
              </button>
            )}
            <button
              onClick={call.incoming ? decline : cancel}
              title={call.incoming ? "Отклонить" : "Отменить"}
              aria-label={call.incoming ? "Отклонить" : "Отменить"}
              className="flex size-14 items-center justify-center rounded-full bg-danger text-white transition-transform hover:scale-105"
            >
              <PhoneOff className="size-6" />
            </button>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}
