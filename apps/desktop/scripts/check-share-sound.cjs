// Сквозная проверка: звук показа доходит до собеседника.
//
//   npm run check:share-sound -w @messenger/desktop
//
// Нужен поднятый мессенджер: npm run dev (сервер, база и клиент).
//
// Не пробирка: два окна настоящего мессенджера, вход, голосовой канал,
// кнопка «Экран». Дальше всё идёт своим ходом — гаситель эха, раздача,
// подписка на той стороне, — и в конце меряется то единственное, что
// важно человеку: слышно ли.
//
// И когда слышно. Звук чужого показа не должен начинаться сам: человек
// зашёл в разговор, а у него заиграла чужая игра — так было, и так
// быть не должно. Здесь проверяется оба края: до нажатия «Смотреть»
// тишина, после — звук.
//
// Меряется на выходе общего усилителя второго окна, то есть ровно там,
// откуда звук уходит в наушники. Тон показа взят на 1500 Гц: у окон
// работают поддельные микрофоны Chromium, а те попискивают на 440 Гц,
// и без разделения по частоте проверка радовалась бы чужому писку.
//
// Что до экрана: показывать проверке нечего и незачем — вместо картинки
// холст, вместо звука игры тон. Подменён только источник (в подпорке
// share-preload.cjs), всё остальное — свой путь мессенджера.
//
// Именно этой проверки не хватало, когда звук показа пропал: картинка
// доходила, а звук молча оставался ни к чему не подключённым.

const { app, BrowserWindow, session } = require("electron");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const АДРЕС = process.env.CHECK_URL ?? "http://127.0.0.1:5173";
const КОРЕНЬ = path.join(__dirname, "..", "..", "..");

app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const скажи = (строка) => process.stdout.write(`${строка}\n`);
const пауза = (мс) => new Promise((готово) => setTimeout(готово, мс));

const итоги = [];
const шаг = (что, вышло, ещё) => {
  итоги.push({ что, вышло: Boolean(вышло) });
  скажи(`${вышло ? "  ✔" : "  ✘ ПРОВАЛ"} ${что}${ещё === undefined ? "" : ` (${ещё})`}`);
};

const сторож = setTimeout(() => {
  скажи("\n  ПРОВАЛ: не уложились в четыре минуты\n");
  прибрать();
  app.exit(1);
}, 240_000);
сторож.unref?.();

function фикстура(что) {
  const вывод = execFileSync(
    process.execPath,
    [
      path.join(КОРЕНЬ, "node_modules", "tsx", "dist", "cli.mjs"),
      "--env-file=apps/server/.env",
      "apps/server/scripts/sfu-fixture.ts",
      что,
    ],
    {
      cwd: КОРЕНЬ,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    },
  );
  return JSON.parse(вывод.trim().split("\n").pop());
}

function прибрать() {
  try {
    фикстура("clean");
  } catch {
    // Прибирать нечего или база уже недоступна — не повод падать
    // на выходе.
  }
}

/** Дождаться, пока условие в окне станет правдой. */
async function дождаться(win, выражение, сколько = 30_000) {
  const до = Date.now() + сколько;
  while (Date.now() < до) {
    const вышло = await win.webContents.executeJavaScript(
      `(() => { try { return ${выражение} } catch { return false } })()`,
      true,
    );
    if (вышло) return true;
    await пауза(500);
  }
  return false;
}

/** Войти и открыть голосовой канал в отдельном окне. */
async function окно(логин, данные, номер) {
  // Свой сеанс на окно: иначе вход одного затирает вход другого,
  // а поддельную камеру они начинают делить между собой.
  const отдельный = session.fromPartition(`звук-показа-${номер}`);
  отдельный.setPermissionRequestHandler((_wc, _право, ответ) => ответ(true));

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      session: отдельный,
      backgroundThrottling: false,
      preload: path.join(__dirname, "share-preload.cjs"),
      contextIsolation: false,
      sandbox: false,
    },
  });

  await win.loadURL(АДРЕС);

  const вошли = await win.webContents.executeJavaScript(
    `(async () => {
      const первый = await fetch("/api/auth/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ login: ${JSON.stringify(логин)}, password: ${JSON.stringify(данные.пароль)} }),
      }).then((о) => о.json());
      if (!первый.ticket) return Boolean(первый.accessToken);
      const второй = await fetch("/api/auth/login/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ticket: первый.ticket, code: ${JSON.stringify(данные.код)} }),
      });
      return второй.ok;
    })()`,
    true,
  );
  if (!вошли) throw new Error(`не вышло войти как ${логин}`);

  await win.loadURL(АДРЕС);
  await пауза(2500);

  const открыли = await дождаться(
    win,
    `(() => {
      const s = window.__store;
      if (!s) return false;
      const сервер = s.getState().servers.find((x) => x.name.startsWith("sfucheck"));
      if (!сервер) return false;
      s.getState().selectServer(сервер.id);
      return true;
    })()`,
    30_000,
  );
  if (!открыли) throw new Error(`${логин}: сервер проверки не появился в списке`);

  const вошлиВКанал = await дождаться(
    win,
    `(() => {
      const канал = [...document.querySelectorAll("button")].find(
        (к) => к.innerText.trim().startsWith("Разговор"),
      );
      if (!канал) return false;
      канал.click();
      return true;
    })()`,
    30_000,
  );
  if (!вошлиВКанал) throw new Error(`${логин}: не нашлась кнопка голосового канала`);

  return win;
}

/**
 * Поставить измеритель на выход общего усилителя.
 *
 * Туда сходится всё, что человек слышит, — и голоса, и звук показа.
 * Меряем не громкость вообще, а долю на частоте тона: у окон работают
 * поддельные микрофоны, они попискивают, и «стало громче» само по себе
 * ничего не доказывало бы.
 *
 * Измеритель приходится вести к выходу через глушитель: узел, из
 * которого никуда не идёт провод, браузер вправе не считать вовсе.
 */
const ПОСТАВИТЬ_МЕРУ = `(() => {
  const v = window.__voice;
  if (!v?.context || !v?.master) return false;
  if (window.__мера) return true;
  const мера = v.context.createAnalyser();
  мера.fftSize = 8192;
  // Без сглаживания: по умолчанию измеритель усредняет свои показания
  // с прошлыми, и после того, как звук убавили, он ещё секунду
  // показывает прежнюю громкость. Проверке нужно «что сейчас».
  мера.smoothingTimeConstant = 0;
  const глушитель = v.context.createGain();
  глушитель.gain.value = 0;
  v.master.connect(мера);
  мера.connect(глушитель).connect(v.context.destination);
  window.__мера = мера;
  return true;
})()`;

/** Сколько децибел на этой частоте — наибольшее за отрезок. */
const ТОН = (частота, мс) => `(async () => {
  const мера = window.__мера;
  if (!мера) return -200;
  const ctx = window.__voice.context;
  const данные = new Float32Array(мера.frequencyBinCount);
  const бин = Math.round(${частота} / (ctx.sampleRate / мера.fftSize));
  let громче = -200;
  const до = performance.now() + ${мс};
  while (performance.now() < до) {
    мера.getFloatFrequencyData(данные);
    for (let i = бин - 1; i <= бин + 1; i += 1) громче = Math.max(громче, данные[i] ?? -200);
    await new Promise((r) => setTimeout(r, 30));
  }
  return Math.round(громче);
})()`;

void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _право, ответ) => ответ(true));

  скажи("\nЗвук показа доходит до собеседника\n");

  let данные;
  try {
    данные = фикстура("create");
  } catch (беда) {
    скажи(`  ✘ ПРОВАЛ: не удалось завести людей — ${беда.message.slice(0, 200)}`);
    app.exit(1);
    return;
  }

  const окна = [];
  try {
    let номер = 0;
    for (const логин of данные.логины.slice(0, 2)) {
      номер += 1;
      окна.push(await окно(логин, данные, номер));
      await пауза(1500);
    }

    const [показывает, слушает] = окна;

    const вдвоём = await дождаться(
      показывает,
      `window.__store.getState().voiceMembers.get(window.__store.getState().voiceChannelId)?.size >= 2`,
      40_000,
    );
    шаг("оба в одном разговоре", вдвоём);
    if (!вдвоём) throw new Error("не собрались");

    // Измеритель ставим до показа: тишина на частоте тона — та самая
    // отправная точка, без которой «слышно» ничего не значит.
    const мера = await дождаться(слушает, ПОСТАВИТЬ_МЕРУ, 20_000);
    шаг("измеритель встал на выход наушников", мера);

    const доПоказа = await слушает.webContents.executeJavaScript(ТОН(1500, 1200), true);
    // Порог с запасом: на пустой полосе измеритель показывает около
    // −78 дБ (свой шум разложения и хвосты чужого писка), а пришедший
    // тон — около −14. Между ними шесть десятков децибел, и придираться
    // к последним трём значит завести проверку, которая падает сама
    // по себе.
    шаг("до показа на частоте тона тихо", доПоказа < -60, `${доПоказа} дБ`);

    const нажали = await дождаться(
      показывает,
      `(() => {
        const кнопка = [...document.querySelectorAll("button")].find(
          (к) => к.innerText.trim() === "Экран",
        );
        if (!кнопка) return false;
        кнопка.click();
        return true;
      })()`,
      30_000,
    );
    шаг("кнопка показа нашлась", нажали);

    const пошёл = await дождаться(
      показывает,
      `window.__store.getState().voiceSharing === true`,
      30_000,
    );
    шаг("показ включился", пошёл);

    const раздачей = await дождаться(
      показывает,
      `[...(window.__voice?.черезРаздачу ?? [])].includes("screen")`,
      30_000,
    );
    шаг("показ ушёл через раздачу, а не каждому свой", раздачей);

    const звукОтдан = await дождаться(
      показывает,
      `(() => {
        const п = window.__voice?.sfu?.producers;
        const звук = п?.get("screenAudio");
        return Boolean(звук) && !звук.closed;
      })()`,
      30_000,
    );
    шаг("звук показа тоже отдан", звукОтдан);

    const дошло = await дождаться(
      слушает,
      `window.__store.getState().voiceScreens.size > 0`,
      45_000,
    );
    шаг("показ дошёл до собеседника", дошло);

    const приехалЗвук = await дождаться(
      слушает,
      `(() => {
        const п = window.__store.getState().voiceScreens.values().next().value;
        return Boolean(п) && п.getAudioTracks().length > 0;
      })()`,
      45_000,
    );
    шаг("и звуковая дорожка вместе с ним", приехалЗвук);

    // Показ идёт, дорожка приехала — а согласия смотреть никто
    // не давал. В наушниках должно быть по-прежнему тихо.
    await пауза(2000);
    const безСогласия = await слушает.webContents.executeJavaScript(ТОН(1500, 2500), true);
    /*
     * Порог здесь абсолютный, и это не лень.
     *
     * Пустая полоса гуляет от замера к замеру (−107, −81, −72 дБ:
     * это шум разложения и хвосты соседних частот), а пришедший тон
     * стоит около −14. Мерить «насколько выше пустоты» значит
     * привязаться к самому шаткому из двух чисел; −55 дБ отстоит
     * от обоих на добрых сорок децибел, и спутать их нельзя.
     */
    шаг("без «Смотреть» звук не играет", безСогласия < -55, `${безСогласия} дБ`);

    const согласились = await дождаться(
      слушает,
      `(() => {
        const кнопка = [...document.querySelectorAll("button")].find(
          (к) => к.innerText.trim() === "Смотреть",
        );
        if (!кнопка) return false;
        кнопка.click();
        return true;
      })()`,
      30_000,
    );
    шаг("кнопка «Смотреть» нашлась", согласились);

    // Главное. Дорожка может приехать и остаться ни к чему
    // не подключённой — ровно это и было сломано.
    await пауза(1500);
    const послеПоказа = await слушает.webContents.executeJavaScript(ТОН(1500, 2500), true);
    шаг(
      "после «Смотреть» звук слышно",
      послеПоказа > безСогласия + 25,
      `${безСогласия} → ${послеПоказа} дБ`,
    );

    // Ползунок громкости показа: он появляется только при живом звуке,
    // и раньше не появлялся вовсе — потому что о приехавшей дорожке
    // разметке никто не говорил.
    const ползунокЕсть = await дождаться(
      слушает,
      `Boolean(document.querySelector('[aria-label="Громкость показа"]'))`,
      15_000,
    );
    шаг("ползунок громкости показа на месте", ползунокЕсть);

    // И он работает: убавили до нуля — стало тихо.
    //
    // Значок сперва, ползунок потом: сам ползунок появляется только
    // после нажатия по значку, и React рисует его не в тот же миг.
    await слушает.webContents.executeJavaScript(
      `(() => {
        const значок = document.querySelector('[aria-label="Громкость показа"]');
        if (значок) значок.click();
        return Boolean(значок);
      })()`,
      true,
    );
    const убавили = await дождаться(
      слушает,
      `(() => {
        const ползунок = document.querySelector('input[type="range"][aria-label^="Громкость показа"]');
        if (!ползунок) return false;
        // Через родной установщик: React слушает своё событие, а прямое
        // присвоение value он не замечает.
        const задать = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        задать.call(ползунок, "0");
        ползунок.dispatchEvent(new Event("input", { bubbles: true }));
        ползунок.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      })()`,
      15_000,
    );
    шаг("ползунок нашёлся и сдвинулся", убавили);
    await пауза(1800);
    const наНуле = await слушает.webContents.executeJavaScript(ТОН(1500, 2000), true);
    // Заодно спрашиваем, что в настройках: провал «стало не тише»
    // означает разное, смотря сдвинулась ли сама громкость.
    const вНастройках = await слушает.webContents.executeJavaScript(
      `(() => {
        const п = JSON.parse(localStorage.getItem("messenger:prefs") ?? "{}");
        return JSON.stringify(п.screenGain ?? null);
      })()`,
      true,
    );
    шаг("и убавляет до тишины", наНуле < -55, `${наНуле} дБ, в настройках ${вНастройках}`);
  } catch (беда) {
    шаг(`проверка сорвалась: ${беда.message.slice(0, 120)}`, false);
  } finally {
    for (const win of окна) win.destroy();
    прибрать();
  }

  const провалов = итоги.filter((и) => !и.вышло).length;
  скажи(
    провалов === 0
      ? `\nЗвук показа доходит до собеседника — проверок ${итоги.length}\n`
      : `\nПровалов: ${провалов} из ${итоги.length}\n`,
  );
  app.exit(провалов === 0 ? 0 : 1);
});
