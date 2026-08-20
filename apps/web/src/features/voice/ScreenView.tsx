import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { Maximize2, Minimize2, Play } from "lucide-react";
import { desktop } from "@/lib/desktop";
import { usePeople, useStore } from "@/lib/store";
import { canShareScreen } from "@/lib/voice";

/**
 * Чужой экран.
 *
 * Изображение не проходит через сервер: оно идёт по тому же прямому
 * соединению, что и звук. Здесь только место, куда его положить.
 */

export function Screen({ userId, stream }: { userId: string; stream: MediaStream }) {
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const me = useStore((s) => s.me);
  const user = usePeople()(userId);
  const own = userId === me?.id;

  /** Смотрим ли мы этот показ.
   *
   *  Своё — всегда: это не просмотр, а зеркало, по нему проверяют,
   *  что именно ушло друзьям. Чужое — только по согласию. */
  const watching = useStore((s) => s.watchingScreen) === userId || own;
  const setWatching = useStore((s) => s.setWatchingScreen);

  /** Поток есть, воспроизведение идёт, а новых кадров нет. */
  const [stuck, setStuck] = useState(false);
  /** Что именно происходит с видеодорожкой, когда картинки нет.
   *
   *  Без этих цифр «чёрный прямоугольник» неотличим от десятка разных
   *  причин, и разбирательство сводится к переписке «а теперь попробуй
   *  так». Здесь ровно то, что разводит их по разным сторонам:
   *  есть ли дорожка вообще, жива ли она и идут ли по ней данные. */
  const [detail, setDetail] = useState("");

  useEffect(() => {
    const element = video.current;
    if (!element) return;

    // Не смотрим — не показываем и не запускаем: чужой рабочий стол
    // не должен разворачиваться сам по себе.
    if (!watching) {
      element.srcObject = null;
      setStuck(false);
      return;
    }

    // srcObject нельзя задать атрибутом — только свойством.
    element.srcObject = stream;
    // Всегда без звука — и своё, и чужое. Звук чужих показов ведёт
    // голосовой слой (voice.ts, pipeScreen) — он не зависит от того,
    // какой канал открыт. Заодно исчезает целый класс бед:
    // запуск беззвучного видео браузер не запрещает никогда, а со
    // звуком — вправе отказать, и отказ приходилось ловить и объяснять.
    element.muted = true;

    let ушли = false;

    async function пустить() {
      if (!element || ушли) return;
      await element.play().catch(() => undefined);
    }

    void пустить();

    /**
     * Дорожка добавилась к уже привязанному потоку.
     *
     * Это обычное дело: видео и звук одного показа приезжают порознь
     * и в непредсказуемом порядке. Если первой пришла звуковая, элемент
     * оказывается привязан к потоку без картинки — и появившуюся позже
     * видеодорожку Chrome в нём подхватывает не всегда. Снаружи это
     * ровно то, на что жалуются: звук показа слышно, а прямоугольник
     * чёрный.
     *
     * Поэтому именно перепривязка, а не просто повторный play():
     * присвоение srcObject заставляет элемент заново прочитать состав
     * дорожек. Один и тот же объект присваивать не жалко — картинка
     * при этом не моргает, потому что поток тот же самый.
     */
    function перепривязать() {
      if (!element || ушли) return;
      element.srcObject = stream;
      void пустить();
    }

    stream.addEventListener("addtrack", перепривязать);

    /**
     * Сторож кадров.
     *
     * Чёрный прямоугольник — худшее, что может показать мессенджер:
     * непонятно, то ли показывают чёрное, то ли всё сломалось, то ли
     * ещё грузится. Считаем показанные кадры: не растут пять секунд —
     * так и говорим. Диагноз важнее вида: молчаливая чернота стоила
     * нам двух вечеров переписки о том, что именно не работает.
     *
     * Интервалом, а не requestAnimationFrame: в свёрнутом окне кадров
     * анимации браузер не выдаёт вовсе, и сторож бы сам «завис».
     */
    let прежние = -1;
    let простой = 0;
    const сторож = setInterval(() => {
      if (!element) return;

      // В свёрнутом окне браузер перестаёт декодировать кадры сам,
      // и счётчик замирает при совершенно исправном показе. Считать
      // это поломкой — значит встречать человека ложной тревогой
      // каждый раз, когда он возвращается к окну.
      if (document.visibilityState !== "visible") {
        простой = 0;
        прежние = element.getVideoPlaybackQuality?.().totalVideoFrames ?? прежние;
        return;
      }

      const кадры = element.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
      простой = кадры > прежние ? 0 : простой + 1;
      прежние = кадры;
      // Пять секунд подряд без единого нового кадра — это уже не задержка.
      const встало = простой >= 5 && !element.paused;
      setStuck(встало);

      if (!встало) return;
      // muted у чужой дорожки означает не «выключен звук», а «данные
      // по ней сейчас не идут» — это и есть главный разделитель:
      // дорожка есть, но пустая, или её нет вовсе.
      const дорожка = stream.getVideoTracks()[0];
      setDetail(
        дорожка
          ? `дорожка есть · данные идут: ${дорожка.muted ? "нет" : "да"} · ` +
              `состояние: ${дорожка.readyState} · кадров: ${кадры}`
          : "видеодорожки нет вовсе — пришёл только звук",
      );
    }, 1000);

    return () => {
      ушли = true;
      clearInterval(сторож);
      stream.removeEventListener("addtrack", перепривязать);
      element.srcObject = null;
    };
  }, [stream, own, watching]);


  /**
   * Развернуть и свернуть обратно.
   *
   * На телефоне это не украшение, а единственный способ хоть что-то
   * разглядеть: в столбик шириной в триста точек кадр рабочего стола
   * ложится полосой в полторы сотни высотой.
   *
   * Три вещи, которые здесь были сломаны и теперь сделаны иначе.
   *
   * Кнопка только разворачивала. Нажатие на неё во весь экран ничего
   * не делало, и выйти можно было одним лишь Esc — на телефоне,
   * где Esc нет, выйти нельзя было вовсе. Теперь она переключает.
   *
   * Полный экран не был полным: у видео стоял предел в 70% высоты,
   * и во весь экран оставались чёрные поля сверху и снизу.
   *
   * На iPhone вызывался webkitEnterFullscreen — свой проигрыватель
   * iOS. Живую дорожку он не показывает: открывался чёрный экран
   * с кнопками плеера. Теперь там своя раскладка поверх страницы —
   * та же, что и везде, только без системного полноэкранного режима.
   */
  const [big, setBig] = useState(false);

  const expand = useCallback(() => {
    setBig((was) => {
      const next = !was;
      const shell = desktop();

      // В приложении разворачиваем само окно. Полноэкранный режим
      // средствами страницы там и мигал чёрным, и оставлял поля:
      // Chromium переключает при этом свой слой отрисовки поверх
      // окна, у которого и так нет рамки. Окно во весь экран делает
      // ровно то, чего ждут, и без единого чёрного кадра.
      if (shell?.window.setFullscreen) {
        shell.window.setFullscreen(next);
        return next;
      }

      // В браузере — обычный полноэкранный режим. Где его нет
      // (Safari на iPhone), остаётся наша раскладка поверх страницы:
      // она и так закрывает всё, кроме строки состояния телефона.
      if (next) void box.current?.requestFullscreen?.().catch(() => undefined);
      else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      return next;
    });
  }, []);

  // Из полноэкранного режима браузера можно выйти мимо нашей кнопки —
  // Esc или системным жестом. Тогда разметку надо вернуть на место.
  // В приложении это событие не приходит вовсе: там разворачивается
  // окно, а не элемент.
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement && !desktop()?.window.setFullscreen) setBig(false);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // И клавишей — для нашей раскладки, где системного выхода нет.
  useEffect(() => {
    if (!big) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setBig(false);
      desktop()?.window.setFullscreen?.(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [big]);

  return (
    <motion.div
      ref={box}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.15 }}
      className={
        big
          ? "group/screen fixed inset-0 z-[70] flex items-center justify-center bg-black"
          : "group/screen relative overflow-hidden rounded-lg bg-black"
      }
    >
      <video
        ref={video}
        // playsInline — иначе на телефоне видео уходит на весь экран
        // само, стоит ему начаться.
        playsInline
        // muted намеренно не здесь, а в эффекте. Свойством из разметки
        // React возвращал бы его на каждой перерисовке — и снимал бы
        // заглушку, которую эффект поставил, чтобы картинка вообще
        // пошла. Видео при этом останавливается, и мы возвращаемся
        // к чёрному прямоугольнику, только теперь ещё и мигающему.
        onClick={expand}
        // Во весь экран — значит во весь: предел в 70% высоты оставлял
        // чёрные поля сверху и снизу, и «полный экран» полным не был.
        className={
          !watching
            ? "hidden"
            : big
              ? "h-full w-full object-contain"
              : "max-h-[70vh] w-full object-contain"
        }
      />

      {watching && (
        <div className="absolute bottom-0 left-0 bg-black/60 px-2 py-1 text-xs text-bright">
          {/* Своё называем тем, что это на самом деле: с телефона идёт
              камера. Чужое — просто «показывает»: что именно там
              за источник, отсюда не видно и знать незачем. */}
          {own
            ? canShareScreen()
              ? "Ваш экран"
              : "Ваша камера"
            : `Показывает · ${user?.displayName ?? "участник"}`}
        </div>
      )}

      {/* Пока не согласились смотреть — вместо картинки предложение.
          Показ друга больше не разворачивается сам: человек сидит
          в разговоре и занят своим, а ему без спроса открывали чужой
          рабочий стол во весь канал. */}
      {!watching && (
        <div className="flex min-h-[180px] flex-col items-center justify-center gap-3 bg-raised p-6 text-center">
          <p className="text-sm text-body">
            <span className="font-medium text-bright">{user?.displayName ?? "Участник"}</span>{" "}
            показывает экран
          </p>
          <button
            onClick={() => setWatching(userId)}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            <Play className="size-4" />
            Смотреть
          </button>
          <p className="max-w-[280px] text-xs text-faint">
            Пока не нажмёте, картинка не грузится — ни трафика, ни лишнего окна.
          </p>
        </div>
      )}

      {/* Кадры не идут. Говорим прямо, вместо того чтобы показывать
          чёрное и молчать: человеку надо понимать, ждать ему или
          звонить показывающему. */}
      {watching && stuck && !own && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-black/80 p-4 text-center">
          <p className="text-sm font-medium text-bright">Картинка не идёт</p>
          <p className="max-w-[280px] text-xs text-muted">
            Соединение есть, но новых кадров нет. Обычно помогает, если показывающий прекратит
            показ и начнёт заново.
          </p>
          {detail && <p className="mt-1 font-mono text-[11px] text-faint">{detail}</p>}
        </div>
      )}

      {/* Отдельная кнопка, а не только нажатие по кадру: по кадру
          догадаться нельзя, а на телефоне это главное действие.
          Во весь экран она же и выход — и видна всегда, без наведения:
          наводить мышь в полноэкранном режиме некуда, а на телефоне
          мыши нет вовсе. */}
      {watching && (
      <button
        onClick={expand}
        title={big ? "Свернуть" : "Развернуть"}
        aria-label={big ? "Свернуть" : "Развернуть на весь экран"}
        className={
          big
            ? "absolute top-4 right-4 z-10 rounded-md bg-black/60 p-3 text-bright hover:bg-black/80"
            : "absolute top-2 right-2 rounded-md bg-black/50 p-2 text-bright opacity-0 transition-opacity hover:bg-black/70 focus-visible:opacity-100 group-hover/screen:opacity-100 pointer-coarse:opacity-100"
        }
      >
        {big ? <Minimize2 className="size-5" /> : <Maximize2 className="size-4" />}
      </button>
      )}
    </motion.div>
  );
}

/* Здесь была ScreenView — список всех показов сразу. Её рисовали над
   лентой текстового канала, и она оттуда убрана: кадр закрывал собой
   переписку, а смотрят на него в голосовом канале. Показы там
   раскладывает VoiceStage, каждый через Screen выше, и второй способ
   разложить то же самое стал лишним.

   Здесь же была ScreenAudio — звук чужих показов отдельным элементом.
   Он переехал в голосовой слой (voice.ts, pipeScreen) и идёт теперь
   тем же путём, что и голоса: через общий усилитель. Отдельным
   элементом он звучал мимо общей громкости, мимо кнопки «отключить
   звук», мимо выбранных наушников — и, главное, мимо гасителя эха.
   Из-за последнего чужая игра выходила в динамики, попадала в наш
   захват экрана и уезжала обратно тому, кто её показывает. */
