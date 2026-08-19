import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { animate, motion, useMotionValue, useMotionValueEvent } from "motion/react";
import { Menu, Users } from "lucide-react";
import { useStore } from "@/lib/store";
import { cn } from "@/lib/utils";
import { ChannelSidebar } from "@/features/channels/ChannelSidebar";
import { ServerRail } from "@/features/servers/ServerRail";
import { MemberPanel } from "@/features/members/MemberList";

/** Ширина выезжающей панели: полоса серверов плюс список каналов.
 *  Здесь нужна числом: панель не просто показывается и прячется,
 *  а ездит, и на сколько именно — надо знать в JavaScript.
 *
 *  240, а не --spacing-side: столбец каналов шире только от md —
 *  ровно с той ширины, где рядом с ним помещается лента. Сюда,
 *  под md, приезжает узкий вариант.
 *
 *  На экране в 375 точек это оставляет от переписки полоску в 63 —
 *  достаточно, чтобы было видно, куда возвращаться, и было куда
 *  нажать. */
const LEFT = 72 + 240;

/** Ширина правой шторки — участники сервера.
 *
 *  Уже левой: там список серверов и список каналов, а здесь один
 *  столбец имён. Всё, что шире нужного, отнимается у переписки,
 *  которая остаётся видна с краю. */
const RIGHT = 240;

/** Насколько далеко «бросок» пальцем засчитывается как намерение
 *  доехать до края. Без учёта скорости короткий резкий свайп
 *  откатывался бы назад: пальцем редко проводят через пол-экрана. */
const THROW = 0.18;

/** Как панель доезжает до края. Пружина, а не линейное движение:
 *  так у неё есть вес, и понятно, что её толкнули, а не перерисовали. */
const SETTLE = { type: "spring", stiffness: 520, damping: 46 } as const;

type Pane = "left" | "chat" | "right";

interface MobileNav {
  pane: Pane;
  go: (pane: Pane) => void;
}

const Nav = createContext<MobileNav | null>(null);

/** null — значит обычный экран, шторок нет и кнопок к ним тоже.
 *  Компоненты общие для телефона и ноутбука, поэтому проверять
 *  приходится им, а не раскладке. */
export function useMobileNav(): MobileNav | null {
  return useContext(Nav);
}

/** Кнопка «показать каналы». На обычном экране не рисует ничего,
 *  поэтому её можно ставить в общие шапки без единой проверки
 *  на стороне вызова. */
export function PaneToggle({ className }: { className?: string }) {
  const nav = useMobileNav();
  if (!nav) return null;

  return (
    <button
      onClick={() => nav.go("left")}
      aria-label="Каналы и серверы"
      // Кнопка стоит первой в шапке, у левого края: панель выезжает
      // слева, и открывать её кнопкой справа — маленькая ложь, которую
      // замечаешь каждый раз.
      className={cn(
        "-ml-1 shrink-0 rounded p-2 text-muted hover:bg-hover hover:text-bright",
        className,
      )}
    >
      <Menu className="size-6" />
    </button>
  );
}

/** Кнопка «показать участников». Только на телефоне и только там, где
 *  участники есть: в личной переписке их двое, и оба на виду. */
export function PeopleToggle({ className }: { className?: string }) {
  const nav = useMobileNav();
  const serverId = useStore((s) => s.serverId);
  if (!nav || !serverId) return null;

  return (
    <button
      onClick={() => nav.go("right")}
      aria-label="Участники"
      // У правого края — с той стороны, откуда выезжает список.
      className={cn(
        "-mr-1 ml-auto shrink-0 rounded p-2 text-muted hover:bg-hover hover:text-bright",
        className,
      )}
    >
      <Users className="size-6" />
    </button>
  );
}

/** Шапка для экранов, у которых своей нет: приветствие новичка,
 *  ошибка загрузки, пустой выбор. Без неё на телефоне с них было
 *  не выбраться ничем, кроме жеста, о котором никто не знает. */
export function MobileTopBar({ title }: { title: string }) {
  const nav = useMobileNav();
  if (!nav) return null;

  return (
    <header className="flex h-head shrink-0 items-center gap-2 px-2 pt-safe shadow-[0_1px_0_rgba(0,0,0,0.2)]">
      <PaneToggle />
      <h1 className="truncate font-semibold text-bright">{title}</h1>
    </header>
  );
}

/** Куда сдвинуть содержимое, чтобы показать нужную панель.
 *
 *  Каналы слева — там же, где на большом экране и где их ищут во всех
 *  остальных приложениях. Участники справа — тоже как на большом
 *  экране. Каждая показывается из-под отъехавшей переписки. */
function offsetOf(pane: Pane): number {
  if (pane === "left") return LEFT;
  if (pane === "right") return -RIGHT;
  return 0;
}

/**
 * Телефонная раскладка: две полосы, из которых видна одна.
 *
 * На обычном экране список каналов, переписка и участники стоят рядом
 * и занимают около тысячи точек. На телефоне их триста семьдесят,
 * и та же раскладка оставила бы переписке колонку в одно слово.
 * Поэтому всё, кроме переписки, уезжает за левый край одной панелью —
 * участники показываются внутри неё, под каналами.
 *
 * Панель слева, а не справа. Справа она недолго побыла: до левого края
 * большим пальцем не дотянуться, и казалось, что так удобнее. Но слева
 * она стоит на большом экране, слева её ищут во всех остальных
 * приложениях, и «три полоски» справа читались как чужая кнопка.
 *
 * Ездит именно содержимое, а не панель поверх него. Так остаётся
 * видна полоска переписки, по которой понятно, куда возвращаться,
 * и по которой возвращаются нажатием.
 */
export function MobileShell({ children }: { children: ReactNode }) {
  const [pane, setPane] = useState<Pane>("chat");
  const x = useMotionValue(0);

  /** Правая шторка есть только на сервере: в личных переписках и на
   *  главной участников нет вовсе. Без этой проверки туда можно было
   *  уехать пальцем и упереться в пустое место справа — на что
   *  и пожаловались. */
  const onServer = useStore((s) => Boolean(s.serverId));

  // Видна ли сейчас панель под содержимым.
  //
  // Решает не состояние, а знак сдвига: содержимое отъехало вправо —
  // значит из-под него показалась панель. Так это верно и посреди
  // движения пальцем, когда решение ещё не принято, и панель не висит
  // невидимой стенкой поверх переписки, перехватывая нажатия.
  const [side, setSide] = useState<"left" | "right" | null>(null);
  useMotionValueEvent(x, "change", (value) => {
    const next = value > 0.5 ? "left" : value < -0.5 ? "right" : null;
    // Возврат того же значения React пропускает без перерисовки,
    // поэтому шестьдесят срабатываний в секунду стоят почти ничего.
    setSide((current) => (current === next ? current : next));
  });

  // Куда панель едет прямо сейчас. Дублирует состояние намеренно:
  // состояние обновляется к следующей отрисовке, а проверить цель
  // надо в том же обработчике, который её только что задал.
  const target = useRef<Pane>("chat");

  const go = useCallback(
    (next: Pane) => {
      const where = next === "right" && !onServer ? "chat" : next;
      target.current = where;
      setPane(where);
      animate(x, offsetOf(where), SETTLE);
    },
    [x, onServer],
  );

  // Ушли с сервера, пока была открыта правая шторка, — возвращаемся
  // к переписке: показывать пустую панель участников несуществующего
  // сервера нельзя.
  useEffect(() => {
    if (!onServer && target.current === "right") go("chat");
  }, [onServer, go]);

  /**
   * Довести панель до края, если движение прервали.
   *
   * Касание экрана останавливает начатую анимацию — так устроен drag:
   * палец забирает управление у пружины. Но если человек не потянул,
   * а просто нажал (выбрал канал в едущей панели), то перетаскивание
   * не начнётся, onDragEnd не сработает, и панель останется стоять
   * там, где её застали, — посреди экрана.
   *
   * Поэтому на каждом отпускании проверяем: доехали или нет.
   * Следующим кадром — чтобы настоящее перетаскивание успело решить,
   * куда именно ехать.
   */
  function ensureSettled() {
    requestAnimationFrame(() => {
      const to = offsetOf(target.current);
      if (Math.abs(x.get() - to) > 0.5) animate(x, to, SETTLE);
    });
  }

  // ── Возврат к переписке, когда выбор сделан ────────────────
  const channelId = useStore((s) => s.channelId);
  const serverId = useStore((s) => s.serverId);
  const friendsOpen = useStore((s) => s.friendsOpen);
  const previous = useRef({ channelId, serverId });

  useEffect(() => {
    const before = previous.current;
    previous.current = { channelId, serverId };

    // Смена сервера сама подставляет его первый канал — это не выбор
    // человека, а следствие. Закрывать шторку тут нельзя: он только
    // что открыл её именно затем, чтобы выбрать канал, и она захлопнулась
    // бы у него под пальцем.
    if (serverId !== before.serverId) return;
    if (channelId && channelId !== before.channelId) go("chat");
  }, [channelId, serverId, go]);

  // «Друзья» — такой же выбор, как канал, но канала за ним нет.
  useEffect(() => {
    if (friendsOpen) go("chat");
  }, [friendsOpen, go]);

  // Свернули приложение посреди движения — браузер перестаёт выдавать
  // кадры, и пружина замирает там, где её застали. Вернулись — доводим.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") ensureSettled();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  });

  /** Куда доехать, если палец отпустили здесь и с такой скоростью. */
  const settleTo = useCallback(
    (projected: number) => {
      const stops: Pane[] = onServer ? ["left", "chat", "right"] : ["left", "chat"];
      const nearest = stops.reduce((best, stop) =>
        Math.abs(offsetOf(stop) - projected) < Math.abs(offsetOf(best) - projected) ? stop : best,
      );
      go(nearest);
    },
    [go, onServer],
  );

  /**
   * Жест — на обычных касаниях, своими руками.
   *
   * Здесь стоял drag из motion, и на iPhone он работал, а на Android
   * нет — сколько ни правь touch-action. Разбор показал, что сама
   * шторка исправна: если события до неё доходят, она уезжает ровно
   * куда надо. Не доходил жест — его забирал браузер, и до обработчика
   * не долетало ни одного движения.
   *
   * Обычные touch-события такого не знают: они приходят всегда, а как
   * только мы решили, что жест наш, preventDefault забирает его
   * у браузера целиком. Плата — три десятка строк вместо одного
   * свойства; зато работает одинаково везде.
   */
  const surface = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = surface.current;
    if (!node) return;

    let startX = 0;
    let startY = 0;
    let base = 0;
    let axis: "x" | "y" | null = null;
    let lastX = 0;
    let lastAt = 0;
    let speed = 0;

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      startX = touch.clientX;
      startY = touch.clientY;
      lastX = touch.clientX;
      lastAt = event.timeStamp;
      speed = 0;
      base = x.get();
      axis = null;
    };

    const onMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0]!;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;

      // Пока не решили, куда ведут палец, — не мешаем никому.
      // Восемь точек: меньше — и обычное касание кнопки начинает
      // считаться жестом.
      if (!axis) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
      }
      if (axis !== "x") return;

      // Жест наш — забираем его у браузера вместе с прокруткой
      // и системными «назад-вперёд».
      if (event.cancelable) event.preventDefault();

      const now = event.timeStamp;
      if (now > lastAt) speed = (touch.clientX - lastX) / (now - lastAt);
      lastX = touch.clientX;
      lastAt = now;

      const limit = { min: onServer ? -RIGHT : 0, max: LEFT };
      x.set(Math.min(limit.max, Math.max(limit.min, base + dx)));
    };

    const onEnd = () => {
      if (axis !== "x") return;
      axis = null;
      // Скорость в точках за миллисекунду, а THROW считает в секундах.
      settleTo(x.get() + speed * 1000 * THROW);
    };

    node.addEventListener("touchstart", onStart, { passive: true });
    // passive: false обязателен — иначе preventDefault не сработает,
    // и браузер всё равно уведёт жест себе.
    node.addEventListener("touchmove", onMove, { passive: false });
    node.addEventListener("touchend", onEnd);
    node.addEventListener("touchcancel", onEnd);

    return () => {
      node.removeEventListener("touchstart", onStart);
      node.removeEventListener("touchmove", onMove);
      node.removeEventListener("touchend", onEnd);
      node.removeEventListener("touchcancel", onEnd);
    };
  }, [x, onServer, settleTo]);

  return (
    <Nav.Provider value={{ pane, go }}>
      <div
        // На всей области, а не только на самой едущей части: канал
        // выбирают в панели, которая от неё отдельно, и отпускание
        // пальца там тоже должно доводить движение до конца.
        onPointerUp={ensureSettled}
        onPointerCancel={ensureSettled}
        className="relative flex min-h-0 flex-1 overflow-hidden"
      >
        {/* Обе панели стоят на месте, содержимое ездит поверх них.
            Порядок в разметке важен: панели ниже по слою, иначе
            они перехватывали бы нажатия у переписки. */}
        {/* visibility, а не размонтирование: список каналов и список
            участников пролистывают, и возвращаться к ним каждый раз
            в начало — заметнее, чем стоимость двух скрытых поддеревьев. */}
        <div
          aria-hidden={side !== "left"}
          className="absolute inset-y-0 left-0 flex"
          style={{ width: LEFT, visibility: side === "left" ? "visible" : "hidden" }}
        >
          <ServerRail />
          <ChannelSidebar />
        </div>

        {/* Участники — своей шторкой справа, как столбец справа
            на большом экране. Под каналами в левой они делили с ними
            прокрутку и стояли не с той стороны. */}
        <div
          aria-hidden={side !== "right"}
          className="absolute inset-y-0 right-0 flex"
          style={{ width: RIGHT, visibility: side === "right" ? "visible" : "hidden" }}
        >
          <MemberPanel className="w-full overflow-y-auto bg-sidebar px-2 py-3 pt-safe" />
        </div>

        <motion.div
          ref={surface}
          // touch-action: pan-y оставляем — он говорит браузеру, что
          // вертикальная прокрутка его, а горизонтальное движение
          // наше. Сам жест ловим обычными touch-событиями выше:
          // на Android до drag из motion они не доходили вовсе.
          style={{ x, touchAction: "pan-y" }}
          className="absolute inset-0 z-10 flex flex-col bg-chat shadow-[0_0_24px_rgba(0,0,0,0.5)]"
        >
          {/* min-h-0 обязателен. Без него колонка внутри растягивается
              по содержимому — лента разворачивается во всю высоту всех
              сообщений, а поле ввода уезжает на четыре тысячи точек
              вниз, за край экрана. На ноутбуке этого не видно: там
              переписка стоит в строке, и высоту ей задаёт строка. */}
          <div className="flex min-h-0 flex-1 flex-col">{children}</div>

          {/* Пока панель открыта, переписка целиком становится кнопкой
              «закрыть». Так же ведёт себя затемнение в обычных шторках,
              только здесь затемнять нечего — панель и так съехала. */}
          {pane !== "chat" && (
            <button
              aria-label="Вернуться к переписке"
              onClick={() => go("chat")}
              className="absolute inset-0 z-20 bg-black/30"
            />
          )}
        </motion.div>
      </div>
    </Nav.Provider>
  );
}
