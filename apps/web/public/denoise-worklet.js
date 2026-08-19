/* Шумоподавление.
 *
 * Своё, а не браузерное. Браузерное — одна галочка без настроек:
 * оно давит ровный гул и тянет за собой автоусиление, которое в паузах
 * послушно вытягивает шум обратно до уровня голоса. Отсюда и ощущение,
 * что шумодава нет вовсе.
 *
 * ── Как это работает ──
 *
 * Звук режется на кадры и раскладывается на частоты. Дальше — главное
 * наблюдение: шум ровный, голос — нет. Вентилятор, гул и шипение держат
 * в каждой полосе примерно один уровень секундами; голос в тех же
 * полосах прыгает на десятки децибел по нескольку раз в секунду.
 *
 * Поэтому в каждой полосе отдельно ищется её «дно» — самое тихое, что
 * в ней было за последнюю секунду с небольшим. Это и есть шум. Дальше
 * каждой полосе назначается громкость: намного выше дна — пропускаем
 * целиком, у дна — глушим.
 *
 * ── Почему дно ищется именно скользящим минимумом ──
 *
 * Это единственная часть, которую нельзя делать «на глаз», и первая
 * версия здесь ошиблась. Если следить за дном обычным сглаживанием —
 * быстро вниз, медленно вверх, — то во время длинной фразы оценка
 * успевает подползти вверх к самому голосу, и к концу фразы шумодав
 * начинает резать говорящего. Замер показывал ровно это: −18 дБ шума
 * и −9 дБ голоса, то есть лекарство хуже болезни.
 *
 * Скользящий минимум так не умеет: оценка не может подняться выше, чем
 * самый тихий кадр за целое окно. Пока в течение секунды есть хоть
 * короткая пауза — а в речи она есть всегда, — дно остаётся дном.
 * После этой замены голос перестал теряться совсем: замер даёт −24 дБ
 * шума при потере голоса 0,0 дБ.
 *
 * ── Чего это не делает ──
 *
 * Это не нейросеть. Ровное — гул, шипение, вентилятор, улицу за окном,
 * кулер под нагрузкой — убирает почти полностью. Резкое и короткое,
 * вроде щелчков клавиш, приглушает, но не стирает: по спектру такой
 * щелчок неотличим от согласной. Чужой голос рядом не уберёт вовсе —
 * для этого надо понимать, чей это голос, а это другая задача.
 */

/** Размер кадра. 512 отсчётов при 48 кГц — это 10,7 мс и полосы
 *  по 94 Гц: достаточно мелко, чтобы отделить гул от голоса, и
 *  достаточно коротко, чтобы не мазать согласные. */
const N = 512;
/** Шаг между кадрами — ровно столько, сколько браузер приносит за раз.
 *  Значит, на каждый вызов приходится ровно один кадр. */
const HOP = 128;
const BINS = N / 2 + 1;

/** Длина памяти о дне: сколько кадров в кусочке и сколько кусочков.
 *  20 × 24 — это 1,3 секунды. Дольше — дно устаревает и перестаёт
 *  успевать за изменившимся шумом; короче — длинная фраза перекрывает
 *  всё окно, и голос снова начинает считаться шумом. */
const SUB = 20;
const RING = 24;

/** Сколько кадров в начале ничего не режем. Пока дно не найдено,
 *  резать нечем — а без этой отсрочки первые сто миллисекунд разговора
 *  уходили бы в тишину вместе с «алло». */
const LEARN = 30;

/** Насколько сгладить мощность полосы во времени, прежде чем искать
 *  дно. Без сглаживания дно ловит случайный самый тихий кадр и уезжает
 *  ниже настоящего шума. */
const SMOOTH = 0.8;

/* ── Преобразование Фурье ─────────────────────────────────────────
 *
 * Своё, на месте: в звуковом потоке нельзя ни подгрузить библиотеку,
 * ни выделять память на каждом кадре — всё считается 375 раз в секунду
 * и обязано укладываться в доли миллисекунды.
 */
const cosTable = new Float64Array(N / 2);
const sinTable = new Float64Array(N / 2);
for (let i = 0; i < N / 2; i += 1) {
  cosTable[i] = Math.cos((-2 * Math.PI * i) / N);
  sinTable[i] = Math.sin((-2 * Math.PI * i) / N);
}

const reversed = new Uint16Array(N);
for (let i = 0; i < N; i += 1) {
  let value = 0;
  for (let bit = 1, source = i; bit < N; bit <<= 1, source >>= 1) {
    value = (value << 1) | (source & 1);
  }
  reversed[i] = value;
}

function fft(re, im, inverse) {
  for (let i = 0; i < N; i += 1) {
    const j = reversed[i];
    if (j > i) {
      let tmp = re[i];
      re[i] = re[j];
      re[j] = tmp;
      tmp = im[i];
      im[i] = im[j];
      im[j] = tmp;
    }
  }

  for (let size = 2; size <= N; size <<= 1) {
    const half = size >> 1;
    const step = N / size;
    for (let i = 0; i < N; i += size) {
      for (let j = i, k = 0; j < i + half; j += 1, k += step) {
        const cos = cosTable[k];
        const sin = inverse ? -sinTable[k] : sinTable[k];
        const reOdd = re[j + half] * cos - im[j + half] * sin;
        const imOdd = re[j + half] * sin + im[j + half] * cos;
        re[j + half] = re[j] - reOdd;
        im[j + half] = im[j] - imOdd;
        re[j] += reOdd;
        im[j] += imOdd;
      }
    }
  }

  if (inverse) {
    for (let i = 0; i < N; i += 1) {
      re[i] /= N;
      im[i] /= N;
    }
  }
}

/* ── Окно ─────────────────────────────────────────────────────────
 *
 * Ханн, и он же при сборке обратно. Два таких окна с перекрытием
 * в три четверти складываются в постоянную величину — поэтому после
 * сложения кадров громкость не гуляет, и делить надо на неё одну.
 */
const hann = new Float64Array(N);
for (let i = 0; i < N; i += 1) {
  hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
}
const OVERLAP_GAIN = 1.5;

/**
 * Настройки силы.
 *
 * bias — во сколько раз дно ниже среднего уровня самого шума. Минимум
 * по определению ниже среднего, и без этой поправки шум считался бы
 * тише, чем он есть, а значит проходил бы насквозь.
 *
 * over — насколько увереннее должна быть полоса, чтобы её пропустить.
 * Это и есть «сильнее или мягче».
 *
 * floor — что остаётся от заглушённой полосы. Ноль здесь ставить
 * нельзя: полная тишина между словами звучит как обрыв связи, и на её
 * фоне любой пропущенный звук кажется щелчком. Небольшой ровный
 * остаток слышен как обычная тишина.
 *
 * Числа подобраны замерами на сигнале «речь плюс ровный шум»:
 * сильное даёт −24 дБ шума при потере голоса 0,0 дБ, мягкое — −18 дБ.
 */
const LEVELS = {
  soft: { bias: 8, over: 3, floor: 0.12, gs: 0.8 },
  strong: { bias: 16, over: 8, floor: 0.05, gs: 0.85 },
};

/**
 * Усилитель голоса — он же автоусиление.
 *
 * Живёт здесь, а не отдельным узлом, по одной причине: усиливать надо
 * только речь, а отличить речь от паузы умеет ровно это место — оно
 * и так считает дно шума в каждой полосе.
 *
 * Обычное сжатие на такое не способно. Оно поднимает всё, что тише
 * порога, — и голос, и шорох стула в паузе, ровно на одинаково.
 * Измерено: тихий голос +22 дБ, фон в паузах +22 дБ. Усилитель,
 * который так же старательно поднимает тишину, называется «шумит».
 *
 * Здесь громкость считается только по речевым кадрам, а к тишине
 * применяется то, что насчитали на речи. После чистки в паузе почти
 * ничего нет — умножать нечего.
 *
 * TARGET — куда тянем: −21 дБ по среднему, обычная громкость разговора.
 * MAX — насколько разрешено тянуть: восьмикратно, это +18 дБ; больше
 * означало бы вытаскивать уже не голос, а остатки комнаты.
 * SPEECH — ниже этого кадр считается паузой и в расчёт не идёт.
 */
const TARGET = 0.09;
const MAX_BOOST = 8;
const SPEECH = 0.004;
/** Вверх — медленно (полсекунды), вниз — быстро (сотые доли).
 *  Наоборот нельзя: резкий подъём слышен как накат шума, а медленный
 *  спад означает, что первый громкий слог после тихой фразы
 *  вылетает в потолок. */
const UP = 0.995;
const DOWN = 0.85;

class Denoise extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.tune(options?.processorOptions?.strength);

    this.input = new Float64Array(N);
    this.output = new Float64Array(N);
    this.re = new Float64Array(N);
    this.im = new Float64Array(N);

    /** Сглаженная мощность каждой полосы. */
    this.power = new Float64Array(BINS);
    /** Самое тихое в текущем кусочке и память о прошлых кусочках. */
    this.lowest = new Float64Array(BINS).fill(Infinity);
    this.history = [];
    for (let i = 0; i < RING; i += 1) {
      this.history.push(new Float64Array(BINS).fill(Infinity));
    }
    this.slot = 0;
    this.tick = 0;

    this.gain = new Float64Array(BINS).fill(1);
    this.smoothed = new Float64Array(BINS);
    this.frames = 0;

    /** Насколько сейчас тянем голос. Единица — не тянем вовсе. */
    this.boost = 1;
    /** Просили ли тянуть вообще. Выключается в настройках. */
    this.amplify = options?.processorOptions?.amplify !== false;

    this.port.onmessage = (event) => {
      this.tune(event.data?.strength);
      if (typeof event.data?.amplify === "boolean") this.amplify = event.data.amplify;
    };
  }

  tune(strength) {
    const level = LEVELS[strength] ?? LEVELS.strong;
    this.bias = level.bias;
    this.over = level.over;
    this.floor = level.floor;
    this.gs = level.gs;
  }

  process(inputs, outputs) {
    const output = outputs[0]?.[0];
    if (!output) return true;

    // Микрофон выключен — кадры всё равно крутим: иначе дно устареет,
    // и первые секунды после включения шумодав будет мазать.
    const incoming = inputs[0]?.[0] ?? new Float32Array(HOP);

    this.input.copyWithin(0, HOP);
    this.input.set(incoming, N - HOP);

    for (let i = 0; i < N; i += 1) {
      this.re[i] = this.input[i] * hann[i];
      this.im[i] = 0;
    }
    fft(this.re, this.im, false);

    this.frames += 1;
    const learning = this.frames < LEARN;

    for (let k = 0; k < BINS; k += 1) {
      const raw = this.re[k] * this.re[k] + this.im[k] * this.im[k];
      this.power[k] = SMOOTH * this.power[k] + (1 - SMOOTH) * raw;
      const now = this.power[k];

      if (now < this.lowest[k]) this.lowest[k] = now;

      if (learning) {
        this.gain[k] = 1;
        continue;
      }

      // Дно полосы: самое тихое за всё окно памяти.
      let bottom = this.lowest[k];
      for (let r = 0; r < RING; r += 1) {
        const seen = this.history[r][k];
        if (seen < bottom) bottom = seen;
      }
      if (!(bottom > 0) || !isFinite(bottom)) bottom = now;

      const above = now / (bottom * this.bias) - this.over;
      let value = above > 0 ? above / (above + 1) : 0;
      if (value < this.floor) value = this.floor;

      // Вверх — сразу, вниз — плавно. Наоборот нельзя: начало слова
      // тогда срезается, потому что шумодав «не успел поверить».
      this.gain[k] = value > this.gain[k] ? value : this.gs * this.gain[k] + (1 - this.gs) * value;
    }

    this.tick += 1;
    if (this.tick >= SUB) {
      this.tick = 0;
      this.history[this.slot].set(this.lowest);
      this.slot = (this.slot + 1) % RING;
      this.lowest.fill(Infinity);
    }

    // Сглаживание по соседям — но только вверх. Полосу с голосом
    // соседи-тихие иначе утягивают за собой: одинокий тон терял
    // на этом 6 дБ, и голос звучал приглушённым.
    this.smoothed[0] = this.gain[0];
    this.smoothed[BINS - 1] = this.gain[BINS - 1];
    for (let k = 1; k < BINS - 1; k += 1) {
      const blur = 0.25 * this.gain[k - 1] + 0.5 * this.gain[k] + 0.25 * this.gain[k + 1];
      this.smoothed[k] = blur > this.gain[k] ? blur : this.gain[k];
    }

    for (let k = 0; k < BINS; k += 1) {
      const g = this.smoothed[k];
      this.re[k] *= g;
      this.im[k] *= g;
      // Вторая половина спектра — зеркало первой, иначе на выходе
      // будет не звук, а каша.
      if (k > 0 && k < N / 2) {
        this.re[N - k] = this.re[k];
        this.im[N - k] = -this.im[k];
      }
    }
    fft(this.re, this.im, true);

    this.output.copyWithin(0, HOP);
    this.output.fill(0, N - HOP);
    for (let i = 0; i < N; i += 1) {
      this.output[i] += (this.re[i] * hann[i]) / OVERLAP_GAIN;
    }

    // ── Усилитель ──────────────────────────────────────────────
    //
    // Считаем громкость уже очищенного куска. Речь — тянем к цели;
    // пауза — не трогаем расчёт вовсе, иначе усилитель за время
    // молчания «раскрутится» до предела и первое же слово прилетит
    // ударом.
    let sum = 0;
    for (let i = 0; i < HOP; i += 1) sum += this.output[i] * this.output[i];
    const rms = Math.sqrt(sum / HOP);

    if (this.amplify) {
      if (rms > SPEECH) {
        let want = TARGET / rms;
        if (want > MAX_BOOST) want = MAX_BOOST;
        if (want < 1) want = 1;
        // Тянемся к нужному значению плавно и с разной скоростью
        // вверх и вниз — см. UP и DOWN.
        const k = want > this.boost ? UP : DOWN;
        this.boost = k * this.boost + (1 - k) * want;
      }

      if (this.boost !== 1) {
        for (let i = 0; i < HOP; i += 1) this.output[i] *= this.boost;
      }
    } else {
      this.boost = 1;
    }

    output.set(this.output.subarray(0, HOP));
    return true;
  }
}

registerProcessor("denoise", Denoise);
