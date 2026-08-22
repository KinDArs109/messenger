// Проверка гашения своего звука в демонстрации экрана.
//
//   npm run check:echo -w @messenger/web
//
// Собираем заведомо известную задачу: «динамики» играют голос,
// захват экрана слышит его задержанным и подкрашенным, а поверх
// идёт звук игры, который трогать нельзя. Считаем, сколько голоса
// осталось на выходе и сколько игры уцелело.
//
// Обработчик написан для звукового движка браузера, но никаких его
// возможностей не использует — только массивы. Значит, его можно
// прогнать здесь, без браузера, ровно теми же блоками по 128.

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
await import(pathToFileURL(path.join(here, "../src/lib/echo-processor.js")).href);

let failed = false;
const ok = (s) => console.log(`  ✔ ${s}`);
const fail = (s) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};

const дб = (a, b) => 10 * Math.log10((a + 1e-20) / (b + 1e-20));
const энергия = (x, from, to) => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += x[i] * x[i];
  return sum;
};

/** Голос: не ровный тон, а вспышки с паузами. Ровный тон здесь был бы
 *  подтасовкой — задержка ищется по изменениям громкости, а у ровного
 *  тона их нет, и на нём проверка прошла бы, а живой разговор нет. */
function голос(length, seed) {
  const out = new Float32Array(length);
  let rnd = seed;
  const next = () => {
    rnd = (rnd * 1664525 + 1013904223) >>> 0;
    return rnd / 4294967296;
  };

  let i = 0;
  while (i < length) {
    const speaking = next() > 0.35;
    const span = Math.floor((0.15 + next() * 0.35) * RATE);
    if (speaking) {
      const f1 = 120 + next() * 80;
      const f2 = 600 + next() * 900;
      for (let k = 0; k < span && i + k < length; k++) {
        const t = (i + k) / RATE;
        // Затухание по краям: щелчок на обрыве дал бы поиску задержки
        // подсказку, которой в жизни нет.
        const fade = Math.min(1, Math.min(k, span - k) / (0.02 * RATE));
        out[i + k] =
          0.3 * fade * (Math.sin(2 * Math.PI * f1 * t) + 0.6 * Math.sin(2 * Math.PI * f2 * t));
      }
    }
    i += span;
  }
  return out;
}

/** Звук игры: то, ради чего демонстрацию и включают. Его трогать нельзя. */
function игра(length, seed, amp) {
  const out = new Float32Array(length);
  let rnd = seed;
  let low = 0;
  for (let i = 0; i < length; i++) {
    rnd = (rnd * 1103515245 + 12345) >>> 0;
    const white = rnd / 2147483648 - 1;
    low = low * 0.96 + white * 0.04;
    out[i] = amp * (low * 3 + white * 0.3);
  }
  return out;
}

function прогнать({ delay, gain, colour, шум = 0.12, автоусиление = 0 }) {
  const seconds = 14;
  const length = seconds * RATE;

  const played = голос(length, 20260807);
  const other = игра(length, 777, шум);

  // Что слышит захват: наш собственный вывод, вернувшийся задержанным
  // и слегка подкрашенным обработкой звуковой карты, плюс игра.
  const heard = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let echo = 0;
    for (let k = 0; k < colour.length; k++) {
      const j = i - delay - k;
      if (j >= 0) echo += colour[k] * played[j];
    }
    heard[i] = gain * echo + other[i];
  }

  /*
   * Автоусиление на захвате.
   *
   * Браузер по умолчанию обходится с захватом системного звука как
   * с микрофоном и качает его громкость сам. Для вычитания это яд:
   * мы вычитаем то, что отдали, а вернулось оно домноженным на
   * величину, которая живёт своей жизнью и нам неизвестна.
   *
   * Здесь оно ровное и медленное — на деле бывает резче.
   */
  if (автоусиление > 0) {
    for (let i = 0; i < length; i++) {
      heard[i] *= 1 + автоусиление * Math.sin((2 * Math.PI * 0.3 * i) / RATE);
    }
  }

  const processor = new Processor();
  const out = new Float32Array(length);
  const capIn = [new Float32Array(BLOCK)];
  const refIn = [new Float32Array(BLOCK)];
  const outBuf = [new Float32Array(BLOCK)];

  // Насколько показ приглушён на каждом блоке. Без этого «остаток
  // эха» посчитать нельзя: приглушение придавливает и звук игры,
  // а игру мы вычитаем, чтобы остался чистый остаток нашего голоса.
  const приглушение = new Float32Array(length);

  let было = -1;
  for (let at = 0; at + BLOCK <= length; at += BLOCK) {
    capIn[0].set(heard.subarray(at, at + BLOCK));
    refIn[0].set(played.subarray(at, at + BLOCK));
    outBuf[0].fill(0);
    processor.process([capIn, refIn], [outBuf], {});
    out.set(outBuf[0], at);
    приглушение.fill(processor.duckGain, at, at + BLOCK);
    // Каждая смена задержки обнуляет фильтр. Если их много, значит
    // поиск мечется, и настроиться он не успевает никогда.
    if (processor.delay !== было) {
      было = processor.delay;
      if (process.env.ECHO_DEBUG) {
        console.log(`    ${(at / RATE).toFixed(1)} с: задержка стала ${было}`);
      }
    }
  }

  // Смотрим последние четыре секунды: первые уходят на поиск задержки,
  // и мерить по ним — значит мерить сходимость, а не результат.
  const from = length - 4 * RATE;
  const to = length;

  // Сколько нашего голоса осталось. Игру знаем точно, поэтому вычитаем
  // её и получаем чистый остаток эха.
  const residue = new Float32Array(to - from);
  for (let i = from; i < to; i++) residue[i - from] = out[i] - приглушение[i] * other[i];

  const эхо = энергия(heard, from, to) - энергия(other, from, to);
  const стало = энергия(residue, 0, residue.length);

  // Заодно — во сколько обошлось приглушение самому звуку игры.
  let сумма = 0;
  for (let i = from; i < to; i++) сумма += приглушение[i];

  return {
    подавление: дб(Math.max(эхо, 0), стало),
    задержка: processor.delay,
    играТише: -20 * Math.log10(Math.max(сумма / (to - from), 1e-6)),
  };
}

console.log("\nПроверка гашения своего голоса в звуке демонстрации\n");

// Обычный случай: сотня миллисекунд задержки, звук чуть тише и слегка
// подкрашен обработкой.
const обычный = прогнать({
  delay: 4800,
  gain: 0.8,
  colour: [1, 0.25, -0.1],
});
console.log(
  `  задержка найдена: ${обычный.задержка} отсчётов ` +
    `(${((обычный.задержка / RATE) * 1000).toFixed(0)} мс, на деле 100 мс)`,
);
console.log(
  `  свой голос тише на ${обычный.подавление.toFixed(1)} дБ` +
    ` (из них приглушением — до ${обычный.играТише.toFixed(1)})`,
);

if (Math.abs(обычный.задержка - 4800) <= 64) ok("задержка найдена верно");
else fail(`задержка найдена неверно: ${обычный.задержка} вместо примерно 4800`);

if (обычный.подавление >= 20) ok(`свой голос погашен на ${обычный.подавление.toFixed(1)} дБ`);
else fail(`свой голос погашен всего на ${обычный.подавление.toFixed(1)} дБ, надо хотя бы 20`);

// Без постороннего звука видно, насколько точно вообще получается
// повторить обратный путь. Здесь мешать нечему, и остаться должно
// почти ничего — иначе дело не в чужом звуке, а в самом расчёте.
const чисто = прогнать({ delay: 4800, gain: 0.8, colour: [1, 0.25, -0.1], шум: 0 });
console.log(`  без постороннего звука: ${чисто.подавление.toFixed(1)} дБ`);
if (чисто.подавление >= 40) ok("на чистом сигнале свой голос убирается почти полностью");
else fail(`на чистом сигнале погашено всего ${чисто.подавление.toFixed(1)} дБ, надо хотя бы 40`);

// Долгая задержка: медленная звуковая карта или Bluetooth-наушники.
const долгая = прогнать({ delay: 19200, gain: 0.6, colour: [1, 0.4] });
console.log(`\n  задержка 400 мс: найдено ${долгая.задержка}, погашено ${долгая.подавление.toFixed(1)} дБ`);
if (долгая.подавление >= 20) ok("долгая задержка тоже находится");
else fail(`при задержке 400 мс погашено ${долгая.подавление.toFixed(1)} дБ`);

/*
 * Автоусиление на захвате: сколько оно стоит гасителю.
 *
 * Мы просим браузер его выключить (lib/voice.ts, startScreen) — но
 * не поэтому. Догадка была, что оно ломает вычитание: вычитаемое
 * домножается на величину, которая живёт своей жизнью. Проверка
 * догадку не подтвердила — подстраивающийся фильтр успевает
 * за медленной качкой, и цена ей пара децибел.
 *
 * Число здесь и стоит: чтобы в следующий раз не гадать об этом
 * заново. Выключаем же обработку ради самого звука: шумодав ест
 * ровный гул и хвосты, автоусиление качает громкость вслед за
 * выстрелами, а стерео схлопывается в моно.
 */
const сАвтоусилением = прогнать({
  delay: 4800,
  gain: 0.8,
  colour: [1, 0.25, -0.1],
  автоусиление: 0.5,
});
console.log(
  `
  с автоусилением на захвате: ${сАвтоусилением.подавление.toFixed(1)} дБ ` +
    `(без него ${обычный.подавление.toFixed(1)})`,
);
if (сАвтоусилением.подавление >= обычный.подавление - 6) {
  ok("медленное автоусиление гасителю почти не мешает — фильтр за ним успевает");
} else {
  fail(
    `автоусиление отняло ${(обычный.подавление - сАвтоусилением.подавление).toFixed(1)} дБ: ` +
      "фильтр перестал за ним успевать",
  );
}

/*
 * Приглушение показа, пока звучим мы сами.
 *
 * Двадцать децибел вычитания — это много и мало разом: голос, тише
 * в десять раз, но с задержкой, слышно прекрасно. Поэтому показ ещё
 * и приседает, пока в динамиках кто-то говорит. Здесь проверяется,
 * что он приседает вовремя и, главное, встаёт обратно: показ, тихий
 * навсегда, был бы лечением хуже болезни.
 */
{
  const length = 8 * RATE;
  const other = игра(length, 999, 0.12);
  // В динамиках голос звучит только во второй четверти времени.
  const played = new Float32Array(length);
  const кусок = голос(2 * RATE, 4242);
  played.set(кусок, 2 * RATE);

  const processor = new Processor();
  const out = new Float32Array(length);
  const capIn = [new Float32Array(BLOCK)];
  const refIn = [new Float32Array(BLOCK)];
  const outBuf = [new Float32Array(BLOCK)];

  for (let at = 0; at + BLOCK <= length; at += BLOCK) {
    // Захват — одна игра: эха здесь нет вовсе, чтобы мерить именно
    // приглушение, а не вычитание.
    capIn[0].set(other.subarray(at, at + BLOCK));
    refIn[0].set(played.subarray(at, at + BLOCK));
    outBuf[0].fill(0);
    processor.process([capIn, refIn], [outBuf], {});
    out.set(outBuf[0], at);
  }

  const отрезок = (сек) => {
    const from = Math.round(сек[0] * RATE);
    const to = Math.round(сек[1] * RATE);
    return дб(энергия(other, from, to), энергия(out, from, to));
  };

  const пока = отрезок([2.5, 3.8]);
  const до = отрезок([0.5, 1.8]);
  const после = отрезок([5, 7.5]);

  console.log(
    `
  показ приглушается на ${пока.toFixed(1)} дБ, пока в динамиках говорят` +
      ` (до: ${до.toFixed(1)}, после: ${после.toFixed(1)})`,
  );

  if (пока >= 10) ok(`пока говорят, показ тише на ${пока.toFixed(1)} дБ`);
  else fail(`показ приглушается всего на ${пока.toFixed(1)} дБ, надо хотя бы 10`);

  if (Math.abs(до) < 1) ok("пока в динамиках тихо, показ идёт в полную силу");
  else fail(`показ приглушён и без надобности: ${до.toFixed(1)} дБ`);

  if (Math.abs(после) < 1) ok("и возвращается в полную силу, когда договорили");
  else fail(`показ не вернулся в полную силу: ${после.toFixed(1)} дБ`);
}

// Тишина в динамиках: гасить нечего, и звук игры должен пройти нетронутым.
const тишина = (() => {
  const length = 6 * RATE;
  const other = игра(length, 555, 0.12);
  const processor = new Processor();
  const out = new Float32Array(length);
  const capIn = [new Float32Array(BLOCK)];
  const refIn = [new Float32Array(BLOCK)];
  const outBuf = [new Float32Array(BLOCK)];
  for (let at = 0; at + BLOCK <= length; at += BLOCK) {
    capIn[0].set(other.subarray(at, at + BLOCK));
    refIn[0].fill(0);
    outBuf[0].fill(0);
    processor.process([capIn, refIn], [outBuf], {});
    out.set(outBuf[0], at);
  }
  let diff = 0;
  for (let i = 0; i < length; i++) diff += (out[i] - other[i]) ** 2;
  return diff;
})();

if (тишина === 0) ok("когда в динамиках тихо, звук игры проходит нетронутым");
else fail(`звук игры изменён на пустом месте: расхождение ${тишина}`);

console.log(failed ? "\nЕсть провалы\n" : "\nВсё сходится\n");
process.exitCode = failed ? 1 : 0;
