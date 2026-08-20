/*
 * Что проверяем в панели — сценарий для check-panel.cjs.
 *
 * Живёт отдельным файлом, а не строкой внутри проверки: это обычный
 * код, и читать его надо как код, а не как текст в кавычках.
 *
 * Разговор с сервером подменён: сервера здесь нет, а проверять надо
 * не его, а панель — что она перечитывает сама, не мигает попусту,
 * продлевает вход и честно говорит, когда дверь закрылась.
 */
(async () => {
  const итог = [];
  const шаг = (что, вышло) => итог.push({ что, вышло: Boolean(вышло) });

  /** Токен с нужным сроком: панели важна только открытая часть. */
  const свежий = (сек) =>
    "a." +
    btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + сек })).replace(/=/g, "") +
    ".b";

  const пусто = { регистрация: { поКоду: false }, люди: [], серверы: [], приглашения: [] };
  const кто = (имя) => ({
    id: имя,
    username: имя,
    displayName: имя,
    email: имя + "@example.invalid",
    почтаПодтверждена: true,
    кодыВключены: false,
    создан: new Date().toISOString(),
    сообщений: 0,
    серверов: 0,
    участвует: 0,
    последнийВход: null,
    откуда: null,
  });

  let хозяйство = JSON.parse(JSON.stringify(пусто));
  let звали = [];
  let закрыта = false;
  let обрыв = false;

  запрос = async (путь) => {
    звали.push(путь);
    if (обрыв) throw new TypeError("Failed to fetch");
    if (закрыта && путь !== "/admin/session") throw new Error("Раздел не найден");
    if (путь === "/admin/overview") return JSON.parse(JSON.stringify(хозяйство));
    if (путь === "/admin/online") return { вСети: [] };
    if (путь === "/admin/session/renew")
      return { accessToken: свежий(600), дверьДо: Date.now() + 900000 };
    if (путь === "/admin/session") return { ticket: "билет" };
    return {};
  };

  дверь = "пропуск";
  дверьДо = Date.now() + 900000;
  токен = свежий(600);
  данные = хозяйство;
  слепок = "";
  сказано = null;
  вСвязи = true;

  await перечитать(true);

  /* 1. Пустой такт не должен перерисовывать: панель — это одна большая
   *    перерисовка, и делать её впустую значит дёргать список под рукой. */
  const метка = document.createElement("i");
  метка.id = "метка";
  корень.append(метка);
  await поддержать();
  шаг("без изменений панель не перерисовывается", document.getElementById("метка"));

  /* 2. Появился человек — панель узнала об этом сама. */
  хозяйство.люди = [кто("novichok")];
  await поддержать();
  шаг("новый человек появляется сам", document.body.innerText.includes("novichok"));

  /* 3. И исчез — тоже сам. Ради этого всё и делалось. */
  хозяйство.люди = [];
  await поддержать();
  шаг("удалённый исчезает сам, без кнопки", !document.body.innerText.includes("novichok"));

  /* 4. Место прокрутки при перерисовке остаётся на месте. */
  хозяйство.люди = Array.from({ length: 40 }, (_, i) => кто("kto" + i));
  await поддержать();
  window.scrollTo(0, 400);
  const где = window.scrollY;
  хозяйство.люди = Array.from({ length: 41 }, (_, i) => кто("kto" + i));
  await поддержать();
  шаг("прокрутка не прыгает наверх", где > 0 && window.scrollY === где);

  /* 5. Вход продлевается сам, пока дверь открыта. */
  токен = свежий(30);
  звали = [];
  await поддержать();
  шаг("вход продлевается сам", звали.includes("/admin/session/renew"));

  /* 6. И не дёргается зря. */
  звали = [];
  await поддержать();
  шаг("пока токен свежий, продлевать нечего", !звали.includes("/admin/session/renew"));

  /* 7. Свёрнутое окно сервер не дёргает. */
  Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
  звали = [];
  await поддержать();
  шаг("спрятанное окно молчит", звали.length === 0);
  Object.defineProperty(document, "hidden", { configurable: true, get: () => false });

  /* 8. Обрыв связи — не повод разбирать панель. */
  обрыв = true;
  await поддержать();
  шаг(
    "нет связи — сказано в шапке, панель на месте",
    document.getElementById("живое").innerText.trim() === "нет связи" &&
      document.body.innerText.includes("Хозяйство"),
  );

  обрыв = false;
  await поддержать();
  шаг("связь вернулась — снова живое", document.getElementById("живое").innerText.trim() === "живое");

  /* 9. Полчаса прошло. Дверь закрылась — это не «войдите заново». */
  закрыта = true;
  await поддержать();
  await new Promise((готово) => setTimeout(готово, 50));
  шаг(
    "закрытая дверь просит новый код, а не пароль",
    document.body.innerText.includes("Код из Телеграма") &&
      document.body.innerText.includes("дверь закрылась"),
  );
  шаг("и часы при этом остановлены", часы === null);

  return итог;
})();
