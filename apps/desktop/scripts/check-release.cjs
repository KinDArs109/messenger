// Проверка выпуска: доедет ли обновление до друзей.
//
//   npm run check:release -w @messenger/desktop
//
// Смотрим на выпуск глазами уже установленного приложения: читаем
// объявление той же библиотекой, которой читает оно, сверяем контрольную
// сумму, заглядываем внутрь собранного установщика — на месте ли
// то новое, ради чего выпуск и делался.
//
// Ничего не устанавливаем и не качаем целиком: девяносто пять мегабайт
// ради проверки — это трафик друзей, а сумма проверяется и без них.

const { app } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const FEED = pkg.build.publish[0].url;
const RELEASE = path.join(root, "release");
const SITE = FEED.replace("/updates", "");

const results = [];
/** Пишем и на экран, и в файл. Electron на Windows придерживает свой
 *  вывод до самого выхода, и при зависании на экране не остаётся
 *  ничего — а по файлу видно, на каком именно шаге всё встало. */
const LOG = path.join(root, "release", "проверка-выпуска.txt");
const say = (line) => {
  console.log(line);
  try {
    fs.appendFileSync(LOG, line + "\n");
  } catch {
    // Каталога сборки может не быть вовсе — не повод падать.
  }
};
const ok = (пункт, значение, ещё) => {
  results.push({ пункт, ок: Boolean(значение) });
  say(`${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё ? " " + JSON.stringify(ещё) : ""}`);
};

/** Ждать вечно нельзя: сеть может не ответить, и проверка повиснет
 *  молча — так и случилось в первый раз. */
const срок = (обещание, мс, чем) =>
  Promise.race([обещание, new Promise((r) => setTimeout(() => r(чем), мс))]);

setTimeout(() => {
  say("\n  ✘ Проверка не уложилась в две минуты — где-то нет ответа.\n");
  app.exit(2);
}, 120_000).unref?.();

/** Что лежит внутри собранного приложения.
 *
 *  Установщик может собраться из чего угодно — например, из прошлой
 *  сборки, если она не пересобралась. Ищем в упакованном коде строки,
 *  которые появились ровно в этом выпуске: если их нет, выпуск пустой,
 *  и друзья скачают то же самое, что у них уже стоит. */
function insidePackage(needle) {
  const asar = path.join(RELEASE, "win-unpacked", "resources", "app.asar");
  // Electron считает .asar не файлом, а каталогом, и обычное чтение
  // такого пути обрывается «файл не найден» — причём молча, посреди
  // проверки. Просим на время читать по-честному, байтами.
  process.noAsar = true;
  try {
    if (!fs.existsSync(asar)) return null;
    return fs.readFileSync(asar).includes(needle);
  } finally {
    process.noAsar = false;
  }
}

/**
 * Есть ли в .exe вшитая подпись — и какого она размера.
 *
 * Читаем сам файл: у исполняемых файлов Windows подпись лежит отдельной
 * записью в оглавлении (каталог сертификатов, восьмая запись), и её
 * наличие видно без всякой проверки действительности. Проверять
 * действительность мы и не хотим: это поход в интернет за списками
 * отзыва, на самодельной подписи он висит минутами.
 */
function signatureSize(file) {
  const fd = fs.openSync(file, "r");
  try {
    const head = Buffer.alloc(1024);
    fs.readSync(fd, head, 0, 1024, 0);
    // e_lfanew — где начинается заголовок PE.
    const pe = head.readUInt32LE(0x3c);
    const block = Buffer.alloc(512);
    fs.readSync(fd, block, 0, 512, pe);
    if (block.toString("ascii", 0, 4) !== "PE\0\0") return 0;

    // Разрядность решает, где лежат каталоги данных: у 32-битных
    // заголовок короче на шестнадцать байт.
    const magic = block.readUInt16LE(24);
    const dirs = magic === 0x20b ? 24 + 112 : 24 + 96;
    const cert = dirs + 4 * 8; // восьмая запись — таблица сертификатов
    return block.readUInt32LE(cert + 4);
  } catch {
    return 0;
  } finally {
    fs.closeSync(fd);
  }
}

/** Запрос с ограничением по времени: без него зависшая сеть вешает
 *  всю проверку, и на экране не остаётся даже намёка, где это было. */
const достать = (url, options = {}) =>
  fetch(url, { ...options, signal: AbortSignal.timeout(20_000) }).catch(() => ({
    ok: false,
    status: 0,
    headers: new Headers(),
    text: async () => "",
  }));

void app
  .whenReady()
  .then(async () => {
    say("\n=== Выпуск оболочки ===");

  // 1. Объявление читаем той же библиотекой, что и приложение: свои
  //    разборы yaml тут бесполезны — важно, что поймёт electron-updater.
  const { autoUpdater } = require("electron-updater");
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.forceDevUpdateConfig = true;
  // Берём тот же файл, что лежит в собранном приложении, а не отладочный
  // рядом с исходниками. Отладочный однажды отстал от жизни — в нём
  // остался заброшенный GitHub, — и проверка бодро доложила про версию
  // полугодовой давности, найдя её совсем не там, куда ходит приложение.
  const packed = path.join(RELEASE, "win-unpacked", "resources", "app-update.yml");
  autoUpdater.updateConfigPath = fs.existsSync(packed)
    ? packed
    : path.join(root, "dev-app-update.yml");
  // Притворяемся прошлой версией — той, что стоит у друзей.
  autoUpdater.currentVersion = "0.0.1";
  autoUpdater.logger = null;

  let found = null;
  try {
    const result = await срок(autoUpdater.checkForUpdates(), 30_000, null);
    found = result?.updateInfo ?? null;
  } catch (error) {
    say(`    (проверка обновления сорвалась: ${String(error).slice(0, 120)})`);
  }

  ok("приложение видит новую версию", found?.version === pkg.version, {
    объявлено: found?.version ?? "нет",
    собрано: pkg.version,
  });

  // 2. Контрольная сумма. Ровно её приложение сверит после загрузки,
  //    и ровно на ней обновление молча ломается, если файл заменили
  //    мимо объявления.
  const setup = path.join(RELEASE, "Messenger-Setup.exe");
  const exists = fs.existsSync(setup);
  const sha = exists
    ? crypto.createHash("sha512").update(fs.readFileSync(setup)).digest("base64")
    : "";
  const declared = found?.files?.[0]?.sha512 ?? found?.sha512 ?? "";
  ok("сумма в объявлении совпадает с установщиком", Boolean(sha) && sha === declared, {
    размер: exists ? fs.statSync(setup).size : 0,
  });

  // 3. Файл на сервере — тот же самый. Целиком не качаем: хватит куска
  //    и длины, а сумму мы уже сверили с объявлением.
  const head = await достать(`${FEED}/Messenger-Setup.exe`, { method: "HEAD" });
  const size = Number(head.headers.get("content-length") ?? 0);
  ok("сервер отдаёт установщик целиком", head.ok && exists && size === fs.statSync(setup).size, {
    код: head.status,
    байт: size,
  });

  // Докачка кусками: без неё обновление качает все девяносто пять
  // мегабайт каждый раз, а с ней — только изменившееся.
  const part = await достать(`${FEED}/Messenger-Setup.exe`, { headers: { Range: "bytes=0-1023" } });
  ok("сервер умеет отдавать куски — докачка работает", part.status === 206);

  const map = await достать(`${FEED}/Messenger-Setup.exe.blockmap`, { method: "HEAD" });
  ok("карта блоков на месте", map.ok);

  // 4. Внутри установщика — то новое, ради чего выпуск и делался.
  ok("в сборке есть перезапуск по обновлению", insidePackage("app:restart") === true);
  ok("в сборке есть значок выключенного звука в оверлее", insidePackage("SOUND_OFF") === true);
  ok("в сборке есть системное время простоя", insidePackage("system:idle") === true);

    // 5. Подпись. Её нет и не было: сертификат подписи кода стоит
    //    десятки тысяч рублей в год, и в README это записано прямо.
    //    Поэтому не проверка, а напоминание — тому, кто ставит впервые,
    //    SmartScreen скажет «неизвестный издатель», и это ожидаемо.
    //    Обновлению уже установленного приложения подпись не нужна.
    //
    //    Смотрим сам файл, а не спрашиваем Windows: проверка подписи
    //    лезет в интернет за списками отозванных сертификатов и висит
    //    там минутами.
    say(
      signatureSize(setup) > 0
        ? "  · установщик подписан"
        : "  · установщик не подписан — при первой установке SmartScreen предупредит (так и задумано)",
    );

  say("\n=== Клиент на сервере ===");

  // Клиент едет отдельно от оболочки, и «выпуск» без него — половина
  // дела: друзья получат новое приложение со старым мессенджером внутри.
  const html = await достать(`${SITE}/app`, { cache: "no-store" }).then((r) =>
    r.ok ? r.text() : "",
  );
  const bundle = html.match(/index-[A-Za-z0-9_-]+\.js/)?.[0] ?? "";
  const code = bundle
    ? await достать(`${SITE}/assets/${bundle}`).then((r) =>
        r.ok ? r.text() : "",
      )
    : "";

  ok("сайт отдаёт собранный клиент", code.length > 100_000, { файл: bundle, байт: code.length });
  for (const [что, строка] of [
    ["красная кнопка прекращения просмотра", "Прекратить просмотр"],
    ["значок выключенного звука", "Звук выключен — не слышит"],
    ["перезапуск вместо перезагрузки", "app-desktop"],
  ]) {
    ok(`в выложенном клиенте есть ${что}`, code.includes(строка));
  }

    say("\n=== Телефон ===");

    // Приложение на телефоне — тот же сайт в своей оболочке: новый
    // клиент доезжает туда сам. Проверяем то, без чего оболочка
    // перестаёт быть приложением и снова становится вкладкой: подпись
    // связи сайта с приложением и манифест.
    const links = await достать(`${SITE}/.well-known/assetlinks.json`);
    const linksText = links.ok ? await links.text() : "";
    let fingerprints = 0;
    try {
      const parsed = JSON.parse(linksText);
      fingerprints = parsed?.[0]?.target?.sha256_cert_fingerprints?.length ?? 0;
    } catch {
      fingerprints = 0;
    }
    ok("сайт подтверждает приложение на телефоне", links.ok && fingerprints > 0, {
      отпечатков: fingerprints,
    });

    const manifest = await достать(`${SITE}/manifest.webmanifest`);
    ok("манифест на месте — ставится как приложение", manifest.ok, { код: manifest.status });

    const failed = results.filter((r) => !r.ок);
  say(
    `\n${failed.length === 0 ? "Выпуск полный" : `Провалов: ${failed.length}`} — проверок ${results.length}\n`,
  );
    app.exit(failed.length === 0 ? 0 : 1);
  })
  // Без этого любая осечка посреди проверки уходила в тишину: вывод
  // обрывался на полуслове, и выглядело это как зависание.
  .catch((error) => {
    say(`\n  ✘ Проверка сорвалась: ${String(error?.stack ?? error).slice(0, 400)}\n`);
    app.exit(2);
  });
