/*
 * Хозяйская панель — то, за чем раньше приходилось лезть в базу руками.
 *
 * Отдельное приложение, а не вкладка в мессенджере. Кнопка «удалить
 * человека» не должна находиться в двух нажатиях от переписки, даже
 * если она невидима остальным: невидима — не значит недоступна,
 * достаточно ошибиться в одной проверке.
 *
 * Вход — обычный, через тот же мессенджер: имя, пароль, код из письма.
 * Своего пароля у панели нет и быть не должно: два входа к одному
 * хозяйству — это два места, где можно ошибиться.
 */

const АДРЕС =
  new URLSearchParams(location.search).get("site") ??
  localStorage.getItem("адрес") ??
  "https://45.130.42.77.sslip.io";

let токен = null;
let пропуск = null; // между шагами входа
let данные = null;
let вСети = new Set();

const корень = document.getElementById("корень");

const экранируй = (s) =>
  String(s).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

async function запрос(путь, настройки = {}) {
  const ответ = await fetch(`${АДРЕС}/api${путь}`, {
    ...настройки,
    headers: {
      ...(настройки.body ? { "Content-Type": "application/json" } : {}),
      ...(токен ? { Authorization: `Bearer ${токен}` } : {}),
    },
    body: настройки.body ? JSON.stringify(настройки.body) : undefined,
  });
  const тело = await ответ.json().catch(() => ({}));
  if (!ответ.ok)
    throw new Error(тело?.error?.message ?? `Ошибка ${ответ.status}`);
  return тело;
}

/* ── Вход ──────────────────────────────────────────────────────── */

function показатьВход(ошибка) {
  корень.innerHTML = `
    <div class="вход">
      <h1 style="margin:0 0 4px;font-size:19px;color:var(--ярко)">Хозяйство</h1>
      <p class="тускло" style="margin:0 0 22px">${экранируй(АДРЕС.replace(/^https?:\/\//, ""))}</p>
      ${ошибка ? `<div class="ошибка">${экранируй(ошибка)}</div>` : ""}
      <label>Почта или имя<input id="логин" autocomplete="username" /></label>
      <label>Пароль<input id="пароль" type="password" autocomplete="current-password" /></label>
      <button class="главная" id="войти" style="width:100%">Войти</button>
    </div>`;

  const войти = async () => {
    const логин = document.getElementById("логин").value.trim();
    const пароль = document.getElementById("пароль").value;
    if (!логин || !пароль) return;
    try {
      const ответ = await запрос("/auth/login", {
        method: "POST",
        body: { login: логин, password: пароль },
      });
      if (ответ.accessToken) {
        токен = ответ.accessToken;
        await открыть();
        return;
      }
      пропуск = ответ.ticket;
      показатьКод(ответ.email);
    } catch (беда) {
      показатьВход(беда.message);
    }
  };

  document.getElementById("войти").onclick = войти;
  document.getElementById("пароль").onkeydown = (e) =>
    e.key === "Enter" && войти();
  document.getElementById("логин").focus();
}

function показатьКод(адрес, ошибка) {
  корень.innerHTML = `
    <div class="вход">
      <h1 style="margin:0 0 4px;font-size:19px;color:var(--ярко)">Код из письма</h1>
      <p class="тускло" style="margin:0 0 22px">Отправили на ${экранируй(адрес ?? "почту")}</p>
      ${ошибка ? `<div class="ошибка">${экранируй(ошибка)}</div>` : ""}
      <label>Шесть цифр
        <input id="код" inputmode="numeric" maxlength="6"
               style="text-align:center;letter-spacing:.45em;font-size:21px" />
      </label>
      <button class="главная" id="подтвердить" style="width:100%">Войти</button>
      <button id="назад" style="width:100%;margin-top:8px;background:transparent">Назад</button>
    </div>`;

  const подтвердить = async () => {
    const код = document.getElementById("код").value.trim();
    if (код.length !== 6) return;
    try {
      const ответ = await запрос("/auth/login/confirm", {
        method: "POST",
        body: { ticket: пропуск, code: код },
      });
      токен = ответ.accessToken;
      await открыть();
    } catch (беда) {
      показатьКод(адрес, беда.message);
    }
  };

  document.getElementById("подтвердить").onclick = подтвердить;
  document.getElementById("код").onkeydown = (e) =>
    e.key === "Enter" && подтвердить();
  document.getElementById("назад").onclick = () => показатьВход();
  document.getElementById("код").focus();
}

/* ── Хозяйство ─────────────────────────────────────────────────── */

async function открыть(сообщение) {
  try {
    данные = await запрос("/admin/overview");
  } catch (беда) {
    // Не хозяин — раздела для него просто нет.
    показатьВход(
      беда.message.includes("не найден") || беда.message.includes("не включён")
        ? "Эта учётная запись не хозяйская"
        : беда.message,
    );
    return;
  }

  try {
    вСети = new Set((await запрос("/admin/online")).вСети ?? []);
  } catch {
    вСети = new Set();
  }

  нарисовать(сообщение);
}

/* ── Мелкая помощь глазам ──────────────────────────────────────── */

/** Цвет по имени — тот же приём, что и в самом мессенджере: лицо
 *  без картинки всё равно должно быть узнаваемым, а одинаково серые
 *  кружки не отличить друг от друга. */
const ЦВЕТА = [
  "#4a8cf7",
  "#2bb35f",
  "#d9a441",
  "#e0484b",
  "#a17ff0",
  "#e06ba8",
  "#3fb6c4",
];
function цвет(строка) {
  let сумма = 0;
  for (const символ of String(строка))
    сумма = (сумма + символ.codePointAt(0)) % 997;
  return ЦВЕТА[сумма % ЦВЕТА.length];
}

/** «1 вход», «2 входа», «5 входов» — русский счёт. Мелочь, но
 *  «1 входов» в панели выглядит так же, как опечатка в письме. */
function счёт(число, одна, две, много) {
  const сотня = число % 100;
  const десяток = число % 10;
  if (сотня >= 11 && сотня <= 14) return `${число} ${много}`;
  if (десяток === 1) return `${число} ${одна}`;
  if (десяток >= 2 && десяток <= 4) return `${число} ${две}`;
  return `${число} ${много}`;
}

const буква = (имя) =>
  String(имя ?? "?")
    .trim()
    .charAt(0)
    .toUpperCase() || "?";

/** «Сегодня», «вчера», «5 дней назад» — так понятнее, чем дата,
 *  когда важно не «когда именно», а «давно ли». */
function когда(строка) {
  if (!строка) return "не заходил";
  const дней = Math.floor((Date.now() - new Date(строка).getTime()) / 86400000);
  if (дней <= 0) return "сегодня";
  if (дней === 1) return "вчера";
  if (дней < 7) return `${дней} дн. назад`;
  if (дней < 60) return `${Math.floor(дней / 7)} нед. назад`;
  return new Date(строка).toLocaleDateString("ru-RU");
}

const дата = (строка) =>
  строка ? new Date(строка).toLocaleDateString("ru-RU") : "—";

/* ── Отрисовка ─────────────────────────────────────────────────── */

function нарисовать(сообщение) {
  const { люди, серверы, приглашения, регистрация } = данные;
  const годных = приглашения.filter((и) => и.годно).length;

  корень.innerHTML = `
    <header>
      <span class="знак">Х</span>
      <span>
        <h1>Хозяйство</h1>
        <span class="адрес">${экранируй(АДРЕС.replace(/^https?:\/\//, ""))}</span>
      </span>
      <span class="справа">
        <span class="значок ${регистрация.поКоду ? "жёлтый" : "да"}">
          Регистрация: ${регистрация.поКоду ? "по приглашению" : "открыта всем"}
        </span>
        <button id="обновить" class="мелкая">Обновить</button>
      </span>
    </header>

    <main>
      ${сообщение ? `<div class="успех">${экранируй(сообщение)}</div>` : ""}

      <div class="цифры">
        <div class="цифра"><b>${люди.length}</b><span>${люди.length === 1 ? "человек" : "человек"}</span></div>
        <div class="цифра зелёная"><b>${вСети.size}</b><span>сейчас в сети</span></div>
        <div class="цифра"><b>${серверы.length}</b><span>серверов</span></div>
        <div class="цифра"><b>${годных}</b><span>годных приглашений</span></div>
        <div class="цифра">
          <b>${люди.filter((к) => !к.почтаПодтверждена).length}</b>
          <span>без подтверждённой почты</span>
        </div>
      </div>

      <section>
        <h2><span class="метка" style="background:var(--синий)"></span>Люди
          <span class="сколько">— ${люди.length}</span>
        </h2>
        <div class="люди">
          ${люди.map(человек).join("")}
        </div>
      </section>

      <section>
        <h2><span class="метка" style="background:var(--сирень)"></span>Серверы
          <span class="сколько">— ${серверы.length}</span>
        </h2>
        ${
          серверы.length
            ? `<div class="серверы">${серверы.map(сервер).join("")}</div>`
            : `<div class="люди"><p class="пусто">Серверов нет</p></div>`
        }
      </section>

      <section>
        <h2><span class="метка" style="background:var(--зелёный)"></span>Приглашения
          <span class="сколько">— годных ${годных} из ${приглашения.length}</span>
        </h2>
        ${
          приглашения.length
            ? `<div class="приглашения">${приглашения.map(приглашение).join("")}</div>`
            : `<div class="люди"><p class="пусто">Приглашений нет — выпустить можно кнопкой у сервера</p></div>`
        }
      </section>
    </main>`;

  повеситьРучки();
}

function человек(кто) {
  const онлайн = вСети.has(кто.id);
  return `
    <div class="человек">
      <span class="лицо" style="background:${цвет(кто.username)}">
        ${экранируй(буква(кто.displayName))}
        <i class="${онлайн ? "вСети" : ""}" title="${онлайн ? "в сети" : "не в сети"}"></i>
      </span>
      <span>
        <span class="имя">${экранируй(кто.displayName)}</span><br />
        <span class="кличка">@${экранируй(кто.username)}</span>
      </span>
      <span class="почта">
        ${экранируй(кто.email)}
        <span class="значок ${кто.почтаПодтверждена ? "да" : "нет"}">
          ${кто.почтаПодтверждена ? "подтверждена" : "не подтверждена"}
        </span>
      </span>
      <span class="мелко скрыть">${когда(кто.последнийВход)}${кто.откуда ? `<br />${экранируй(кто.откуда)}` : ""}</span>
      <span class="мелко скрыть">${счёт(кто.сообщений, "сообщение", "сообщения", "сообщений")}<br />с ${дата(кто.создан)}</span>
      <span>
        <button class="опасная мелкая" data-удалить="${кто.id}"
                data-имя="${экранируй(кто.username)}" data-сообщений="${кто.сообщений}">Удалить</button>
      </span>
    </div>`;
}

function сервер(с) {
  return `
    <div class="сервер">
      <span class="верх">
        <span class="щит" style="background:${цвет(с.name)}">${экранируй(буква(с.name))}</span>
        <span>
          <span class="название">${экранируй(с.name)}</span><br />
          <span class="кличка">@${экранируй(с.хозяин)}</span>
        </span>
      </span>
      <span class="фишки">
        <span class="фишка">${счёт(с.людей, "человек", "человека", "человек")}</span>
        <span class="фишка">${счёт(с.каналов, "канал", "канала", "каналов")}</span>
        <span class="фишка">с ${дата(с.создан)}</span>
      </span>
      <span class="ряд">
        <button class="мелкая" data-пригласить="${с.id}">Пригласить</button>
        <button class="опасная мелкая" data-сервер="${с.id}"
                data-название="${экранируй(с.name)}" data-людей="${с.людей}"
                data-каналов="${с.каналов}">Удалить</button>
      </span>
    </div>`;
}

function приглашение(и) {
  return `
    <div class="приглашение ${и.годно ? "" : "мертво"}">
      <code>${экранируй(и.code)}</code>
      <span class="мелко">${экранируй(и.сервер)}</span>
      <span class="мелко скрыть">${и.лимит ? `${и.использовано} из ${и.лимит}` : счёт(и.использовано, "вход", "входа", "входов")}</span>
      <span class="мелко скрыть">${и.истекает ? (и.годно ? `до ${дата(и.истекает)}` : "истекло") : "бессрочно"}</span>
      <span class="ряд">
        <button class="мелкая" data-копировать="${экранируй(и.code)}">Скопировать</button>
        <button class="опасная мелкая" data-отозвать="${экранируй(и.code)}">Отозвать</button>
      </span>
    </div>`;
}

/* ── Кнопки ────────────────────────────────────────────────────── */

function повеситьРучки() {
  document.getElementById("обновить").onclick = () => открыть();

  const каждой = (признак, дело) => {
    for (const кнопка of document.querySelectorAll(`[data-${признак}]`)) {
      кнопка.onclick = async () => {
        try {
          await дело(кнопка);
        } catch (беда) {
          alert(беда.message);
        }
      };
    }
  };

  каждой("удалить", async (кнопка) => {
    const { имя, сообщений } = кнопка.dataset;
    const хвост = Number(сообщений)
      ? `\n\nВместе с ним пропадут его сообщения (${сообщений}) — во всех каналах и переписках.`
      : "";
    if (!confirm(`Удалить ${имя}?${хвост}\n\nОтменить будет нельзя.`)) return;

    const ответ = await запрос(`/admin/users/${кнопка.dataset.удалить}`, {
      method: "DELETE",
    });
    await открыть(
      `${имя} удалён` +
        (ответ.сообщений ? `, сообщений убрано: ${ответ.сообщений}` : ""),
    );
  });

  каждой("сервер", async (кнопка) => {
    const { название, людей, каналов } = кнопка.dataset;
    if (
      !confirm(
        `Удалить сервер «${название}»?\n\nВместе с ним пропадут каналы (${каналов}), вся переписка в них и состав (${людей}).\n\nОтменить будет нельзя.`,
      )
    )
      return;

    await запрос(`/admin/servers/${кнопка.dataset.сервер}`, {
      method: "DELETE",
    });
    await открыть(`Сервер «${название}» удалён`);
  });

  каждой("пригласить", async (кнопка) => {
    const ответ = await запрос("/admin/invites", {
      method: "POST",
      body: { serverId: кнопка.dataset.пригласить },
    });
    const ссылка = `${АДРЕС}/invite/${ответ.code}`;
    await navigator.clipboard.writeText(ссылка).catch(() => undefined);
    await открыть(`Ссылка на «${ответ.сервер}» скопирована: ${ссылка}`);
  });

  каждой("копировать", async (кнопка) => {
    await navigator.clipboard.writeText(
      `${АДРЕС}/invite/${кнопка.dataset.копировать}`,
    );
    кнопка.textContent = "Скопировано";
    setTimeout(() => (кнопка.textContent = "Скопировать"), 1500);
  });

  каждой("отозвать", async (кнопка) => {
    if (!confirm("Отозвать приглашение? Ссылка перестанет работать сразу."))
      return;
    await запрос(`/admin/invites/${кнопка.dataset.отозвать}`, {
      method: "DELETE",
    });
    await открыть("Приглашение отозвано");
  });
}

показатьВход();
