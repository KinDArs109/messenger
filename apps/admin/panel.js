/*
 * Хозяйская панель — то, за чем раньше приходилось лезть в базу руками.
 *
 * Отдельное приложение, а не вкладка в мессенджере. Кнопка «удалить
 * человека» не должна находиться в двух нажатиях от переписки, даже
 * если она невидима остальным: невидима — не значит недоступна,
 * достаточно ошибиться в одной проверке.
 *
 * Внутри — обычная страница без сборки: одна разметка, один сценарий.
 * Панель открывают раз в месяц, и тащить ради неё полтораста
 * мегабайт рантайма и сборочный конвейер незачем.
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
  if (!ответ.ok) {
    throw new Error(тело?.error?.message ?? `Ошибка ${ответ.status}`);
  }
  return тело;
}

/* ── Вход ──────────────────────────────────────────────────────── */

function показатьВход(ошибка) {
  корень.innerHTML = `
    <div class="вход">
      <h1 style="margin:0 0 4px;font-size:18px;color:var(--ярко)">Хозяйство</h1>
      <p class="тускло" style="margin:0 0 20px">${экранируй(АДРЕС.replace(/^https?:\/\//, ""))}</p>
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
  document.getElementById("пароль").onkeydown = (e) => {
    if (e.key === "Enter") войти();
  };
  document.getElementById("логин").focus();
}

function показатьКод(адрес, ошибка) {
  корень.innerHTML = `
    <div class="вход">
      <h1 style="margin:0 0 4px;font-size:18px;color:var(--ярко)">Код из письма</h1>
      <p class="тускло" style="margin:0 0 20px">Отправили на ${экранируй(адрес ?? "почту")}</p>
      ${ошибка ? `<div class="ошибка">${экранируй(ошибка)}</div>` : ""}
      <label>Шесть цифр<input id="код" inputmode="numeric" maxlength="6" style="text-align:center;letter-spacing:.4em;font-size:20px" /></label>
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
  document.getElementById("код").onkeydown = (e) => {
    if (e.key === "Enter") подтвердить();
  };
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

const дата = (строка) =>
  строка ? new Date(строка).toLocaleDateString("ru-RU") : "—";

function нарисовать(сообщение) {
  const { люди, серверы, приглашения, регистрация } = данные;

  корень.innerHTML = `
    <header>
      <h1>Хозяйство</h1>
      <span class="адрес">${экранируй(АДРЕС.replace(/^https?:\/\//, ""))}</span>
      <span class="справа">
        <span class="тускло">Регистрация: ${регистрация.поКоду ? "по коду приглашения" : "открыта всем"}</span>
        <button id="обновить">Обновить</button>
      </span>
    </header>
    <main>
      ${сообщение ? `<div class="успех">${экранируй(сообщение)}</div>` : ""}

      <section>
        <h2>Люди — ${люди.length}, в сети ${вСети.size}</h2>
        <table>
          <tr>
            <th>Кто</th><th>Почта</th><th>Заведён</th><th>Последний вход</th><th>Сообщений</th><th></th>
          </tr>
          ${люди
            .map(
              (кто) => `
            <tr>
              <td>
                <span class="точка" style="background:${вСети.has(кто.id) ? "var(--зелёный)" : "#4e5058"}"></span>
                <strong style="color:var(--ярко)">${экранируй(кто.displayName)}</strong>
                <span class="тускло">@${экранируй(кто.username)}</span>
              </td>
              <td>
                ${экранируй(кто.email)}
                <span class="${кто.почтаПодтверждена ? "да" : "нет"}" title="${кто.почтаПодтверждена ? "подтверждена" : "не подтверждена"}">
                  ${кто.почтаПодтверждена ? "✓" : "—"}
                </span>
              </td>
              <td class="тускло">${дата(кто.создан)}</td>
              <td class="тускло">${дата(кто.последнийВход)}${кто.откуда ? ` · ${экранируй(кто.откуда)}` : ""}</td>
              <td class="тускло">${кто.сообщений}</td>
              <td><button class="опасная" data-удалить="${кто.id}" data-имя="${экранируй(кто.username)}">Удалить</button></td>
            </tr>`,
            )
            .join("")}
        </table>
      </section>

      <section>
        <h2>Серверы — ${серверы.length}</h2>
        <table>
          <tr><th>Название</th><th>Хозяин</th><th>Людей</th><th>Каналов</th><th></th></tr>
          ${серверы
            .map(
              (с) => `
            <tr>
              <td style="color:var(--ярко)">${экранируй(с.name)}</td>
              <td class="тускло">@${экранируй(с.хозяин)}</td>
              <td class="тускло">${с.людей}</td>
              <td class="тускло">${с.каналов}</td>
              <td><button data-пригласить="${с.id}">Пригласить</button></td>
            </tr>`,
            )
            .join("")}
        </table>
      </section>

      <section>
        <h2>Приглашения — годных ${приглашения.filter((и) => и.годно).length} из ${приглашения.length}</h2>
        <table>
          <tr><th>Ссылка</th><th>Куда</th><th>Использовано</th><th>Истекает</th><th></th></tr>
          ${приглашения
            .map(
              (и) => `
            <tr style="${и.годно ? "" : "opacity:.45"}">
              <td><code>${экранируй(и.code)}</code></td>
              <td class="тускло">${экранируй(и.сервер)}</td>
              <td class="тускло">${и.использовано}${и.лимит ? ` из ${и.лимит}` : ""}</td>
              <td class="тускло">${и.истекает ? дата(и.истекает) : "бессрочно"}</td>
              <td class="ряд">
                <button data-копировать="${экранируй(и.code)}">Скопировать</button>
                <button class="опасная" data-отозвать="${экранируй(и.code)}">Отозвать</button>
              </td>
            </tr>`,
            )
            .join("")}
        </table>
      </section>
    </main>`;

  document.getElementById("обновить").onclick = () => открыть();

  for (const кнопка of document.querySelectorAll("[data-удалить]")) {
    кнопка.onclick = async () => {
      const имя = кнопка.dataset.имя;
      if (!confirm(`Удалить ${имя} со всей перепиской? Отменить будет нельзя.`))
        return;
      try {
        await запрос(`/admin/users/${кнопка.dataset.удалить}`, {
          method: "DELETE",
        });
        await открыть(`${имя} удалён`);
      } catch (беда) {
        alert(беда.message);
      }
    };
  }

  for (const кнопка of document.querySelectorAll("[data-пригласить]")) {
    кнопка.onclick = async () => {
      try {
        const ответ = await запрос("/admin/invites", {
          method: "POST",
          body: { serverId: кнопка.dataset.пригласить },
        });
        const ссылка = `${АДРЕС}/invite/${ответ.code}`;
        await navigator.clipboard.writeText(ссылка).catch(() => undefined);
        await открыть(`Ссылка на «${ответ.сервер}» скопирована: ${ссылка}`);
      } catch (беда) {
        alert(беда.message);
      }
    };
  }

  for (const кнопка of document.querySelectorAll("[data-копировать]")) {
    кнопка.onclick = () => {
      void navigator.clipboard.writeText(
        `${АДРЕС}/invite/${кнопка.dataset.копировать}`,
      );
      кнопка.textContent = "Скопировано";
      setTimeout(() => (кнопка.textContent = "Скопировать"), 1500);
    };
  }

  for (const кнопка of document.querySelectorAll("[data-отозвать]")) {
    кнопка.onclick = async () => {
      if (!confirm("Отозвать приглашение? Ссылка перестанет работать сразу."))
        return;
      try {
        await запрос(`/admin/invites/${кнопка.dataset.отозвать}`, {
          method: "DELETE",
        });
        await открыть("Приглашение отозвано");
      } catch (беда) {
        alert(беда.message);
      }
    };
  }
}

показатьВход();
