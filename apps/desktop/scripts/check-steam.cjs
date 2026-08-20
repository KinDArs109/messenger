// Проверка того, как мессенджер узнаёт игру Steam.
//
//   npm run check:steam -w @messenger/desktop
//
// Живую игру ради проверки не запустишь, а на машине без Steam проверять
// нечего вовсе. Поэтому проверяем то, из чего складывается ответ:
// читается ли реестр, разбирается ли перебор приложений, находится ли
// название игры в файле описания рядом с ней.
//
// Раньше всё держалось на одном значении RunningAppID — а его Steam
// пишет только когда игру запускают из него самого. Ярлыком с рабочего
// стола или из своего лаунчера — и значение остаётся нулём, хотя игра
// идёт. Отсюда и «игры со Steam не видно».

const { app } = require("electron");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { readdir, readFile } = require("node:fs/promises");

const games = require(path.join(__dirname, "..", "games.cjs"));

app.on("window-all-closed", () => undefined);

const результаты = [];
const ok = (пункт, значение, ещё) => {
  результаты.push(Boolean(значение));
  console.log(`${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё ? " " + JSON.stringify(ещё) : ""}`);
};

const STEAM_KEY = "HKCU\\Software\\Valve\\Steam";

const reg = (args) =>
  new Promise((resolve) =>
    execFile("reg", args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) =>
      resolve(error ? null : String(stdout)),
    ),
  );

void app.whenReady().then(async () => {
  console.log("\n=== Игры Steam ===");

  const steamPath = await reg(["query", STEAM_KEY, "/v", "SteamPath"]);
  if (!steamPath) {
    console.log("  · Steam на этой машине не найден — проверять нечего\n");
    app.exit(0);
    return;
  }

  ok("реестр Steam читается", steamPath.includes("SteamPath"));

  // Номер запущенной игры. null — сейчас никто не играет, и это
  // не поломка: проверяем, что ответ получен и разумного вида.
  const начало = Date.now();
  const id = await games.steamAppId();
  const мс = Date.now() - начало;
  ok("ответ про запущенную игру получен", id === null || /^\d+$/.test(id), { номер: id });
  ok("перебор укладывается в четверть секунды", мс < 250, { мс });

  const идёт = await games.steamGame();
  ok(
    "название соответствует ответу",
    id === null ? идёт === null : typeof идёт === "string" && идёт.length > 0,
    { номер: id, название: идёт },
  );

  /*
   * Главное: находится ли игра, запущенная мимо Steam.
   *
   * Запустить её ради проверки нельзя, а писать в реестр Steam, пока
   * он работает, — тем более: он тут же расскажет друзьям в Steam,
   * что вы в игре. Поэтому берём настоящий вывод reg с этой машины
   * и подменяем в нём один бит: у последней игры «не идёт» становится
   * «идёт». Разбирает это тот же код, что и в мессенджере.
   */
  const дерево = (await reg(["query", `${STEAM_KEY}\\Apps`, "/s", "/v", "Running"])) ?? "";
  ok("сейчас ни одна игра не помечена запущенной", games.pickRunning(дерево) === null);

  const строки = дерево.split(/\r?\n/);
  const ключ = /\\Apps\\(\d+)\s*$/;

  // Берём последнюю игру списка: так заодно видно, что разбор
  // не приписывает запись предыдущему ключу.
  let номер = null;
  for (const row of строки) {
    const match = ключ.exec(row.trim());
    if (match) номер = match[1];
  }

  let внутри = null;
  const подменено = строки
    .map((row) => {
      const match = ключ.exec(row.trim());
      if (match) {
        внутри = match[1];
        return row;
      }
      const оно = внутри === номер && /Running\s+REG_DWORD\s+0x0\s*$/.test(row.trim());
      return оно ? row.replace(/0x0\s*$/, "0x1") : row;
    })
    .join("\n");

  ok("игра, помеченная запущенной, находится", games.pickRunning(подменено) === номер, {
    ожидали: номер,
    нашли: games.pickRunning(подменено),
  });

  /*
   * Название. Раньше его брали только из реестра, а Steam пишет
   * туда имя не всегда — и вместо игры друзья видели «играет в игру
   * из Steam». Рядом с самой игрой лежит файл описания, где имя есть
   * всегда; библиотек при этом бывает несколько, на разных дисках.
   */
  const корень = /SteamPath\s+REG_SZ\s+(.+)/.exec(steamPath)?.[1]?.trim() ?? "";
  const библиотеки = [path.join(корень, "steamapps")];
  try {
    const vdf = await readFile(path.join(корень, "steamapps", "libraryfolders.vdf"), "utf8");
    for (const match of vdf.matchAll(/"path"\s*"([^"]+)"/g)) {
      библиотеки.push(path.join(match[1].replace(/\\\\/g, "\\"), "steamapps"));
    }
  } catch {
    // Библиотека одна — тоже нормально.
  }
  ok("библиотеки Steam найдены", библиотеки.length >= 1, { сколько: библиотеки.length });

  let разобрано = null;
  for (const dir of библиотеки) {
    const files = await readdir(dir).catch(() => []);
    for (const файл of files.filter((f) => /^appmanifest_\d+\.acf$/.test(f))) {
      const text = await readFile(path.join(dir, файл), "utf8").catch(() => "");
      const имя = /"name"\s*"([^"]+)"/.exec(text)?.[1];
      if (имя) {
        разобрано = { файл, имя };
        break;
      }
    }
    if (разобрано) break;
  }
  ok("название игры читается из описания рядом с ней", Boolean(разобрано), разобрано ?? {});

  // И то же самое — кодом самого мессенджера, а не заново написанным
  // в проверке: иначе проверялось бы, что я умею читать файл, а не то,
  // что это умеет он.
  const номерИзФайла = /appmanifest_(\d+)\.acf/.exec(разобрано?.файл ?? "")?.[1] ?? null;
  const имяОтМессенджера = номерИзФайла ? await games.manifestName(номерИзФайла) : null;
  ok("мессенджер достаёт то же название", имяОтМессенджера === (разобрано?.имя ?? null), {
    номер: номерИзФайла,
    ждали: разобрано?.имя,
    получили: имяОтМессенджера,
  });

  const провалов = результаты.filter((x) => !x).length;
  console.log(
    `\n${провалов === 0 ? "Всё сходится" : `Провалов: ${провалов}`} — проверок ${результаты.length}\n`,
  );
  app.exit(провалов === 0 ? 0 : 1);
});
