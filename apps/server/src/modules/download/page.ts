/**
 * Страница скачивания.
 *
 * Отдельный HTML, а не экран внутри клиента: сюда приходит человек,
 * у которого приложения ещё нет, и заставлять его сначала загрузить
 * всё React-приложение ради одной кнопки — плохой обмен. Страница
 * весит пару килобайт и открывается мгновенно даже на телефоне.
 *
 * Скриптов нет ни одного: политика безопасности запрещает встроенные,
 * а ради двух ссылок подключать отдельный файл незачем.
 */

const size = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} МБ`;

/**
 * Ссылка «войти в приложение».
 *
 * С меткой, а не просто «/»: теперь на корне у новичка стоит эта же
 * страница, и без метки кнопка «Открыть в браузере» возвращала бы
 * человека на неё саму — по кругу. Метка говорит серверу отдать
 * приложение, а приложение по ней же запоминает выбор, чтобы больше
 * не спрашивать.
 */
export const ENTER = "/?app=1";

/**
 * Строка под кнопками.
 *
 * У каждой системы она своя. Общая была бы либо водой, либо
 * предупреждением про Windows человеку с телефоном в руках.
 */
function note(
  device: "windows" | "android" | "ios" | "other",
  { setup, portable, android }: Builds,
): string {
  if (device === "ios") {
    return `<b>На айфоне отдельного приложения нет.</b> Откройте в браузере и нажмите
      «Поделиться» → «На экран „Домой“»: мессенджер откроется своим окном, без адресной
      строки, и будет вести себя как обычное приложение.`;
  }

  if (device === "android") {
    return android === null
      ? `<b>Приложение для Android ещё не собрано.</b> Пока откройте мессенджер в браузере —
         он работает так же.`
      : `<b>Android переспросит, ставить ли файл не из магазина.</b> Разрешите установку
         из браузера — приложение подписано нашим ключом.
         ${setup !== null ? `Для компьютера есть <a href="/download/setup">версия под Windows</a>.` : ""}`;
  }

  if (setup === null && portable === null) {
    return android === null
      ? `<b>Установщик ещё не собран.</b> Пока откройте мессенджер в браузере — он работает так же.`
      : `<b>Установщик для Windows ещё не собран.</b> Для телефона есть
         <a href="/download/android">приложение под Android</a>, а в браузере мессенджер
         работает и без установки.`;
  }

  return `<b>Windows предупредит, что издатель неизвестен.</b> Нажмите «Подробнее» → «Выполнить
     в любом случае»: файл не подписан, сертификат разработчика стоит десятки тысяч рублей
     в год.
     ${portable !== null ? `Есть и <a href="/download/portable">версия без установки</a> (${size(portable)}), но запускается она дольше.` : ""}
     ${android !== null ? `Для телефона — <a href="/download/android">приложение под Android</a>.` : ""}`;
}

export type Builds = {
  setup: number | null;
  portable: number | null;
  android: number | null;
};

export function downloadPage(
  builds: Builds,
  /** С чего пришли. Телефону нечего делать с установщиком для Windows,
   *  а компьютеру — с apk; главной кнопкой ставим ту, которая человеку
   *  подходит, остальные не прячем. */
  device: "windows" | "android" | "ios" | "other" = "other",
  /** На корне это лицо сервиса, а не страница скачивания: там
   *  предлагают и приложение, и работу в браузере, и «— скачать»
   *  в заголовке вкладки обещало бы только половину. */
  title = "Мессенджер — скачать",
): string {
  const { setup: setupBytes, portable: portableBytes, android: androidBytes } = builds;

  // Что предложить главной кнопкой. На айфоне приложения нет вовсе —
  // там главной становится «Открыть в браузере», и это честно: iOS
  // умеет ставить сайт на домашний экран сама.
  const install =
    device === "android" && androidBytes !== null
      ? `<a class="btn primary" href="/download/android">Установить на Android <span class="size">${size(androidBytes)}</span></a>`
      : device !== "android" && device !== "ios" && setupBytes !== null
        ? `<a class="btn primary" href="/download/setup">Скачать для Windows <span class="size">${size(setupBytes)}</span></a>`
        : "";


  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="Мессенджер для своих: серверы, каналы, личные сообщения и голос.">
<link rel="icon" href="/icon-192.png">
<style>
  /* Цвета те же, что в самом приложении: страница должна выглядеть
     его частью, а не отдельным сайтом про него. */
  :root {
    --bg: #0b0c0e;
    --panel: #101114;
    --raised: #24262b;
    --line: #2a2d33;
    --text: #d3d6db;
    --bright: #e6e7ea;
    --muted: #9aa0a8;
    --faint: #7c828b;
    --accent: #3576c0;
    --accent-hover: #2c63a4;
    --online: #4bb54b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 32px 20px 48px;
    background: var(--bg);
    color: var(--text);
    font: 16px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif;
    /* Мягкое пятно за героем — единственное украшение на странице.
       Оно же не даёт большому тёмному полю выглядеть пустым. */
    background-image: radial-gradient(60% 50% at 50% 0%, #3576c024, transparent 70%);
  }
  main { width: 100%; max-width: 560px; text-align: center; }
  .mark {
    width: 72px; height: 72px; margin: 0 auto 28px;
    color: var(--accent);
  }
  h1 {
    margin: 0 0 12px;
    font-size: clamp(28px, 6vw, 40px);
    line-height: 1.15;
    letter-spacing: -0.02em;
    color: var(--bright);
  }
  .lead { margin: 0 auto 32px; max-width: 420px; color: var(--muted); }
  .actions { display: flex; flex-direction: column; gap: 12px; align-items: stretch; }
  @media (min-width: 480px) { .actions { flex-direction: row; justify-content: center; } }
  a.btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 10px;
    padding: 14px 26px; border-radius: 10px;
    font-weight: 600; text-decoration: none;
    transition: background-color .15s, transform .06s;
  }
  a.btn:active { transform: scale(.985); }
  .primary { background: var(--accent); color: #fff; }
  .primary:hover { background: var(--accent-hover); }
  .secondary { background: var(--raised); color: var(--bright); }
  .secondary:hover { background: #43464e; }
  .size { font-weight: 400; opacity: .75; font-size: 14px; }
  .features {
    margin: 44px 0 0; padding: 0; list-style: none;
    display: grid; gap: 14px; text-align: left;
  }
  @media (min-width: 560px) { .features { grid-template-columns: repeat(3, 1fr); } }
  .features li {
    background: var(--panel); border: 1px solid var(--line);
    border-radius: 10px; padding: 14px 16px;
  }
  /* balance не даёт заголовку из трёх слов оставить одно на второй
     строке — иначе карточки выглядят рваными. */
  .features b {
    display: block; color: var(--bright); font-size: 15px;
    margin-bottom: 3px; text-wrap: balance;
  }
  .features span { color: var(--faint); font-size: 13px; line-height: 1.45; }
  .note {
    margin: 32px auto 0; max-width: 460px;
    color: var(--faint); font-size: 13px; line-height: 1.6;
  }
  .note b { color: var(--muted); font-weight: 600; }
  /* Ссылка внутри примечания — не системная синяя: на тёмном фоне
     она бьёт по глазам и тянет внимание с главной кнопки. */
  .note a { color: var(--text); text-underline-offset: 2px; }
  .note a:hover { color: var(--bright); }
</style>
</head>
<body>
<main>
  <svg class="mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
    <path d="M10 8h28a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H22l-10 8v-8h-2a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4Z"
          stroke="currentColor" stroke-width="2.5" stroke-linejoin="round"/>
    <circle cx="17" cy="21" r="2.2" fill="currentColor"/>
    <circle cx="24" cy="21" r="2.2" fill="currentColor"/>
    <circle cx="31" cy="21" r="2.2" fill="currentColor"/>
  </svg>

  <h1>Мессенджер для СВОих</h1>
  <p class="lead">
    Серверы с каналами, личные переписки, файлы и разговор голосом.
    Для своих, без лишних глаз.
  </p>

  <div class="actions">
    ${install}
    <a class="btn ${install ? "secondary" : "primary"}" href="${ENTER}">Открыть в браузере</a>
  </div>

  <ul class="features">
    <li><b>Только свои</b><span>Закрытый круг: никакой ленты, рекламы и посторонних.</span></li>
    <li><b>Голос напрямую</b><span>Звук идёт между собеседниками, минуя посредников.</span></li>
    <li><b>Без установки тоже</b><span>Работает в браузере — приложение нужно не всем.</span></li>
  </ul>

  <p class="note">
    ${note(device, builds)}
  </p>

  <!-- Подвала нет. Раньше там стояла строка про то, где всё это
       работает, — но страница открыта в интернете, и устройство
       сервиса посторонним знать незачем. Повторять же заголовок
       ради симметрии — пустая строка на экране. -->
</main>
</body>
</html>`;
}
