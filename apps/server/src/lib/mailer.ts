import { createTransport, type Transporter } from "nodemailer";
import { env } from "../config/env.js";

/**
 * Отправка почты.
 *
 * Настройки необязательны: пока SMTP не заполнен, мессенджер работает
 * как раньше, просто без писем. Обязательными их делать нельзя —
 * забытая строка в .env валила бы сервер вместе со всей перепиской
 * ради функции, без которой можно жить.
 */

let transport: Transporter | null = null;

/** Заголовок From собираем сами.
 *
 *  MAIL_FROM в .env — просто адрес: имя отправителя туда вписывать
 *  не надо, потому что формат `Имя <адрес@почта>` легко испортить
 *  одной потерянной скобкой, и письмо уйдёт с битым заголовком либо
 *  не уйдёт вовсе. Имя добавляем здесь, где оно под контролем. */
function fromHeader(): string {
  const raw = (env.MAIL_FROM ?? env.SMTP_USER ?? "").trim();
  // На случай, если адрес всё-таки записали вместе с именем.
  const address = /<([^>]+)>/.exec(raw)?.[1] ?? raw.split(/\s+/).pop() ?? raw;
  return `"Мессенджер" <${address}>`;
}

export function isMailEnabled(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

function getTransport(): Transporter | null {
  if (!isMailEnabled()) return null;
  transport ??= createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 — это SMTPS: шифрование начинается сразу, без STARTTLS.
    // Яндекс принимает почту именно так.
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
  });
  return transport;
}

/** Письмо с кодом подтверждения.
 *
 *  Ошибку не пробрасываем наверх: недоступный почтовый сервер не
 *  должен ронять регистрацию. Человек уже создал учётную запись,
 *  и правильная реакция — дать ему кнопку «отправить ещё раз»,
 *  а не откатывать всё назад. */
export async function sendVerificationCode(to: string, code: string): Promise<boolean> {
  const mail = getTransport();
  if (!mail) {
    console.warn(`Почта не настроена — код для ${to}: ${code}`);
    return false;
  }

  try {
    await mail.sendMail({
      from: fromHeader(),
      to,
      subject: `Код подтверждения: ${code}`,
      text: [
        `Ваш код подтверждения: ${code}`,
        "",
        "Он действует 15 минут.",
        "Если вы не регистрировались в мессенджере — просто удалите это письмо.",
      ].join("\n"),
      html: `
        <div style="font-family:system-ui,Segoe UI,sans-serif;max-width:420px">
          <p style="color:#4b5563">Ваш код подтверждения:</p>
          <p style="font-size:32px;letter-spacing:6px;font-weight:700;margin:12px 0">${code}</p>
          <p style="color:#6b7280;font-size:14px">Он действует 15 минут.</p>
          <p style="color:#9ca3af;font-size:13px">
            Если вы не регистрировались в мессенджере — просто удалите это письмо.
          </p>
        </div>`,
    });
    return true;
  } catch (error) {
    console.error("Не удалось отправить письмо:", error);
    return false;
  }
}
