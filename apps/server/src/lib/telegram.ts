import { env } from "../config/env.js";

/**
 * Сообщения хозяину в Телеграм.
 *
 * Тот же бот, что и у сторожа: заводить второго ради двух сообщений
 * в месяц незачем, а один разговор с одним ботом — это одно место,
 * куда смотреть.
 *
 * Здесь нарочно нет ничего, кроме отправки. Кому и что писать —
 * решают те, кто зовёт: сторож пишет про поломки, хозяйский раздел —
 * про попытки в него войти.
 */

export function telegramReady(): boolean {
  return Boolean(env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT);
}

/**
 * Отправить и не уронить вызывающего.
 *
 * Ошибку наверх не пробрасываем: недоступный Телеграм не должен
 * ломать то, ради чего сообщение отправлялось. Но и молчать не будем —
 * в журнале это видно.
 */
export async function sendTelegram(text: string): Promise<boolean> {
  if (!telegramReady()) {
    console.warn(
      "Телеграм не настроен — сообщение не отправлено:",
      text.slice(0, 60),
    );
    return false;
  }

  try {
    const ответ = await fetch(
      `https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT, text }),
        // Ждать вечно нельзя: сообщение уходит по ходу запроса человека,
        // и зависший Телеграм не должен подвешивать его вместе с собой.
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!ответ.ok) {
      console.error(
        "Телеграм отказал:",
        ответ.status,
        (await ответ.text()).slice(0, 200),
      );
      return false;
    }
    return true;
  } catch (error) {
    console.error("Не удалось написать в Телеграм:", error);
    return false;
  }
}
