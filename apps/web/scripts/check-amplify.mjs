// Проверка усилителя голоса — того, что живёт внутри шумодава.
//
//   npm run check:amplify -w @messenger/web
//
// Вопрос ровно один: поднимает ли он тихого человека и не поднимает ли
// заодно тишину. Первое — то, ради чего он есть; второе — то, из-за
// чего усилители выбрасывают.
//
// Считаем на заведомо известном сигнале и настоящим кодом: тот же файл,
// что грузится в браузер, теми же блоками по 128. Никаких возможностей
// звукового движка он не использует — только массивы, поэтому его
// можно прогнать и здесь.

import { pathToFileURL } from "node:url";
import path from "node:path";

const RATE = 48000;
const BLOCK = 128;

globalThis.sampleRate = RATE;
globalThis.currentFrame = 0;

class AudioWorkletProcessorStub {
  constructor() {
    this.port = { postMessage: () => {}, onmessage: null };
  }
}
globalThis.AudioWorkletProcessor = AudioWorkletProcessorStub;

let Processor = null;
globalThis.registerProcessor = (_name, cls) => {
  Processor = cls;
};

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
await import(pathToFileURL(path.join(here, "../public/denoise-worklet.js")).href);

/**
 * Тихий человек в тихой комнате.
 *
 * Голос — сумма нескольких тонов: один синус усилитель вытянул бы
 * красивее, чем настоящую речь, и число получилось бы неправдой.
 * Между фразами — фон комнаты, ради него всё и затевалось.
 */
function сигнал({ громкость, фон, секунды = 8 }) {
  const total = Math.floor((RATE * секунды) / BLOCK) * BLOCK;
  const data = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const t = i / RATE;
    // Полсекунды говорим, полсекунды молчим.
    const говорит = Math.floor(t * 2) % 2 === 0;
    const voice =
      Math.sin(2 * Math.PI * 140 * t) * 0.6 +
      Math.sin(2 * Math.PI * 320 * t) * 0.3 +
      Math.sin(2 * Math.PI * 900 * t) * 0.1;
    const шум = (Math.random() * 2 - 1) * фон;
    data[i] = говорит ? voice * громкость + шум : шум;
  }
  return data;
}

/** Прогнать через шумодав с усилителем или без. */
function прогнать(input, amplify) {
  const proc = new Processor({ processorOptions: { strength: "strong", amplify } });
  const out = new Float32Array(input.length);
  const outBlock = [new Float32Array(BLOCK)];

  for (let at = 0; at + BLOCK <= input.length; at += BLOCK) {
    const inBlock = [input.subarray(at, at + BLOCK)];
    proc.process([inBlock], [outBlock]);
    out.set(outBlock[0], at);
  }
  return out;
}

/** Средний уровень отдельно по речи и по паузам. Начало каждого куска
 *  пропускаем: там переходный процесс, и он портит средние. */
function уровни(data) {
  let речь = 0, речьN = 0, пауза = 0, паузаN = 0, пик = 0;
  // Первую секунду не считаем вовсе: шумодав в это время учится.
  for (let i = RATE; i < data.length; i += 1) {
    const t = i / RATE;
    const край = (t * 2) % 1 < 0.15;
    пик = Math.max(пик, Math.abs(data[i]));
    if (край) continue;
    if (Math.floor(t * 2) % 2 === 0) { речь += data[i] * data[i]; речьN += 1; }
    else { пауза += data[i] * data[i]; паузаN += 1; }
  }
  return {
    речь: Math.sqrt(речь / Math.max(1, речьN)),
    пауза: Math.sqrt(пауза / Math.max(1, паузаN)),
    пик,
  };
}

const дб = (a, b) => 20 * Math.log10((a + 1e-12) / (b + 1e-12));

const результаты = [];
const ok = (пункт, значение, ещё) => {
  результаты.push(Boolean(значение));
  console.log(`${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё ? " " + JSON.stringify(ещё) : ""}`);
};

console.log("\n=== Усилитель голоса ===");

// 1. Тихая гарнитура: голос в двадцать раз тише нормального.
const тихий = сигнал({ громкость: 0.03, фон: 0.002 });
const без = уровни(прогнать(тихий, false));
const с = уровни(прогнать(тихий, true));

ok("тихий голос поднимается заметно", дб(с.речь, без.речь) >= 8, {
  дБ: +дб(с.речь, без.речь).toFixed(1),
});
// Усилитель множит весь кусок целиком — и речь, и то немногое, что
// осталось от шума после чистки. Поэтому спрашивать надо не «на сколько
// поднялись паузы» (ответ будет тот же, что и по голосу, и это нормально),
// а не стало ли хуже слышно: разрыв между речью и тишиной обязан
// сохраниться. Именно его человек и воспринимает как «чисто».
const разрывБыло = дб(без.речь, без.пауза);
const разрывСтало = дб(с.речь, с.пауза);
ok("разрыв между речью и тишиной не съеден", разрывСтало >= разрывБыло - 1, {
  было: +разрывБыло.toFixed(1),
  стало: +разрывСтало.toFixed(1),
});
ok("в паузах по-прежнему тихо", с.пауза < 0.01, { уровень: +с.пауза.toFixed(4) });
ok("не упирается в потолок", с.пик <= 0.99, { пик: +с.пик.toFixed(3) });

// 2. Нормальный голос трогать незачем — он и так слышен.
const обычный = сигнал({ громкость: 0.35, фон: 0.002 });
const обычныйБез = уровни(прогнать(обычный, false));
const обычныйС = уровни(прогнать(обычный, true));
ok("обычный голос почти не трогается", Math.abs(дб(обычныйС.речь, обычныйБез.речь)) <= 4, {
  дБ: +дб(обычныйС.речь, обычныйБез.речь).toFixed(1),
});
ok("обычный не хрипит", обычныйС.пик <= 0.99, { пик: +обычныйС.пик.toFixed(3) });

const провалов = результаты.filter((x) => !x).length;
console.log(
  `\n${провалов === 0 ? "Всё сходится" : `Провалов: ${провалов}`} — проверок ${результаты.length}\n`,
);
process.exit(провалов === 0 ? 0 : 1);
