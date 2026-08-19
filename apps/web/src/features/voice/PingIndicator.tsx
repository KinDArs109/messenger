import { Signal, SignalHigh, SignalLow, SignalMedium } from "lucide-react";
import { useStore } from "@/lib/store";

/**
 * Качество связи в разговоре.
 *
 * Показывает задержку до собеседника — не до сервера: сервер
 * в разговоре не участвует, звук идёт напрямую, и его пинг ничего
 * не говорит о том, как слышно.
 *
 * Пока в канале никого больше нет, мерить дорогу до собеседника
 * не по чему, и тогда показывается время до сервера. Это другое
 * число про другое, поэтому оно и подписано по-другому: соврать
 * тут проще всего, а разбираться потом будет некому.
 */

/** Границы взяты по слышимому, а не по круглым числам.
 *
 *  До 100 мс задержку в разговоре человек не замечает. После 250 мс
 *  начинают перебивать друг друга: пауза стала длиннее той, за которую
 *  собеседник успевает решить, что вы договорили. */
const GOOD = 100;
const FAIR = 250;

interface Level {
  Icon: typeof SignalHigh;
  color: string;
  label: string;
}

function levelFor(ping: number | null): Level {
  if (ping === null) {
    // Не SignalZero: у него нарисована одна точка у основания, и
    // рядом с кнопками она читается как случайно поставленная точка,
    // а не как значок. Бледные полоски понятны сразу.
    return { Icon: Signal, color: "text-faint", label: "Связь не измерена" };
  }

  // Просто число. «До собеседника» и «до сервера» стояло здесь честно,
  // но читается это как задачка: человек смотрит на пинг затем, чтобы
  // за полсекунды понять, хорошо ли слышно. Куда именно мерили,
  // осталось в подсказке — для тех, кому это правда нужно.
  const label = `${Math.round(ping)} мс`;

  if (ping <= GOOD) return { Icon: SignalHigh, color: "text-online", label };
  if (ping <= FAIR) return { Icon: SignalMedium, color: "text-idle", label };
  return { Icon: SignalLow, color: "text-danger", label };
}

export function PingIndicator({ className }: { className?: string }) {
  const ping = useStore((s) => s.voicePing);
  const toServer = useStore((s) => s.voicePingToServer);
  const viaRelay = useStore((s) => s.voiceViaRelay);
  const { Icon, color, label } = levelFor(ping);

  // Каким путём идёт звук — не мелочь: через ретранслятор он делает
  // крюк, и лишние миллисекунды в подписи выше объясняются именно им.
  // Заодно это единственный способ убедиться, что настройка «через
  // сервер» действительно сработала, а не просто стоит галочкой.
  const дорога =
    ping === null || toServer
      ? null
      : viaRelay
        ? "Через наш сервер — собеседники не видят ваш адрес"
        : "Напрямую с собеседником, минуя сервер";

  const подробнее =
    ping === null
      ? "Пока не с кем соединяться"
      : toServer
        ? "В канале больше никого — показано время до сервера, а не задержка разговора"
        : "Задержка до самого далёкого собеседника";

  return (
    // Значки отличаются не только цветом, но и числом полосок:
    // полагаться на один цвет нельзя, каждый двадцатый мужчина
    // не различает красный и зелёный.
    //
    // Подсказка своя, а не системная: у системной задержка около
    // секунды, и до неё не доживает тот, кто просто хотел глянуть
    // цифру. Появляется сразу.
    <span className="group relative inline-flex shrink-0" role="img" aria-label={label}>
      <Icon aria-hidden className={`${color} ${className ?? ""}`} />
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-56 -translate-x-1/2 rounded-md border border-line bg-sidebar px-2 py-1.5 text-left shadow-xl group-hover:block"
      >
        <span className="block text-xs font-semibold text-bright">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-muted">{подробнее}</span>
        {дорога && (
          <span className="mt-1 block border-t border-line pt-1 text-[11px] leading-snug text-faint">
            {дорога}
          </span>
        )}
      </span>
    </span>
  );
}
