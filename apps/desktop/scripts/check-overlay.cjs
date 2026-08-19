// Полная проверка оверлея на живой машине.
//
//   npm run check:overlay -w @messenger/desktop
//
// Зачем. Окошко поверх игры и его меню появляются только во время
// разговора, а разговор — это учётная запись, микрофон и второй
// человек. Проверять из-за этого руками каждую сборку невозможно,
// а не проверять нельзя: всё это делает оболочка, и её ошибки
// страницами не ловятся — страница-то как раз работает.
//
// Здесь поднимается ровно то, что поднимает мессенджер: те же окна,
// те же флаги, те же файлы разметки, то же состояние. Само приложение
// не трогается — это отдельный процесс на полминуты.
//
// Проверяется не «нарисовалось ли», а то, что нельзя увидеть глазами:
//   — окошко сквозное для мыши (иначе оно съедает выстрелы в игре);
//   — окошко не крадёт фокус;
//   — защита от захвата правда прячет окна из демонстрации;
//   — горячая клавиша ловит настоящее нажатие, а не вызов функции;
//   — нажатие в меню правда доходит до оболочки;
//   — определение игры отзывается на настоящий запуск программы.

const { app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, screen } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFile, spawn } = require("node:child_process");
const { runningProcesses, anyRunning, pickable, hasWindow, steamGame } = require("../games.cjs");

const OUT = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? ".";
const root = path.join(__dirname, "..");

const results = [];
const ok = (пункт, значение, ещё) => {
  results.push({ пункт, ок: Boolean(значение), ...ещё });
  console.log(`${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё ? " " + JSON.stringify(ещё) : ""}`);
};

/** Те же числа, что в main.cjs. Расходиться им нельзя: по ним считается
 *  место окошка и здесь, и там. */
const BASE = { width: 260, height: 264 };
const GAP = 12;

const PEOPLE = [
  { id: "1", name: "Первый", avatar: "", speaking: false, muted: false, screen: false, me: true, volume: 1, silenced: false },
  { id: "2", name: "Второй", avatar: "", speaking: true, muted: false, screen: false, me: false, volume: 1, silenced: false },
  { id: "3", name: "Третий", avatar: "", speaking: false, muted: true, screen: false, me: false, volume: 1, silenced: false },
  { id: "4", name: "Четвёртый", avatar: "", speaking: false, muted: false, screen: true, me: false, volume: 0.5, silenced: false },
];

const STATE = {
  inCall: true,
  hudMode: "always",
  games: [],
  channelName: "Общий",
  muted: false,
  deafened: false,
  sharing: false,
  master: 1,
  key: "Shift+F1",
  pos: { x: 0, y: 0 },
  scale: 1,
  people: PEOPLE,
  channels: [
    { id: "a", name: "Общий", count: 4, current: true },
    { id: "b", name: "Второй канал", count: 0, current: false },
  ],
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const powershell = (script) =>
  new Promise((resolve) => {
    execFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true },
      (error, stdout) => resolve(error ? "" : String(stdout).trim()),
    );
  });

/** Снимок всего экрана. */
async function shot(name) {
  const { size, scaleFactor } = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: {
      width: Math.round(size.width * scaleFactor),
      height: Math.round(size.height * scaleFactor),
    },
  });
  const source = sources[0];
  if (!source) return null;
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, source.thumbnail.toPNG());
  return { file, image: source.thumbnail };
}

/** Средняя яркость куска снимка. Ею меряется и затемнение,
 *  и то, спряталось ли окно от захвата. */
function brightness(image, rect) {
  const { width } = image.getSize();
  const bitmap = image.toBitmap(); // BGRA
  let sum = 0;
  let count = 0;
  for (let y = rect.y; y < rect.y + rect.height; y += 3) {
    for (let x = rect.x; x < rect.x + rect.width; x += 3) {
      const i = (y * width + x) * 4;
      sum += (bitmap[i] + bitmap[i + 1] + bitmap[i + 2]) / 3;
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
}

function makeWindow(extra = {}) {
  return new BrowserWindow({
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(root, "overlay-preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...extra,
  });
}

async function main() {
  const { workArea } = screen.getPrimaryDisplay();

  /* ── 1. Окошко ──────────────────────────────────────────────── */
  console.log("\n=== Окошко поверх игры ===");

  const hud = makeWindow({ ...BASE, focusable: false });
  hud.setAlwaysOnTop(true, "screen-saver");
  hud.setIgnoreMouseEvents(true, { forward: true });
  hud.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

  await hud.loadFile(path.join(root, "overlay.html"));
  hud.webContents.send("overlay:state", STATE);

  const place = (pos, scale) => {
    const size = {
      width: Math.round(BASE.width * scale),
      height: Math.round(BASE.height * scale),
    };
    return {
      ...size,
      x: workArea.x + GAP + Math.round(Math.max(0, workArea.width - size.width - GAP * 2) * pos.x),
      y: workArea.y + GAP + Math.round(Math.max(0, workArea.height - size.height - GAP * 2) * pos.y),
    };
  };

  hud.setBounds(place(STATE.pos, 1));
  hud.showInactive();
  await wait(600);

  ok("окошко видно", hud.isVisible());
  ok("окошко не забрало фокус", !hud.isFocused());

  const rows = await hud.webContents.executeJavaScript(
    `JSON.stringify({ строк: document.querySelectorAll(".row").length,
                      выключен: document.querySelectorAll(".muted").length,
                      показывает: document.querySelectorAll(".shows").length,
                      говорит: document.querySelectorAll(".row.speaking").length })`,
  );
  const r = JSON.parse(rows);
  ok("нарисованы все четверо", r.строк === 4, r);
  ok("отметки: микрофон, экран, речь", r.выключен === 1 && r.показывает === 1 && r.говорит === 1, r);

  // Углы и размеры: окошко не должно вылезать за экран ни в одном
  // из двенадцати сочетаний.
  let escaped = 0;
  for (const pos of [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]) {
    for (const scale of [0.8, 1, 1.25]) {
      const want = place(pos, scale);
      hud.setBounds(want);
      await wait(30);
      const got = hud.getBounds();
      const inside =
        got.x >= workArea.x &&
        got.y >= workArea.y &&
        got.x + got.width <= workArea.x + workArea.width &&
        got.y + got.height <= workArea.y + workArea.height;
      if (got.x !== want.x || got.y !== want.y || !inside) escaped += 1;
    }
  }
  ok("четыре угла × три размера — всё на экране", escaped === 0, { промахов: escaped });

  hud.setBounds(place(STATE.pos, 1));
  await wait(80);

  // Живое обновление: человек вышел — строка должна исчезнуть.
  hud.webContents.send("overlay:state", { ...STATE, people: PEOPLE.slice(0, 2) });
  await wait(200);
  const after = await hud.webContents.executeJavaScript(`document.querySelectorAll(".row").length`);
  ok("окошко следит за составом", after === 2, { стало: after });
  hud.webContents.send("overlay:state", STATE);
  await wait(150);

  const hudShot = await shot("оверлей-окошко");

  /* ── 2. Сквозное для мыши ───────────────────────────────────── */
  console.log("\n=== Мышь ===");

  const b = hud.getBounds();
  const probe = await powershell(`
    Add-Type -ReferencedAssemblies System.Drawing @"
using System; using System.Text; using System.Runtime.InteropServices;
public class P {
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(System.Drawing.Point p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint id);
}
"@
    $out = @()
    foreach ($p in @(@(${b.x + 40},${b.y + 20}), @(${b.x + Math.round(b.width / 2)},${b.y + 60}), @(${b.x + 30},${b.y + b.height - 20}))) {
      $h = [P]::WindowFromPoint((New-Object System.Drawing.Point($p[0], $p[1])))
      $id = 0; [void][P]::GetWindowThreadProcessId($h, [ref]$id)
      $out += $id
    }
    $out -join ","
  `);
  const under = probe.split(",").map(Number).filter(Boolean);
  const mine = process.pid;
  ok("под окошком лежит чужое окно, не наше", under.length === 3 && under.every((id) => id !== mine), {
    подТочками: under.join(", "),
    нашPid: mine,
  });

  /* ── 3. Защита от захвата ───────────────────────────────────── */
  console.log("\n=== Демонстрация экрана ===");

  // Красный квадрат поверх всего: с защитой он не должен попасть
  // в снимок, без защиты — обязан. Это единственный способ проверить
  // защиту, не полагаясь на чтение исходника.
  const flag = makeWindow({ width: 300, height: 200, focusable: false });
  flag.setAlwaysOnTop(true, "screen-saver");
  flag.setIgnoreMouseEvents(true, { forward: true });
  flag.setBounds({ x: workArea.x + 700, y: workArea.y + 400, width: 300, height: 200 });
  await flag.loadURL("data:text/html,<body style='margin:0;background:%23ff0000'></body>");

  flag.setContentProtection(false);
  flag.showInactive();
  await wait(500);
  const visible = await shot("защита-выключена");

  flag.setContentProtection(true);
  await wait(500);
  const hidden = await shot("защита-включена");

  const rect = { x: workArea.x + 760, y: workArea.y + 450, width: 180, height: 100 };
  const яркоеБезЗащиты = brightness(visible.image, rect);
  const сЗащитой = brightness(hidden.image, rect);
  ok("без защиты окно попадает в снимок", яркоеБезЗащиты > 40, { яркость: Math.round(яркоеБезЗащиты) });
  ok("с защитой окно из снимка исчезает", сЗащитой < яркоеБезЗащиты / 2, {
    было: Math.round(яркоеБезЗащиты),
    стало: Math.round(сЗащитой),
  });
  flag.destroy();

  /* ── 4. Меню ────────────────────────────────────────────────── */
  console.log("\n=== Меню ===");

  const menu = makeWindow();
  menu.setAlwaysOnTop(true, "screen-saver");
  menu.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  await menu.loadFile(path.join(root, "overlay-menu.html"));
  menu.setBounds(workArea);
  menu.webContents.send("overlay:state", STATE);

  const beforeShot = await shot("до-меню");
  const dimRect = { x: workArea.x + 300, y: workArea.y + 200, width: 200, height: 120 };
  const доЗатемнения = brightness(beforeShot.image, dimRect);

  hud.hide();
  menu.show();
  menu.focus();
  await wait(60);
  menu.webContents.send("overlay:open");
  await wait(500);

  ok("меню видно", menu.isVisible());
  ok("меню взяло фокус", menu.isFocused());
  const mb = menu.getBounds();
  ok("меню на весь рабочий стол", mb.width === workArea.width && mb.height === workArea.height, {
    ожидали: `${workArea.width}×${workArea.height}`,
    получили: `${mb.width}×${mb.height}`,
  });

  const menuShot = await shot("оверлей-меню");
  const послеЗатемнения = brightness(menuShot.image, dimRect);
  ok("фон затемняется", послеЗатемнения < доЗатемнения * 0.7, {
    было: Math.round(доЗатемнения),
    стало: Math.round(послеЗатемнения),
    осталось: `${Math.round((послеЗатемнения / Math.max(1, доЗатемнения)) * 100)}%`,
  });

  const inside = JSON.parse(
    await menu.webContents.executeJavaScript(
      `JSON.stringify({
         проявилось: getComputedStyle(document.body).opacity,
         карточка: Math.round(document.getElementById("card").getBoundingClientRect().width),
         людей: document.querySelectorAll("#people .person").length,
         ползунков: document.querySelectorAll("#people input[type=range]").length,
         каналов: document.querySelectorAll("#channels .channel").length,
         громкость: document.getElementById("master-value").textContent,
         экран: document.getElementById("screen").title,
       })`,
    ),
  );
  ok("меню проявилось до конца", inside.проявилось === "1", inside);
  ok("карточка в натуральную величину", inside.карточка === 460, inside);
  ok("состав, ползунки, каналы", inside.людей === 4 && inside.ползунков === 3 && inside.каналов === 2, inside);

  /* ── 5. Настоящие нажатия в меню ────────────────────────────── */
  console.log("\n=== Нажатия ===");

  const heard = [];
  ipcMain.on("overlay:action", (_e, action) => heard.push(action?.type));

  /** Настоящее нажатие мышью по середине элемента: событие идёт
   *  через страницу, мост и IPC — то есть по всей дороге, а не
   *  вызовом обработчика напрямую. */
  async function clickOn(selector) {
    const box = JSON.parse(
      await menu.webContents.executeJavaScript(
        `(() => { const b = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
                  return JSON.stringify({ x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }); })()`,
      ),
    );
    menu.webContents.sendInputEvent({ type: "mouseDown", x: box.x, y: box.y, button: "left", clickCount: 1 });
    menu.webContents.sendInputEvent({ type: "mouseUp", x: box.x, y: box.y, button: "left", clickCount: 1 });
    await wait(120);
  }

  await clickOn("#mic");
  ok("кнопка микрофона доходит до оболочки", heard.at(-1) === "mute", { услышано: heard.at(-1) });
  const stillOpen = await menu.webContents.executeJavaScript(
    `document.body.classList.contains("shown")`,
  );
  ok("после кнопки меню остаётся открытым", stillOpen);

  heard.length = 0;
  await clickOn("#channels .channel:not(.current)");
  ok("переход в канал доходит", heard.at(-1) === "join", { услышано: heard.at(-1) });

  heard.length = 0;
  await clickOn("header h1");
  ok("щелчок по пустому месту закрывает", heard.at(-1) === "close", { услышано: heard.at(-1) });

  // Возвращаем в открытое состояние для дальнейших проверок.
  menu.webContents.send("overlay:open");
  await wait(250);

  /* ── 6. Выбор того, что показать — на настоящих источниках ──── */
  console.log("\n=== Выбор экрана ===");

  const sources = await desktopCapturer.getSources({
    types: ["screen", "window"],
    thumbnailSize: { width: 320, height: 180 },
  });
  const payload = sources.slice(0, 6).map((s) => ({
    id: s.id,
    name: s.name,
    kind: s.id.startsWith("screen:") ? "screen" : "window",
    thumbnail: `data:image/jpeg;base64,${s.thumbnail.toJPEG(70).toString("base64")}`,
  }));
  ok("источники нашлись", payload.length > 0, { всего: sources.length });

  menu.webContents.send("screen:pick", payload);
  await wait(600);

  const pick = JSON.parse(
    await menu.webContents.executeJavaScript(
      `JSON.stringify({
         открыт: getComputedStyle(document.getElementById("pick")).display,
         основноеСкрыто: getComputedStyle(document.getElementById("main")).display,
         плиток: document.querySelectorAll(".source").length,
         миниатюрыЗагрузились: [...document.querySelectorAll(".source img")].filter((i) => i.naturalWidth > 0).length,
         заглушек: document.querySelectorAll(".source .shot").length,
         битых: [...document.querySelectorAll(".source img")].filter((i) => i.complete && i.naturalWidth === 0).length,
         первый: document.querySelector(".source .cap")?.textContent ?? "",
       })`,
    ),
  );
  ok("выбор открывается вместо меню", pick.открыт === "flex" && pick.основноеСкрыто === "none", pick);
  // Windows отказывается снимать свёрнутые и защищённые окна, так что
  // пустая миниатюра — нормальное положение дел, а не поломка. Важно
  // другое: на её месте должна быть заглушка, а не значок битой
  // картинки, и плитка должна оставаться нажимаемой.
  ok(
    "у каждой плитки есть картинка или заглушка",
    pick.миниатюрыЗагрузились + pick.заглушек === pick.плиток,
    pick,
  );
  ok("битых картинок нет", pick.битых === 0, pick);
  ok("экраны идут первыми", /экран|screen|display|весь/i.test(pick.первый), { первый: pick.первый });

  const pickShot = await shot("оверлей-выбор-экрана");

  // Ответ обязателен: без него оболочка ждала бы вечно.
  const answered = new Promise((resolve) => ipcMain.once("screen:picked", (_e, id) => resolve(id)));
  await clickOn(".source");
  const chosen = await Promise.race([answered, wait(1500).then(() => "нет ответа")]);
  ok("выбор источника отвечает оболочке", typeof chosen === "string" && chosen.includes(":"), {
    ответ: chosen,
  });

  /* ── 7. Горячая клавиша — настоящим нажатием ────────────────── */
  console.log("\n=== Горячая клавиша ===");

  let fired = 0;
  const taken = globalShortcut.register(STATE.key, () => {
    fired += 1;
  });
  ok("клавиша Shift+F1 занялась", taken);

  // Настоящее системное нажатие, а не вызов обработчика: только так
  // видно, что клавишу перехватывает именно система.
  await powershell(`
    Add-Type -AssemblyName System.Windows.Forms
    Start-Sleep -Milliseconds 300
    [System.Windows.Forms.SendKeys]::SendWait("+{F1}")
  `);
  await wait(700);
  ok("настоящее нажатие Shift+F1 сработало", fired > 0, { раз: fired });

  globalShortcut.unregister(STATE.key);
  ok("клавиша отпущена", !globalShortcut.isRegistered(STATE.key));

  menu.destroy();
  hud.destroy();
  await wait(200);

  /* ── 8. Определение игры — настоящим запуском ───────────────── */
  console.log("\n=== Определение игры ===");

  const all = await runningProcesses();
  ok("список процессов читается", all.length > 20, { процессов: all.length });
  const choices = pickable(all);
  ok("список для выбора не пуст и без служебного", choices.length > 0 && !choices.some((c) => /^svchost/i.test(c.name)), {
    сверху: choices.slice(0, 3).map((c) => c.name).join(", "),
  });

  ok("несуществующая игра не считается запущенной", !anyRunning(["нет-такой-игры.exe"], all));

  // Запускаем настоящую программу и смотрим, заметит ли её проверка,
  // а потом закрываем и смотрим, заметит ли, что её не стало.
  //
  // findstr, а не блокнот: блокнот в Windows 11 запускается через
  // посредника, и закрывается при этом посредник, а сам блокнот
  // остаётся жить. Проверка честно видела его дальше и падала —
  // на собственной ошибке, а не на ошибке приложения.
  //
  // findstr без входных данных стоит и ждёт, ни во что не лезет,
  // закрывается по первому требованию и больше нигде на машине
  // не запущен.
  const dummy = spawn("findstr.exe", ["/r", "x"], {
    stdio: ["pipe", "ignore", "ignore"],
    windowsHide: true,
  });
  await wait(1200);
  ok("запущенная программа опознаётся как игра", anyRunning(["findstr.exe"], await runningProcesses()));

  // Но одного процесса мало. Roblox, Steam и половина игр остаются
  // висеть в трее после выхода: процесс есть, окна нет, человек
  // не играет. Друзьям при этом писали, что играет.
  ok("процесс без окна игрой не считается", (await hasWindow("findstr.exe")) === false);

  // Steam спрашивается первым и до списка имён: он один знает все игры,
  // включая вышедшие вчера. Проверяем, что ответ приходит и что это
  // либо название, либо честное «ничего не запущено».
  const steam = await steamGame();
  ok("Steam отвечает, во что играют", steam === null || typeof steam === "string", {
    ответ: steam ?? "ничего не запущено",
  });

  dummy.kill();
  await wait(1500);
  ok(
    "закрытая программа перестаёт считаться игрой",
    !anyRunning(["findstr.exe"], await runningProcesses()),
  );

  /* ── Итог ───────────────────────────────────────────────────── */
  const failed = results.filter((x) => !x.ок);
  console.log(
    `\n${failed.length === 0 ? "Всё сходится" : `Провалов: ${failed.length}`} — проверок ${results.length}\n`,
  );
  console.log(
    JSON.stringify(
      { снимки: [hudShot?.file, menuShot?.file, pickShot?.file].filter(Boolean) },
      null,
      1,
    ),
  );

  app.exit(failed.length === 0 ? 0 : 1);
}

// Иначе Electron закрывает программу, как только закрылось последнее
// окно, — и проверка обрывалась на середине, ровно там, где окна
// стали не нужны.
app.on("window-all-closed", () => undefined);

void app.whenReady().then(() =>
  main().catch((error) => {
    console.error("проверка сорвалась:", error);
    app.exit(2);
  }),
);
