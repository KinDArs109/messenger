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

export function downloadPage(setupBytes: number | null, portableBytes: number | null): string {
  const ready = setupBytes !== null || portableBytes !== null;

  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Мессенджер — скачать</title>
<meta name="description" content="Мессенджер для своих: серверы, каналы, личные сообщения и голос.">
<link rel="icon" href="/icon-192.png">
<style>
  /* Цвета те же, что в самом приложении: страница должна выглядеть
     его частью, а не отдельным сайтом про него. */
  :root {
    --bg: #1e1f22;
    --panel: #2b2d31;
    --raised: #383a40;
    --line: #3f4147;
    --text: #dbdee1;
    --bright: #f2f3f5;
    --muted: #949ba4;
    --faint: #80848e;
    --accent: #5865f2;
    --accent-hover: #4752c4;
    --online: #23a55a;
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
    background-image: radial-gradient(60% 50% at 50% 0%, #5865f21f, transparent 70%);
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
    ${
      setupBytes !== null
        ? `<a class="btn primary" href="/download/setup">Скачать для Windows <span class="size">${size(setupBytes)}</span></a>`
        : ""
    }
    <a class="btn secondary" href="/">Открыть в браузере</a>
  </div>

  <ul class="features">
    <li><b>Только свои</b><span>Закрытый круг: никакой ленты, рекламы и посторонних.</span></li>
    <li><b>Голос напрямую</b><span>Звук идёт между собеседниками, минуя посредников.</span></li>
    <li><b>Без установки тоже</b><span>Работает в браузере — приложение нужно не всем.</span></li>
  </ul>

  <p class="note">
    ${
      ready
        ? `<b>Windows предупредит, что издатель неизвестен.</b> Нажмите «Подробнее» → «Выполнить
           в любом случае»: файл не подписан, сертификат разработчика стоит десятки тысяч рублей
           в год. ${portableBytes !== null ? `Есть и <a href="/download/portable">версия без установки</a> (${size(portableBytes)}), но запускается она дольше.` : ""}`
        : `<b>Установщик ещё не собран.</b> Пока откройте мессенджер в браузере — он работает так же.`
    }
  </p>

  <!-- Подвала нет. Раньше там стояла строка про то, где всё это
       работает, — но страница открыта в интернете, и устройство
       сервиса посторонним знать незачем. Повторять же заголовок
       ради симметрии — пустая строка на экране. -->
</main>
</body>
</html>`;
}
