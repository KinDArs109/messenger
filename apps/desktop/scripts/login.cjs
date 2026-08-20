// Вход для проверок оболочки — со вторым шагом.
//
// Вход теперь в два действия: пароль, потом код из письма. Проверки,
// живущие в окне приложения, писем не читают и до базы не дотягиваются:
// они ходят на живой сайт снаружи, как человек.
//
// Поэтому код им кладут заранее, со стороны сервера:
//
//   npm run db:login-code -w @messenger/server -- <логин> [код]
//
// Действующий код сервер не заменяет новым, так что положенный
// заранее доживает до конца прогона — и проверка вводит его так же,
// как ввёл бы человек, переписав из письма.

/** Код по умолчанию — тот же, что ставит db:login-code. */
const КОД = "424242";

/**
 * Кусок кода для страницы: войти и вернуть true/false.
 *
 * Возвращается строкой, потому что выполняется он не здесь,
 * а в самой странице — там, где живут cookie сессии.
 */
function войтиВСтранице(login, pass, code = КОД) {
  return `
    (async () => {
      const шаг = (путь, тело) =>
        fetch(путь, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(тело),
        }).then((r) => r.json());

      const первый = await шаг("/api/auth/login", {
        login: ${JSON.stringify(login)},
        password: ${JSON.stringify(pass)},
      });
      // Почта на сервере не настроена — второго шага нет вовсе.
      if (первый.accessToken) return true;
      if (первый.pending !== "email") return false;

      const второй = await шаг("/api/auth/login/confirm", {
        ticket: первый.ticket,
        code: ${JSON.stringify(code)},
      });
      return Boolean(второй.accessToken);
    })()
  `;
}

/** То же самое, но снаружи страницы — когда токен нужен самой
 *  проверке, а не окну. */
async function войтиСнаружи(site, login, pass, code = КОД) {
  const шаг = (путь, тело) =>
    fetch(`${site}${путь}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(тело),
    }).then((r) => r.json());

  const первый = await шаг("/api/auth/login", { login, password: pass });
  if (первый.accessToken) return первый.accessToken;
  if (первый.pending !== "email") return null;

  const второй = await шаг("/api/auth/login/confirm", { ticket: первый.ticket, code });
  return второй.accessToken ?? null;
}

module.exports = { КОД, войтиВСтранице, войтиСнаружи };
