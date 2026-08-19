// Запущена ли игра.
//
// Отдельным файлом от main.cjs по одной причине: это единственная
// часть оверлея, которую можно проверить без окон, разговора и учётной
// записи — а значит, её нужно уметь проверять. Внутри main.cjs она
// была бы заперта вместе со всем приложением.
//
// Честно определить «идёт игра» нельзя: в игру мы не встраиваемся,
// а спросить у Windows негде — она сама этого не знает. Поэтому
// спрашиваем у человека, какие у него игры, и просто смотрим, запущено
// ли что-то из названного. Скучно, зато не врёт и работает с любой
// игрой, включая ту, о которой никто не слышал.

const { execFile } = require("node:child_process");

/** Что сейчас запущено: имя и занятая память в килобайтах.
 *
 *  Через tasklist, а не через PowerShell: тот запускается полсекунды,
 *  а этот мгновенно — а звать его приходится раз в пять секунд. */
function runningProcesses() {
  return new Promise((resolve) => {
    execFile(
      "tasklist",
      ["/fo", "csv", "/nh"],
      { windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => {
        if (error) return resolve([]);
        const rows = [];
        for (const line of stdout.split(/\r?\n/)) {
          // "имя.exe","1234","Console","1","123 456 КБ"
          const parts = line.match(/"([^"]*)"/g);
          if (!parts || parts.length < 5) continue;
          const name = parts[0].slice(1, -1);
          const memory = Number(parts[4].slice(1, -1).replace(/\D/g, "")) || 0;
          rows.push({ name, memory });
        }
        resolve(rows);
      },
    );
  });
}

/** Есть ли среди запущенного что-то из списка. Регистр не важен:
 *  человек выбирает имя из списка, но в настройках оно могло остаться
 *  от прошлого раза и в другом виде. */
function anyRunning(wanted, running) {
  const set = new Set(running.map((row) => row.name.toLowerCase()));
  return wanted.some((name) => set.has(String(name).toLowerCase()));
}

/** Служебное, чему в списке выбора делать нечего: полторы сотни служб
 *  Windows, среди которых игру не найти. */
const SYSTEM =
  /^(svchost|system|registry|smss|csrss|wininit|winlogon|services|lsass|fontdrvhost|dwm|ctfmon|sihost|taskhostw|runtimebroker|searchhost|startmenuexperiencehost|shellexperiencehost|explorer|conhost|dllhost|audiodg|spoolsv|wmiprvse|msmpeng|securityhealth|textinputhost|widgets|phoneexperiencehost|useroobebroker|applicationframehost|backgroundtask|memory compression|idle)/i;

/** Что показать человеку в настройках. Игра — обычно самое тяжёлое,
 *  что есть на машине, поэтому сортируем по памяти; одинаковые имена
 *  схлопываем в самое тяжёлое из них: одна программа — это десяток
 *  процессов, а выбирают её один раз. */
function pickable(running, limit = 30) {
  const best = new Map();
  for (const row of running) {
    if (SYSTEM.test(row.name)) continue;
    if (!/\.exe$/i.test(row.name)) continue;
    const seen = best.get(row.name.toLowerCase());
    if (!seen || seen.memory < row.memory) best.set(row.name.toLowerCase(), row);
  }
  return [...best.values()].sort((a, b) => b.memory - a.memory).slice(0, limit);
}

/**
 * Заголовки окон: имя процесса → то, как программа называет себя сама.
 *
 * Нужно, чтобы друзья видели «играет в Rust», а не «играет
 * в RustClient». Другого источника человеческого названия у нас нет,
 * и этот самый честный.
 *
 * Через PowerShell, а не через tasklist: тот заголовков не знает.
 * Полсекунды на запуск здесь не жалко — спрашивают это один раз,
 * когда человек открыл список и выбирает игру, а не по таймеру.
 */
function windowTitles() {
  return new Promise((resolve) => {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.ProcessName + '|' + $_.MainWindowTitle }",
      ],
      { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout) => {
        const titles = new Map();
        if (error) return resolve(titles);
        for (const line of String(stdout).split(/\r?\n/)) {
          const at = line.indexOf("|");
          if (at < 1) continue;
          const process = line.slice(0, at).trim().toLowerCase();
          const title = line.slice(at + 1).trim();
          // Первое окно программы, а не последнее: у игр их бывает
          // несколько, и главное обычно открывается первым.
          if (process && title && !titles.has(process)) titles.set(process, title);
        }
        resolve(titles);
      },
    );
  });
}

/**
 * Есть ли у программы открытое окно.
 *
 * Мало того, что игра запущена: Roblox, Steam, лаунчеры и половина игр
 * остаются висеть в трее после выхода. Процесс есть, памяти занято
 * полтораста мегабайт, а человек не играет — и друзья читают, что
 * играет, потому что он однажды зашёл и вышел.
 *
 * Разница видна по окну: у свёрнутого в трей окна нет вовсе, у идущей
 * игры оно есть всегда — даже в полноэкранном режиме, даже свёрнутое
 * в панель задач. Windows отвечает на этот вопрос честно и сразу.
 *
 * Отдельно от списка процессов, потому что стоит дороже: пол секунды
 * против мгновенного tasklist. Зато спрашивается только тогда, когда
 * кандидат уже нашёлся, — то есть почти никогда.
 */
async function hasWindow(name) {
  const titles = await windowTitles();
  return titles.has(String(name).replace(/\.exe$/i, "").toLowerCase());
}

/* ── Steam ────────────────────────────────────────────────────────
 *
 * Со Steam гадать не нужно вовсе: он сам записывает, что запустил,
 * и сам стирает запись, когда игра закрылась. Там же лежит и название —
 * настоящее, а не имя файла.
 *
 * Это лучше любого списка: список знает полторы сотни игр, а Steam
 * знает все, включая ту, которая вышла вчера. Поэтому спрашиваем
 * сначала его, и только потом смотрим на процессы.
 */

/** Одно значение из реестра. Через reg, а не PowerShell: тот
 *  запускается полсекунды, этот — мгновенно. */
function regValue(key, name) {
  return new Promise((resolve) => {
    execFile("reg", ["query", key, "/v", name], { windowsHide: true }, (error, stdout) => {
      if (error) return resolve(null);
      // Строка вида:  RunningAppID    REG_DWORD    0x0
      const line = String(stdout)
        .split(/\r?\n/)
        .find((row) => row.trim().toLowerCase().startsWith(name.toLowerCase()));
      if (!line) return resolve(null);
      const parts = line.trim().split(/\s{2,}/);
      const type = parts[1];
      const value = parts.slice(2).join(" ").trim();
      if (!value) return resolve(null);
      resolve(type === "REG_DWORD" ? String(parseInt(value, 16)) : value);
    });
  });
}

const STEAM_KEY = "HKCU\\Software\\Valve\\Steam";
/** Названия по номеру игры: они не меняются, а спрашивать реестр
 *  каждые несколько секунд ради одной и той же строки незачем. */
const steamNames = new Map();

/** Во что играют в Steam прямо сейчас. null — ни во что, Steam
 *  не установлен или запись недоступна. */
async function steamGame() {
  const id = await regValue(STEAM_KEY, "RunningAppID");
  if (!id || id === "0") return null;

  if (steamNames.has(id)) return steamNames.get(id);

  const name = await regValue(`${STEAM_KEY}\\Apps\\${id}`, "Name");
  // Без названия игра всё равно идёт — покажем хотя бы это. Молчать
  // только потому, что Steam не дописал строку, глупо.
  const shown = name || "игру из Steam";
  steamNames.set(id, shown);
  return shown;
}

module.exports = {
  runningProcesses,
  anyRunning,
  pickable,
  windowTitles,
  hasWindow,
  steamGame,
};
