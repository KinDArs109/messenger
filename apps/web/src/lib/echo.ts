import source from "./echo-processor.js?raw";

/**
 * Подключение гасителя своего звука к демонстрации экрана.
 *
 * Сам расчёт живёт в echo-processor.js и работает в звуковом потоке
 * браузера. Здесь — только проводка: захват экрана и то, что мы играем
 * в динамики, сходятся на одном узле, а наружу выходит захват без
 * нашего собственного голоса.
 */

/** Обработчик ставится один раз на звуковой движок. Второй вызов
 *  addModule для того же имени — ошибка, а движок у нас переживает
 *  весь разговор и несколько показов экрана подряд. */
const installed = new WeakMap<BaseAudioContext, Promise<void>>();

function install(context: AudioContext): Promise<void> {
  const already = installed.get(context);
  if (already) return already;

  // Через Blob, а не файлом рядом: так код обработчика попадает
  // в сборку вместе со всем остальным и не зависит ни от путей,
  // ни от того, откуда открыто приложение — с сайта или из оболочки.
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  const ready = context.audioWorklet.addModule(url).finally(() => URL.revokeObjectURL(url));
  installed.set(context, ready);
  return ready;
}

export interface EchoGuard {
  /** Звук демонстрации без нашего собственного. */
  track: MediaStreamTrack;
  /** На сколько децибел стало тише и какая нашлась задержка.
   *  null — пока не считано ни одного отчёта. */
  report(): { gain: number; delayMs: number | null } | null;
  stop(): void;
}

/**
 * Убрать из звука демонстрации то, что мы сами играем в динамики.
 *
 * played — узел, через который проходит весь наш вывод: голоса
 * собеседников. Именно он возвращается в захват и заставляет
 * собеседника слышать сам себя.
 *
 * Возвращает null, если сделать этого нельзя — тогда показ идёт как
 * прежде, со звуком и с эхом: остаться вовсе без звука игры хуже.
 */
export async function guardScreenAudio(
  context: AudioContext,
  played: AudioNode,
  captured: MediaStreamTrack,
): Promise<EchoGuard | null> {
  try {
    await install(context);

    const node = new AudioWorkletNode(context, "echo-canceller", {
      numberOfInputs: 2,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      // Явные два канала: захват бывает и одноканальным, и тогда
      // «как придёт» оставило бы правую колонку молчать.
      channelCount: 2,
      channelCountMode: "explicit",
      channelInterpretation: "speakers",
    });

    let last: { gain: number; delayMs: number | null } | null = null;
    node.port.onmessage = (event: MessageEvent<{ gain: number; delayMs: number | null }>) => {
      last = event.data;
    };

    const source = context.createMediaStreamSource(new MediaStream([captured]));
    const destination = context.createMediaStreamDestination();
    source.connect(node, 0, 0);
    played.connect(node, 0, 1);
    node.connect(destination);

    const track = destination.stream.getAudioTracks()[0];
    if (!track) throw new Error("движок не отдал дорожку");

    return {
      track,
      report: () => last,
      stop() {
        node.port.onmessage = null;
        try {
          played.disconnect(node);
        } catch {
          // Узел уже отсоединён — разговор закончился раньше показа.
        }
        source.disconnect();
        node.disconnect();
        track.stop();
      },
    };
  } catch {
    return null;
  }
}
