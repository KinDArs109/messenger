/**
 * Гашение собственного звука в демонстрации экрана.
 *
 * Захват звука с экрана берёт не звук игры, а весь вывод системы —
 * то есть и голоса собеседников, которые в этот момент играют в
 * динамиках. Собеседник в результате слышит сам себя с задержкой.
 *
 * Браузеры завели для этого ограничение restrictOwnAudio. Замерено:
 * в оболочке оно объявлено, принимается и не делает ничего — свой
 * тон остаётся в захвате в той же силе (см. desktop/scripts/test-echo).
 * Поэтому вычитаем сами.
 *
 * Условия здесь заметно добрее, чем у обычного эхоподавления:
 * это не микрофон в комнате, а цифровая петля внутри системы.
 * Никакой комнаты, никакого переотражения — то же самое, что мы
 * отдали в динамики, возвращается в захват задержанным и, возможно,
 * подкрашенным обработкой звуковой карты. Значит, достаточно найти
 * задержку и вычесть — а поправку на подкраску возьмёт на себя
 * короткий подстраивающийся фильтр.
 *
 * Два входа: 0 — захват экрана, 1 — то, что мы играем в динамики.
 * Выход — захват без нашего собственного звука.
 */

/** Насколько глубоко помним, что играли. 65536 отсчётов — это 1,37 с
 *  при 48 кГц, с большим запасом на задержку звуковой карты. */
const REF_LEN = 1 << 16;
const REF_MASK = REF_LEN - 1;

/** Длина подстраивающегося фильтра. 128 отсчётов — 2,7 мс: этого
 *  хватает и на промах поиска задержки, и на подкраску обработкой,
 *  а считать его приходится на каждый отсчёт, и брать больше — значит
 *  греть процессор ради несуществующей разницы. */
const TAPS = 128;
const HALF = TAPS >> 1;

/** Задержку ищем по огрублённой громкости, а не по самому звуку:
 *  перебирать полсекунды отсчёт за отсчётом — это сотни миллионов
 *  умножений, а по огибающей та же работа выходит в тысячу раз
 *  дешевле. Точности до 32 отсчётов достаточно — остальное доберёт
 *  фильтр. */
const DECIM = 32;
const ENV_LEN = 2048;
const ENV_MASK = ENV_LEN - 1;

/** Докуда ищем задержку: 768 × 32 = 24576 отсчётов ≈ 0,5 с. Дольше
 *  не бывает даже у самой неторопливой звуковой карты. */
const SEARCH = 768;

/** Окно сравнения — 1024 × 32 ≈ 0,68 с.
 *
 *  Первая версия брала 128 мс, и это оказалось короче одной фразы:
 *  внутри окна громкость почти не менялась, сравнивать было нечего,
 *  и задержка находилась случайная. Окно должно захватывать хотя бы
 *  пару пауз — по ним совпадение и опознаётся. */
const WINDOW = 1024;

/** Шаг подстройки.
 *
 *  Больше — быстрее сходится, но сильнее дёргается на чужом звуке
 *  (той самой игре), который вычитать не нужно. Замерено на модели:
 *  при 0,008 фильтр выходит на режим за пару секунд и убирает свой
 *  голос примерно на 21 дБ при громкой игре и на 55, когда в динамиках
 *  один голос. Дальше уменьшать бесполезно — упирается уже не в шаг,
 *  а в то, что чужой звук лежит в тех же частотах, что и голос.
 *
 *  На настоящем железе вышло лучше модели: 34 дБ при найденной
 *  задержке 111 мс (desktop/scripts/test-echo). Модель нарочно злее —
 *  в ней громкая помеха звучит непрерывно. */
const MU = 0.008;

/** Сколько вариантов задержки перебираем за один блок. Весь перебор
 *  разложен по блокам намеренно: посчитать его разом — это миллионы
 *  операций внутри звукового потока, то есть щелчок. */
const LAGS_PER_BLOCK = 8;

/** Как часто заново искать задержку. Она почти не меняется, но часы
 *  звуковой карты и часы браузера идут чуть по-разному, и за минуту
 *  расхождение накапливается. */
const RESEARCH_EVERY = 24000;

/** Как часто отчитываться наверх. */
const REPORT_EVERY = 48000;

/** Порог тишины в опорном сигнале — и одновременно добавка к
 *  знаменателю шага подстройки.
 *
 *  На этом ломалась вторая версия. Шаг делится на силу окна, и когда
 *  в динамиках почти тихо, делитель уходит в ноль: ошибка в этот
 *  момент состоит из чужого звука, вычитать который не надо вовсе,
 *  а поделённая на почти ноль она разносила уже настроенный фильтр
 *  вдребезги. Наружу это выходило так, что с гашением звук получался
 *  хуже, чем без него.
 *
 *  Величина отвечает уровню −60 дБ на отсчёт: тише этого в динамиках
 *  ничего не играет, а значит и гасить нечего. */
const FLOOR = TAPS * 1e-6;

class EchoCanceller extends AudioWorkletProcessor {
  constructor() {
    super();

    this.ref = [new Float32Array(REF_LEN), new Float32Array(REF_LEN)];
    this.weights = [new Float32Array(TAPS), new Float32Array(TAPS)];
    this.power = [0, 0];
    /** Отрезок опорного сигнала на блок: копируем его подряд, чтобы
     *  во внутреннем цикле не считать кольцевой индекс на каждый шаг. */
    this.scratch = [new Float32Array(TAPS + 128), new Float32Array(TAPS + 128)];

    this.n = 0;
    /** Задержка в отсчётах; −1 — ещё не нашли, вычитать нечего. */
    this.delay = -1;
    this.enabled = true;

    this.envRef = new Float32Array(ENV_LEN);
    this.envCap = new Float32Array(ENV_LEN);
    this.envPos = 0;
    this.sumRef = 0;
    this.sumCap = 0;
    this.sumCount = 0;

    // Состояние поиска задержки.
    this.searchCap = new Float32Array(WINDOW);
    this.searchRef = new Float32Array(WINDOW + SEARCH);
    this.searching = false;
    this.lag = 0;
    this.bestLag = -1;
    this.bestScore = 0;
    this.capNorm = 0;
    this.sinceSearch = RESEARCH_EVERY;

    // Отчётность: сколько было и сколько осталось.
    this.inSum = 0;
    this.outSum = 0;
    this.sinceReport = 0;

    this.port.onmessage = (event) => {
      if (event.data === "reset") this.forget();
      if (event.data === "off") this.enabled = false;
      if (event.data === "on") this.enabled = true;
    };
  }

  /** Забыть найденное и начать сначала. */
  forget() {
    this.delay = -1;
    this.searching = false;
    this.sinceSearch = RESEARCH_EVERY;
    for (const w of this.weights) w.fill(0);
    this.power[0] = 0;
    this.power[1] = 0;
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const capture = inputs[0];
    const reference = inputs[1];
    if (!out || out.length === 0) return true;

    const frames = out[0].length;
    const hasCapture = capture && capture.length > 0 && capture[0].length > 0;

    // Захвата нет — отдавать нечего. Тишина, а не молчаливая ошибка.
    if (!hasCapture) {
      for (const channel of out) channel.fill(0);
      return true;
    }

    const hasRef = reference && reference.length > 0 && reference[0].length > 0;
    const channels = Math.min(out.length, capture.length);

    this.remember(reference, hasRef, frames);

    const ready = this.enabled && this.delay >= 0;
    if (ready) this.prepare(frames);

    for (let ch = 0; ch < channels; ch++) {
      const heard = capture[ch] ?? capture[0];
      const clean = out[ch];

      if (!ready) {
        clean.set(heard.subarray(0, frames));
        continue;
      }

      this.subtract(ch, heard, clean, frames);
    }

    // Лишние каналы выхода (если их больше, чем в захвате) повторяют
    // первый: молчащая правая колонка выглядела бы поломкой.
    for (let ch = channels; ch < out.length; ch++) out[ch].set(out[0]);

    this.envelopes(capture[0], frames);
    this.n += frames;
    this.track(capture[0], out[0], frames);
    this.seek(frames);
    return true;
  }

  /** Запомнить, что мы сейчас играем. */
  remember(reference, hasRef, frames) {
    const left = hasRef ? reference[0] : null;
    const right = hasRef ? (reference[1] ?? reference[0]) : null;

    for (let i = 0; i < frames; i++) {
      const index = (this.n + i) & REF_MASK;
      const value = left ? left[i] : 0;
      this.ref[0][index] = value;
      this.ref[1][index] = right ? right[i] : value;
    }
  }

  /** Огрублённая громкость обоих сигналов — по ней ищется задержка.
   *
   *  Оба считаются в одном проходе намеренно: это две дорожки одного
   *  времени, и разъехавшись хотя бы на блок, они дали бы задержку,
   *  которой нет. */
  envelopes(heard, frames) {
    const ring = this.ref[0];
    for (let i = 0; i < frames; i++) {
      const played = ring[(this.n + i) & REF_MASK];
      this.sumRef += played < 0 ? -played : played;
      this.sumCap += heard[i] < 0 ? -heard[i] : heard[i];
      if (++this.sumCount < DECIM) continue;

      const p = this.envPos & ENV_MASK;
      this.envRef[p] = this.sumRef;
      this.envCap[p] = this.sumCap;
      this.envPos++;
      this.sumRef = 0;
      this.sumCap = 0;
      this.sumCount = 0;
    }
  }

  /** Скопировать нужный отрезок опорного сигнала подряд и заново
   *  посчитать его силу.
   *
   *  Сила окна считается здесь целиком, а не накапливается от блока
   *  к блоку. Накопление выглядело дешевле, но на нём всё и рушилось:
   *  после смены задержки счётчик начинался с нуля, а звук в окне —
   *  нет. Шаг подстройки делится на эту величину, и делённое на почти
   *  ноль улетало в бесконечность за доли секунды. Сто двадцать восемь
   *  сложений на блок — честная цена за то, что этого не случится. */
  prepare(frames) {
    // x[0] — самый старый отсчёт, который выпадет из окна на первом
    // шаге; x[TAPS] — самый свежий, который в него войдёт.
    const start = this.n - this.delay + HALF - TAPS;
    for (let ch = 0; ch < 2; ch++) {
      const ring = this.ref[ch];
      const x = this.scratch[ch];
      for (let j = 0; j <= TAPS + frames - 1; j++) {
        x[j] = ring[(start + j) & REF_MASK];
      }
      // Считаем по окну «до первого шага»: первое же движение цикла
      // добавит x[TAPS] и выбросит x[0], и окно станет ровно тем,
      // по которому берутся отводы.
      let power = 0;
      for (let j = 0; j < TAPS; j++) power += x[j] * x[j];
      this.power[ch] = power;
    }
  }

  /** Вычесть свой звук из одного канала. */
  subtract(ch, heard, clean, frames) {
    const w = this.weights[ch];
    const x = this.scratch[ch];
    let power = this.power[ch];

    for (let i = 0; i < frames; i++) {
      const newest = x[i + TAPS];
      const dropped = x[i];
      power += newest * newest - dropped * dropped;
      if (power < 0) power = 0;

      const d = heard[i];

      // Опорного сигнала нет — вычитать нечего, и подстраиваться
      // не на чем: любое движение фильтра здесь было бы шумом.
      if (power < FLOOR) {
        clean[i] = d;
        continue;
      }

      const base = i + TAPS;
      let y = 0;
      for (let k = 0; k < TAPS; k++) y += w[k] * x[base - k];

      const e = d - y;
      const step = (MU * e) / (power + FLOOR);
      for (let k = 0; k < TAPS; k++) w[k] += step * x[base - k];

      clean[i] = e;
    }

    this.power[ch] = power;
  }

  /** Сколько было слышно и сколько осталось. По этому же считаем,
   *  не делаем ли мы хуже. */
  track(heard, clean, frames) {
    for (let i = 0; i < frames; i++) {
      this.inSum += heard[i] * heard[i];
      this.outSum += clean[i] * clean[i];
    }

    this.sinceReport += frames;
    if (this.sinceReport < REPORT_EVERY) return;

    const gain = this.inSum > 1e-9 ? 10 * Math.log10(this.inSum / (this.outSum + 1e-12)) : 0;
    this.port.postMessage({
      /** На сколько децибел стало тише. */
      gain: Math.round(gain * 10) / 10,
      delayMs: this.delay < 0 ? null : Math.round((this.delay / sampleRate) * 1000),
    });

    // Стало громче, чем было, — значит фильтр разошёлся. Начинаем
    // сначала: лучше не гасить вовсе, чем портить звук игры.
    if (this.delay >= 0 && this.inSum > 1e-7 && this.outSum > this.inSum * 1.2) this.forget();

    this.inSum = 0;
    this.outSum = 0;
    this.sinceReport = 0;
  }

  /** Поиск задержки. Идёт по кусочку в каждом блоке, чтобы не
   *  задерживать звуковой поток. */
  seek(frames) {
    if (!this.enabled) return;

    if (!this.searching) {
      this.sinceSearch += frames;
      if (this.sinceSearch < RESEARCH_EVERY) return;
      if (this.envPos < WINDOW + SEARCH) return;
      this.snapshot();
      return;
    }

    const until = Math.min(this.lag + LAGS_PER_BLOCK, SEARCH);
    for (; this.lag < until; this.lag++) {
      const score = this.score(this.lag);
      if (score > this.bestScore) {
        this.bestScore = score;
        this.bestLag = this.lag;
      }
    }

    if (this.lag < SEARCH) return;

    this.searching = false;
    this.sinceSearch = 0;

    // Ниже этого совпадение случайное: в динамиках либо тишина,
    // либо звучит вовсе не наше.
    if (this.bestScore < 0.3 || this.bestLag < 0) return;

    const found = Math.max(HALF, this.bestLag * DECIM);
    if (found > REF_LEN - TAPS - 256) return;

    // Мелкие расхождения фильтр держит сам — трогать его из-за них
    // значило бы сбивать уже найденное.
    if (this.delay >= 0 && Math.abs(found - this.delay) <= HALF / 2) return;

    this.delay = found;
    for (const w of this.weights) w.fill(0);
    this.power[0] = 0;
    this.power[1] = 0;
  }

  /** Снять срез огибающих и начать перебор. */
  snapshot() {
    const last = this.envPos - 1;
    let mean = 0;
    for (let i = 0; i < WINDOW; i++) {
      const value = this.envCap[(last - i) & ENV_MASK];
      this.searchCap[i] = value;
      mean += value;
    }
    mean /= WINDOW;

    let norm = 0;
    for (let i = 0; i < WINDOW; i++) {
      this.searchCap[i] -= mean;
      norm += this.searchCap[i] * this.searchCap[i];
    }

    for (let i = 0; i < WINDOW + SEARCH; i++) {
      this.searchRef[i] = this.envRef[(last - i) & ENV_MASK];
    }

    this.capNorm = norm;
    this.searching = norm > 1e-6;
    this.lag = 0;
    this.bestLag = -1;
    this.bestScore = 0;
  }

  /** Насколько похоже то, что мы слышим, на то, что играли столько-то
   *  назад. От −1 до 1; среднее вычитаем, иначе сравнение сведётся
   *  к тому, что обе громкости неотрицательны. */
  score(lag) {
    const cap = this.searchCap;
    const ref = this.searchRef;

    let mean = 0;
    for (let i = 0; i < WINDOW; i++) mean += ref[lag + i];
    mean /= WINDOW;

    let dot = 0;
    let norm = 0;
    for (let i = 0; i < WINDOW; i++) {
      const value = ref[lag + i] - mean;
      dot += cap[i] * value;
      norm += value * value;
    }

    if (norm < 1e-6) return 0;
    return dot / Math.sqrt(norm * this.capNorm);
  }
}

registerProcessor("echo-canceller", EchoCanceller);
