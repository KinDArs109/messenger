// Сквозная проверка раздачи: показ уходит один раз, доходит до всех.
//
//   npm run check:sfu -w @messenger/desktop
//
// Нужен поднятый мессенджер: npm run dev (сервер, база и клиент).
//
// Это не разговор двух половин библиотеки в пробирке, а настоящий
// разговор втроём: три окна настоящего мессенджера, вход, голосовой
// канал, включённая камера. Проверяется то, ради чего всё делалось:
//
//   1. картинка доходит до обоих собеседников;
//   2. и уходит при этом ОДИН раз, а не каждому свой поток.
//
// Второе — главное. Первое работало и раньше; вопрос был в цене.
//
// Камера, а не экран, намеренно: Chromium умеет подсунуть поддельную
// камеру с движущейся картинкой, и проверка не зависит ни от того,
// что сейчас на экране у человека, ни от того, есть ли этот экран
// вообще. Дорога у камеры и у экрана одна и та же.

const { app, BrowserWindow, session } = require("electron");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const АДРЕС = process.env.CHECK_URL ?? "http://127.0.0.1:5173";
const КОРЕНЬ = path.join(__dirname, "..", "..", "..");

// Поддельные камера и микрофон: настоящих в проверке нет, а без них
// в разговор не войти.
app.commandLine.appendSwitch("use-fake-device-for-media-stream");
app.commandLine.appendSwitch("use-fake-ui-for-media-stream");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const скажи = (строка) => process.stdout.write(`${строка}\n`);

const итоги = [];
const шаг = (что, вышло, ещё) => {
  итоги.push({ что, вышло: Boolean(вышло), ещё });
  скажи(`${вышло ? "  ✔" : "  ✘ ПРОВАЛ"} ${что}${ещё === undefined ? "" : ` (${ещё})`}`);
};

const сторож = setTimeout(() => {
  скажи("\n  ПРОВАЛ: не уложились в три минуты\n");
  прибрать();
  app.exit(1);
}, 180_000);
сторож.unref?.();

function фикстура(что) {
  // Зовём tsx напрямую через node: обёртки .cmd на Windows
  // без оболочки не запускаются, а оболочка тут только мешает.
  const вывод = execFileSync(
    process.execPath,
    [
      path.join(КОРЕНЬ, "node_modules", "tsx", "dist", "cli.mjs"),
      "--env-file=apps/server/.env",
      "apps/server/scripts/sfu-fixture.ts",
      что,
    ],
    { cwd: КОРЕНЬ, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
  );
  const строка = вывод.trim().split("\n").pop();
  return JSON.parse(строка);
}

function прибрать() {
  try {
    фикстура("clean");
  } catch {
    // Прибирать нечего или база уже недоступна — не повод падать
    // на выходе.
  }
}

/** Войти и открыть голосовой канал в отдельном окне. */
async function окно(логин, данные, номер) {
  /*
   * Свой сеанс на окно, и это не мелочь.
   *
   * Три окна — три разных человека, а сеанс у окон по умолчанию общий:
   * общие куки (вход одного затирал бы вход другого) и общая поддельная
   * камера, которую они начинали делить между собой — дорожка у первого
   * обрывалась через секунду, и проверка врала про раздачу, хотя
   * виновата была сама.
   */
  const отдельный = session.fromPartition(`sfu-проверка-${номер}`);
  отдельный.setPermissionRequestHandler((_wc, _право, ответ) => ответ(true));

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 800,
    webPreferences: {
      session: отдельный,
      backgroundThrottling: false,
      // Счётчик соединений должен встать раньше мессенджера — значит,
      // только preload и только в общем мире со страницей.
      preload: path.join(__dirname, "sfu-preload.cjs"),
      contextIsolation: false,
      sandbox: false,
    },
  });

  await win.loadURL(АДРЕС);

  // Вход: пароль, потом код — тот самый, что положен в базу.
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

  // Открываем сервер и входим в голосовой канал — как человек.
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

  const вошли2 = await дождаться(
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
  if (!вошли2) throw new Error(`${логин}: не нашлась кнопка голосового канала`);

  return win;
}

const пауза = (мс) => new Promise((готово) => setTimeout(готово, мс));

/**
 * Сколько кадров декодировалось за три секунды.
 *
 * Спрашиваем у самого соединения, а не у проигрывателя: окна проверки
 * скрыты, а скрытому окну браузер вправе не рисовать ничего. Кадры
 * при этом идут и декодируются — и именно это надо знать.
 */
async function кадровПрибыло(win) {
  const снять = () =>
    win.webContents.executeJavaScript(
      `(async () => {
        let кадров = 0;
        for (const соединение of window.__соединения ?? []) {
          const записи = await соединение.getStats();
          записи.forEach((з) => {
            if (з.type === "inbound-rtp" && з.kind === "video") {
              кадров = Math.max(кадров, з.framesDecoded ?? 0);
            }
          });
        }
        return кадров;
      })()`,
      true,
    );

  const до = await снять();
  await пауза(3000);
  return (await снять()) - до;
}

/** Дождаться, пока условие в окне станет правдой. */
async function дождаться(win, выражение, сколько = 30_000) {
  const до = Date.now() + сколько;
  while (Date.now() < до) {
    const вышло = await win.webContents.executeJavaScript(`(() => { try { return ${выражение} } catch { return false } })()`, true);
    if (вышло) return true;
    await пауза(500);
  }
  return false;
}

/** Что видно в самих соединениях. Когда кадров нет, вопрос всегда
 *  один: дошли ли пакеты и договорились ли стороны вообще. */
async function подробности(win) {
  try {
    return await win.webContents.executeJavaScript(
      `(async () => {
        const строки = [];
        for (const с of window.__соединения ?? []) {
          const записи = await с.getStats();
          записи.forEach((з) => {
            if (з.type === "inbound-rtp" && з.kind === "video") {
              строки.push("пакетов:" + (з.packetsReceived ?? 0) + " байт:" + (з.bytesReceived ?? 0));
            }
            if (з.type === "transport" && з.dtlsState) {
              строки.push("dtls:" + з.dtlsState + " ice:" + (з.iceState ?? "?"));
            }
          });
        }
        return строки.join(" | ") || "ни одной записи";
      })()`,
      true,
    );
  } catch (беда) {
    return "не спросить: " + беда.message;
  }
}

/** Что разговор думает о своём показе: каким путём он ушёл
 *  и жива ли дорожка. */
async function показРазговора(win) {
  try {
    return await win.webContents.executeJavaScript(
      `(() => {
        const v = window.__voice;
        if (!v) return "разговора нет";
        const через = [...(v.черезРаздачу ?? [])];
        const producers = v.sfu ? [...v.sfu.producers.entries()] : [];
        const доля = producers.map(([что, п]) => что + ":" + (п.closed ? "закрыт" : "жив") + ",пауза:" + п.paused + ",дорожка:" + (п.track ? п.track.readyState + "/" + п.track.enabled : "нет"));
        const своя = v.shares?.video?.stream?.getVideoTracks?.()[0];
        return "путь:" + (через.join(",") || "мимо раздачи") + " | потоки:" + (доля.join(" ") || "нет") + " | своя дорожка:" + (своя ? своя.readyState + "/" + своя.enabled : "нет");
      })()`,
      true,
    );
  } catch (беда) {
    return "не спросить: " + беда.message;
  }
}

/** Что происходит у отправителя: шлёт ли он и во что упирается. */
async function отдача(win) {
  const снять = () =>
    win.webContents.executeJavaScript(
      `(async () => {
        const строки = [];
        for (const с of window.__соединения ?? []) {
          const записи = await с.getStats();
          записи.forEach((з) => {
            if (з.type === "outbound-rtp" && з.kind === "video") {
              строки.push("байт:" + (з.bytesSent ?? 0) + " кадров:" + (з.framesEncoded ?? 0) + " предел:" + (з.qualityLimitationReason ?? "-") + " цель:" + (з.targetBitrate ?? 0));
            }
          });
        }
        return строки.join(" | ") || "ничего не отдаёт";
      })()`,
      true,
    );
  const до = await снять();
  await пауза(2000);
  const после = await снять();
  return `было[${до}] стало[${после}]`;
}

/** Коротко о том, где сейчас окно: чтобы провал что-то объяснял. */
async function состояние(win) {
  try {
    return await win.webContents.executeJavaScript(
      `(() => {
        const s = window.__store.getState();
        return [
          "канал:" + (s.voiceChannelId ? "да" : "нет"),
          "показов:" + s.voiceVideos.size,
          "раздача:" + (window.__voice?.sfu ? "есть" : "нет"),
        ].join(" ");
      })()`,
      true,
    );
  } catch {
    return "не спросить";
  }
}

void app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_wc, _право, ответ) => ответ(true));

  скажи("\nРаздача: показ уходит один раз\n");

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
    for (const логин of данные.логины) {
      номер += 1;
      окна.push(await окно(логин, данные, номер));
      await пауза(1500);
    }

    const [а, б, в] = окна;

    // Все трое в разговоре.
    const втроём = await дождаться(
      а,
      `window.__store.getState().voiceMembers.get(window.__store.getState().voiceChannelId)?.size >= 3`,
      40_000,
    );
    шаг("трое в одном разговоре", втроём);
    if (!втроём) throw new Error("не собрались");

    // Первый включает камеру.
    const нажали = await дождаться(
      а,
      `(() => {
        const кнопка = [...document.querySelectorAll("button")].find(
          (к) => к.innerText.trim() === "Камера",
        );
        if (!кнопка) return false;
        кнопка.click();
        return true;
      })()`,
      30_000,
    );
    шаг("кнопка камеры нашлась", нажали);

    const своё = await дождаться(а, `window.__store.getState().voiceVideoOn === true`, 30_000);
    шаг("камера включилась", своё);

    // Дошло ли до остальных — и не просто дорожкой, а кадрами.
    for (const [имя, кто] of [
      ["второму", б],
      ["третьему", в],
    ]) {
      const дошло = await дождаться(
        кто,
        `window.__store.getState().voiceVideos.size > 0`,
        40_000,
      );
      шаг(`картинка дошла ${имя}`, дошло);

      if (!дошло) continue;

      const кадры = await кадровПрибыло(кто);
      шаг(
        `и это живые кадры, а не чёрный прямоугольник (${имя})`,
        кадры > 5,
        кадры > 5 ? `${кадры} кадров за 3 с` : `принял: ${await подробности(кто)} / отдал: ${await отдача(а)} / показ: ${await показРазговора(а)}`,
      );
    }

    /*
     * Главное. Сколько раз показывающий отправил картинку.
     *
     * Считаем исходящие видеопотоки во всех соединениях окна сразу.
     * Прежде их было бы два — по одному на собеседника; через раздачу
     * должен быть один, сколько бы народу ни смотрело.
     */
    const отправок = await а.webContents.executeJavaScript(
      `(async () => {
        let сколько = 0;
        for (const соединение of window.__соединения ?? []) {
          const записи = await соединение.getStats();
          записи.forEach((з) => {
            if (з.type === "outbound-rtp" && з.kind === "video") сколько += 1;
          });
        }
        return сколько;
      })()`,
      true,
    );
    шаг("картинка ушла один раз, а не каждому своя", отправок === 1, `${отправок} отправок`);

    /*
     * Вошедший позже показывающего.
     *
     * Его никто не зовёт: событие о новом потоке уже прошло, пока
     * его не было. Поэтому мессенджер спрашивает сам — «что сейчас
     * идёт» — и подписывается. Путь отдельный, ломается отдельно,
     * а выглядит одинаково: чёрный прямоугольник вместо чужой игры.
     */
    await в.webContents.executeJavaScript(
      `(() => {
        const кнопка = [...document.querySelectorAll("button")].find(
          (к) => (к.getAttribute("aria-label") ?? "") === "Выйти из разговора" ||
                 (к.getAttribute("title") ?? "") === "Выйти из разговора",
        );
        if (кнопка) кнопка.click();
        return true;
      })()`,
      true,
    );
    await пауза(2000);

    const вернулся = await дождаться(
      в,
      `(() => {
        const канал = [...document.querySelectorAll("button")].find(
          (к) => к.innerText.trim().startsWith("Разговор"),
        );
        if (!канал) return false;
        канал.click();
        return true;
      })()`,
      20_000,
    );
    шаг("третий вышел и зашёл заново", вернулся);

    const догнал = await дождаться(в, `window.__store.getState().voiceVideos.size > 0`, 45_000);
    const кадрыОпоздавшего = догнал ? await кадровПрибыло(в) : 0;
    шаг(
      "и сразу увидел уже идущий показ",
      догнал && кадрыОпоздавшего > 5,
      догнал ? `${кадрыОпоздавшего} кадров за 3 с` : await состояние(в),
    );

    // И голос при этом остался прямым — через раздачу он не идёт.
    const голосом = await а.webContents.executeJavaScript(
      `(async () => {
        let сколько = 0;
        for (const соединение of window.__соединения ?? []) {
          const записи = await соединение.getStats();
          записи.forEach((з) => {
            if (з.type === "outbound-rtp" && з.kind === "audio") сколько += 1;
          });
        }
        return сколько;
      })()`,
      true,
    );
    шаг("а голос по-прежнему идёт напрямую каждому", голосом >= 2, `${голосом} дорожек`);
  } catch (беда) {
    шаг(`проверка сорвалась: ${беда.message.slice(0, 120)}`, false);
  } finally {
    for (const win of окна) win.destroy();
    прибрать();
  }

  const провалов = итоги.filter((и) => !и.вышло).length;
  скажи(
    провалов === 0
      ? `\nПоказ уходит один раз и доходит до всех — проверок ${итоги.length}\n`
      : `\nПровалов: ${провалов} из ${итоги.length}\n`,
  );
  app.exit(провалов === 0 ? 0 : 1);
});
