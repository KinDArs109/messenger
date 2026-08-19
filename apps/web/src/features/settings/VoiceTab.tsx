import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { MAX_GAIN, usePreferences } from "@/lib/preferences";
import { isApp } from "@/lib/desktop";
import { playSound } from "@/lib/sounds";
import { Toggle } from "@/components/ui/Toggle";
import { ScreenQuality } from "@/features/voice/ScreenQuality";
import { Section } from "./Section";
import {
  applyAutoGain,
  applyMicChange,
  applySpeakerChange,
  setMicGain,
  setOutputGain,
} from "@/features/voice/useVoice";

/**
 * Голос: микрофон, звук, показ экрана.
 *
 * Разложено по тому, чего человек хочет, а не по тому, как устроено
 * внутри. Раньше настройки шли вперемешку — устройство микрофона,
 * его проверка, динамики, две громкости, обработка, окошко поверх игры,
 * качество показа, сигналы, и рация в самом конце. Всё, что про
 * микрофон, оказывалось в четырёх местах, между которыми стояло чужое.
 *
 * Хуже того, разделов с названием «Микрофон» было два: сверху выбор
 * устройства, внизу — способ его включать. Одинаковая надпись над
 * разными вещами читается как повтор, и второй раз в него уже
 * не всматриваются.
 *
 * Теперь: сначала всё про свой микрофон (что, как звучит, как
 * включается), потом всё про чужой звук, потом показ экрана.
 */

const SELECT =
  "w-full rounded-md border border-line bg-input px-3 py-2 text-sm text-bright outline-none focus:border-accent";
const LABEL = "mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase";

export function VoiceTab() {
  const { prefs, setPref } = usePreferences();
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Без разрешения браузер отдаёт список устройств без названий —
        // выбирать было бы не из чего. Спрашиваем и сразу отпускаем:
        // держать микрофон открытым ради списка незачем.
        const probe = await navigator.mediaDevices.getUserMedia({ audio: true });
        for (const track of probe.getTracks()) track.stop();
      } catch {
        if (!cancelled) setDenied(true);
      }

      const devices = await navigator.mediaDevices.enumerateDevices();
      if (cancelled) return;
      setMics(devices.filter((d) => d.kind === "audioinput"));
      setSpeakers(devices.filter((d) => d.kind === "audiooutput"));
    }

    void load();
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", load);
    };
  }, []);

  return (
    <div className="space-y-6">
      {denied && (
        <p className="rounded-md bg-raised px-3 py-2 text-sm text-muted">
          Доступ к микрофону не выдан — список устройств будет без названий. Разрешите доступ
          в настройках браузера, если хотите выбирать вручную.
        </p>
      )}

      {/* ── Свой микрофон ───────────────────────────────────────
          Устройство, как оно звучит и насколько громко — подряд:
          выбрав микрофон, тут же на него и смотрят. */}
      <Section title="Микрофон">
        <div>
          <label className={LABEL} htmlFor="mic">
            Устройство
          </label>
          <select
            id="mic"
            className={SELECT}
            value={prefs.micId}
            onChange={(event) => {
              setPref("micId", event.target.value);
              applyMicChange();
            }}
          >
            <option value="">Как в Windows</option>
            {mics.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || "Микрофон"}
              </option>
            ))}
          </select>
        </div>

        <MicLevel deviceId={prefs.micId} />

        <Gain
          label="Громкость"
          aria="Громкость микрофона"
          value={prefs.micGain}
          onChange={setMicGain}
          hint="Насколько громко вас слышат остальные."
        />
      </Section>

      {/* Обработка микрофона. Обе включены по умолчанию и обе меняются
          прямо посреди разговора: браузер собирает цепочку обработки
          в момент запроса устройства, поэтому микрофон перезапрашивается
          заново — собеседники этого не замечают, дорожка к ним идёт
          с выхода усилителя и не меняется. */}
      <Section title="Обработка микрофона">
        <div className="space-y-1">
          <Toggle
            label="Подтягивать тихий голос"
            note="Тихое поднимается сильно, громкое почти не трогается. Нужно потому, что автоусиление браузера мы выключаем ради шумодава: оно тянет вверх и шум в паузах."
            checked={prefs.autoGain}
            onChange={(value) => {
              setPref("autoGain", value);
              applyAutoGain();
            }}
          />

          <Toggle
            label="Эхоподавление"
            note="Убирает из микрофона то, что играет в динамиках. Без него собеседник слышит сам себя, стоит сесть без наушников."
            checked={prefs.echoCancel}
            onChange={(value) => {
              setPref("echoCancel", value);
              applyMicChange();
            }}
          />
          <div>
            <label className={LABEL} htmlFor="denoise">
              Шумоподавление
            </label>
            <select
              id="denoise"
              className={SELECT}
              value={prefs.denoise === "off" ? (prefs.noiseSuppress ? "browser" : "none") : prefs.denoise}
              onChange={(event) => {
                const value = event.target.value;
                // Три настройки одним выбором: своё работает вместо
                // браузерного, а не вместе с ним, и держать две галочки,
                // из которых вторая отменяет первую, — верный способ
                // получить обе включёнными.
                setPref("denoise", value === "soft" || value === "strong" ? value : "off");
                setPref("noiseSuppress", value === "browser");
                applyMicChange();
              }}
            >
              <option value="strong">Сильное — своё</option>
              <option value="soft">Мягкое — своё</option>
              <option value="browser">Как в браузере</option>
              <option value="none">Выключено</option>
            </select>
            <p className="mt-1 px-1 text-xs text-faint">
              {prefs.denoise === "strong" &&
                "Считает шум по каждой полосе частот отдельно. Вентилятор, гул и шипение уходят почти полностью; очень тихий шёпот может приглушаться вместе с ними."}
              {prefs.denoise === "soft" &&
                "То же самое, но осторожнее: голос точно не тронет, часть ровного гула останется."}
              {prefs.denoise === "off" &&
                prefs.noiseSuppress &&
                "Встроенное в браузер. Давит ровный гул и заодно выравнивает громкость, но в паузах вытягивает шум обратно."}
              {prefs.denoise === "off" &&
                !prefs.noiseSuppress &&
                "Микрофон идёт как есть. Так чище звучит гитара и пение, но всё лишнее слышно тоже."}
            </p>
          </div>
          {!prefs.echoCancel && (
            <p className="px-2 text-xs text-idle">
              Эхоподавление выключено — сидя без наушников, вы вернёте собеседнику его же голос.
            </p>
          )}
        </div>
      </Section>

      {/* Рация стоит здесь, а не в конце: «как микрофон включается» —
          такой же вопрос про свой микрофон, как «какой он» и «насколько
          громкий». Раньше этот раздел тоже назывался «Микрофон»,
          из-за чего сверху и снизу вкладки стояло одно слово. */}
      <Section title="Как включается микрофон">
        <PushToTalkSettings />
      </Section>

      {/* ── Чужой звук ──────────────────────────────────────────── */}
      <Section title="Звук">
        <div>
          <label className={LABEL} htmlFor="speaker">
            Устройство
          </label>
          {speakers.length === 0 ? (
            <p className="text-sm text-muted">
              Этот браузер не даёт выбирать устройство вывода — звук идёт туда, где он настроен
              в Windows.
            </p>
          ) : (
            <select
              id="speaker"
              className={SELECT}
              value={prefs.speakerId}
              onChange={(event) => {
                setPref("speakerId", event.target.value);
                // Наушники переключаются на ходу, разговор не прерывается.
                applySpeakerChange();
              }}
            >
              <option value="">Как в Windows</option>
              {speakers.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label || "Динамики"}
                </option>
              ))}
            </select>
          )}
        </div>

        <Gain
          label="Громкость"
          aria="Общая громкость звука"
          value={prefs.outputGain}
          onChange={setOutputGain}
          hint="Общая. Каждого отдельно — правой кнопкой по человеку в разговоре."
        />

        <div>
          <div className="flex items-center justify-between">
            <span className={LABEL}>Сигналы разговора</span>
            <span className="text-xs text-muted">
              {prefs.soundVolume <= 0 ? "выключены" : `${Math.round(prefs.soundVolume * 100)}%`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={prefs.soundVolume}
            onChange={(event) => {
              const value = Number(event.target.value);
              setPref("soundVolume", value);
              // Играем сразу же: подбирать громкость на слух иначе
              // невозможно — придётся выходить и звать кого-то в канал.
              if (value > 0) playSound("join");
            }}
            className="w-full accent-accent"
            aria-label="Громкость сигналов разговора"
          />
          <p className="mt-1 text-xs text-muted">
            Кто-то зашёл в голосовой канал, вышел, включил показ экрана. Слева — выключить совсем.
          </p>
        </div>
      </Section>

      {/* ── Экран ───────────────────────────────────────────────
          В приложении качество выбирается прямо в окне «Что показать» —
          там, где нажимают кнопку. В браузере такого окна нет: его
          рисует сам браузер, и вставить туда ничего нельзя. Поэтому
          здесь этот выбор появляется только для браузера. */}
      {!isApp() && (
        <Section title="Демонстрация экрана">
          <ScreenQuality />
        </Section>
      )}

      {/* Окошко поверх игры переехало во вкладку «Приложение».
          Оно про окно, а не про звук, и в браузере его не бывает вовсе —
          а вкладка «Приложение» ровно для того и заведена. */}

      {/* Здесь был переключатель «Путь разговора». Убран: выбирать тут
          нечего. Разговор идёт через наш ретранслятор всегда, а замер
          показал, что крюк почти ничего не стоит — 24–30 мс, столько же,
          сколько напрямую. Настройка, у которой один разумный ответ, —
          это не свобода выбора, а лишняя строка в глазах.
          Каким путём звук идёт на самом деле, видно в подсказке
          у значка связи. */}

      {/* Стоит последней строкой и относится ко всей вкладке. Раньше
          она пряталась в середине, между сигналами и рацией, и читалась
          как примечание к сигналам. */}
      <p className="border-t border-line pt-4 text-xs text-muted">
        Всё применяется сразу, прямо посреди разговора — выходить и заходить заново не надо.
      </p>
    </div>
  );
}

/** Ползунок громкости 0–200%. Выше двухсот начинается не «громче»,
 *  а хрип, поэтому потолок жёсткий. */
function Gain({
  label,
  aria,
  value,
  onChange,
  hint,
}: {
  label: string;
  /** Что услышит человек, читающий экран с голоса: рядом с ползунком
   *  заголовка раздела не слышно, и одного слова «Громкость» ему мало. */
  aria: string;
  value: number;
  onChange: (value: number) => void;
  hint: string;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className={LABEL}>{label}</span>
        <span className="text-xs text-muted">{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={MAX_GAIN}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-accent"
        aria-label={aria}
      />
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}

/** Полоска уровня — чтобы проверить микрофон, не звоня никому. */
function MicLevel({ deviceId }: { deviceId: string }) {
  const [level, setLevel] = useState(0);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let running = true;

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: deviceId ? { deviceId: { ideal: deviceId } } : true,
        });
      } catch {
        return;
      }
      if (!running) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }

      context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (!running) return;
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (const value of data) sum += value;
        setLevel(Math.min(1, sum / data.length / 128));
        setTimeout(tick, 100);
      };
      tick();
    })();

    return () => {
      running = false;
      for (const track of stream?.getTracks() ?? []) track.stop();
      void context?.close();
    };
  }, [deviceId]);

  return (
    <div>
      <span className={LABEL}>Проверка</span>
      <div className="flex items-center gap-2">
        <Mic className="size-4 shrink-0 text-muted" />
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
          <div
            ref={bar}
            className="h-full rounded-full bg-online transition-[width] duration-100"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
      </div>
      <p className="mt-1.5 text-xs text-muted">Скажите что-нибудь — полоска должна двигаться.</p>
    </div>
  );
}

/** Рация. В браузере невозможна: он не видит клавиш вне своего окна. */
function PushToTalkSettings() {
  const { prefs, setPref } = usePreferences();
  const [error, setError] = useState<string | null>(null);

  if (!isApp()) {
    return (
      <p className="rounded-md bg-raised px-3 py-2.5 text-xs text-muted">
        Микрофон всегда открыт. Рация есть только в приложении: браузер не видит нажатий вне
        своего окна, поэтому клавиша не сработает, пока вы в игре.
      </p>
    );
  }

  return (
    <>
      <div className="flex gap-2">
        {(
          [
            ["off", "Всегда открыт"],
            ["hold", "Держать клавишу"],
            ["toggle", "Переключать"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setPref("pttMode", value);
              setError(null);
            }}
            className={`flex-1 rounded-md px-3 py-2 text-sm ${
              prefs.pttMode === value
                ? "bg-accent text-white"
                : "bg-raised text-muted hover:text-bright"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {prefs.pttMode !== "off" && (
        <div>
          <label className={LABEL} htmlFor="ptt-key">
            Клавиша
          </label>
          <select
            id="ptt-key"
            className={SELECT}
            value={prefs.pttKey}
            onChange={(event) => {
              setPref("pttKey", event.target.value);
              setError(null);
            }}
          >
            {["F8", "F9", "F10", "F11", "CapsLock", "ScrollLock", "Pause"].map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
          {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
          <p className="mt-1.5 text-xs text-muted">
            {prefs.pttMode === "hold"
              ? "Микрофон закрывается через полсекунды после отпускания — так не срезаются концы слов. Если удержание срывается, возьмите «Переключать»."
              : "Нажатие открывает микрофон, второе — закрывает."}{" "}
            Клавиша занимается, только пока вы в разговоре.
          </p>
        </div>
      )}
    </>
  );
}
