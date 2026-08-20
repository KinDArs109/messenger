// Проверка своих эмодзи сервера — от буста до картинки в сообщении.
//
//   npm run check:emoji -w @messenger/desktop -- --pass=…
//
// Эмодзи открываются на третьем уровне, а третий уровень — это четыре
// буста, по одному с человека. Поэтому здесь четверо: четверо входят,
// четверо поддерживают сервер, и только после этого эмодзи вообще
// появляется. Проверяем и обратное: до уровня сервер отказывает.
//
// Настройка идёт запросами, а последний шаг — глазами: сообщение
// с эмодзи открывается в настоящем окне, и мы смотрим, нарисовалась
// ли картинка. Отдельная проверка, а не часть общей: там двое, и
// поднимать их до четверых ради одного раздела значит замедлить всё.

const { app, BrowserWindow, session } = require("electron");

app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
app.on("window-all-closed", () => undefined);

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SITE = arg("site") ?? "https://45.130.42.77.sslip.io";
const PASS = arg("pass");

const результаты = [];
const ok = (пункт, значение, ещё) => {
  результаты.push(Boolean(значение));
  console.log(`${значение ? "  ✔" : "  ✘ ПРОВАЛ"} ${пункт}${ещё ? " " + JSON.stringify(ещё) : ""}`);
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Запрос от имени человека. Токен в заголовке, без cookie: так
 *  четверо помещаются в один процесс, не мешая друг другу. */
async function запрос(token, path, options = {}) {
  const res = await fetch(`${SITE}/api${path}`, {
    method: options.method ?? "GET",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(options.body ? { body: JSON.stringify(options.body) } : {}),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function войти(login) {
  const r = await запрос(null, "/auth/login", { method: "POST", body: { login, password: PASS } });
  if (!r.ok) throw new Error(`не вошёл как ${login}: ${r.status}`);
  return r.data.accessToken;
}

/** Картинка эмодзи — маленький PNG прямо здесь, чтобы проверке
 *  не нужен был файл на диске. Что на нём нарисовано, неважно:
 *  важно, что это настоящая картинка и её пережмут. */
function картинка() {
  const base64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  return Buffer.from(base64, "base64");
}

void app.whenReady().then(async () => {
  console.log("\n=== Свои эмодзи сервера ===");

  const токены = {};
  for (const кто of ["a", "b", "c", "d"]) токены[кто] = await войти(`call-check-${кто}`);

  // Сервер заводит первый, остальные входят по приглашению.
  const server = (
    await запрос(токены.a, "/servers", { method: "POST", body: { name: "Emoji" } })
  ).data.server;
  const invite = (
    await запрос(токены.a, `/servers/${server.id}/invites`, { method: "POST", body: {} })
  ).data;

  for (const кто of ["b", "c", "d"]) {
    await запрос(токены[кто], `/invites/${invite.code}/join`, { method: "POST" });
  }

  // Пока уровня нет, эмодзи заводить нельзя — и это проверяется
  // на сервере, а не только отсутствием кнопки.
  const рано = await запрос(токены.a, `/servers/${server.id}/emoji`, {
    method: "POST",
    body: { name: "proba", url: "/uploads/00000000000000000000000000.webp" },
  });
  ok("без уровня сервер отказывает", рано.status === 403, { код: рано.status });

  // Четыре поддержки — по одной с человека.
  let level = 0;
  for (const кто of ["a", "b", "c", "d"]) {
    const r = await запрос(токены[кто], `/servers/${server.id}/boost`, { method: "PUT" });
    level = r.data?.level ?? level;
  }
  ok("четыре поддержки дают третий уровень", level === 3, { уровень: level });

  // Картинка эмодзи — обычной формой, как из интерфейса.
  const form = new FormData();
  form.append("file", new Blob([картинка()], { type: "image/png" }), "smoke.png");
  const upload = await fetch(`${SITE}/api/uploads/emoji`, {
    method: "POST",
    headers: { Authorization: `Bearer ${токены.a}` },
    body: form,
  });
  const uploaded = await upload.json().catch(() => null);
  ok("картинка эмодзи загрузилась", upload.ok && Boolean(uploaded?.url), { код: upload.status });

  const создано = await запрос(токены.a, `/servers/${server.id}/emoji`, {
    method: "POST",
    body: { name: "smoke", url: uploaded?.url },
  });
  ok("эмодзи завелось", создано.ok && создано.data?.emoji?.length === 1, {
    код: создано.status,
    сколько: создано.data?.emoji?.length,
  });

  // Имя не по правилам — отказ. Иначе в тексте появилось бы то,
  // что разбором никогда не найдётся.
  const плохое = await запрос(токены.a, `/servers/${server.id}/emoji`, {
    method: "POST",
    body: { name: "Плохое Имя", url: uploaded?.url },
  });
  ok("кривое имя не проходит", плохое.status === 400, { код: плохое.status });

  // Второе с тем же именем — тоже отказ: иначе непонятно, какая
  // картинка нарисуется.
  const дубль = await запрос(токены.a, `/servers/${server.id}/emoji`, {
    method: "POST",
    body: { name: "smoke", url: uploaded?.url },
  });
  ok("второе с тем же именем не заводится", дубль.status === 400, { код: дубль.status });

  // Пишем сообщение с эмодзи — и смотрим глазами у второго человека.
  const канал = server.channels.find((c) => c.type === "TEXT");
  await запрос(токены.a, `/channels/${канал.id}/messages`, {
    method: "POST",
    body: { content: "проба :smoke: и всё" },
  });

  const ses = session.fromPartition("persist:emoji-check");
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    show: true,
    webPreferences: { session: ses, backgroundThrottling: false },
  });
  await win.loadURL(`${SITE}/?app`);
  await win.webContents.executeJavaScript(`
    fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
      credentials: "include", body: JSON.stringify({ login: "call-check-b", password: ${JSON.stringify(PASS)} }) })
      .then((r) => r.json()).then((d) => Boolean(d.accessToken))
  `);
  await win.loadURL(`${SITE}/?app`);
  await wait(3500);

  // Открываем сервер — по той же кнопке, что и человек.
  const открыт = await win.webContents.executeJavaScript(`
    (() => {
      const b = document.querySelector('button[title="Emoji"]');
      if (!b) return "";
      b.click();
      return "да";
    })()
  `);
  await wait(2000);

  const нарисовано = await win.webContents.executeJavaScript(`
    (() => {
      const img = [...document.querySelectorAll("img")].find((n) => n.alt === ":smoke:");
      if (!img) {
        return JSON.stringify({ есть: false, текстом: document.body.innerText.includes(":smoke:") });
      }
      return JSON.stringify({
        есть: true,
        ширина: Math.round(img.getBoundingClientRect().width),
        загрузилась: img.naturalWidth > 0,
      });
    })()
  `);
  const н = JSON.parse(нарисовано);
  ok("сервер открылся у второго", открыт === "да");
  ok("эмодзи в сообщении нарисовалось картинкой", н.есть === true, н);
  ok("картинка действительно загрузилась", н.загрузилась === true, н);
  ok("размером со строку, а не с ноготь", (н.ширина ?? 0) >= 12 && (н.ширина ?? 0) <= 40, н);

  // Убираем за собой — заодно это и проверка удаления.
  const убрано = await запрос(токены.a, `/servers/${server.id}/emoji/${создано.data?.emoji?.[0]?.id}`, {
    method: "DELETE",
  });
  ok("эмодзи убирается", убрано.ok && убрано.data?.emoji?.length === 0, {
    осталось: убрано.data?.emoji?.length,
  });

  const провалов = результаты.filter((x) => !x).length;
  console.log(
    `\n${провалов === 0 ? "Всё сходится" : `Провалов: ${провалов}`} — проверок ${результаты.length}\n`,
  );
  win.destroy();
  app.exit(провалов === 0 ? 0 : 1);
});
