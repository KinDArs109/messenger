import { LIMITS } from "@messenger/shared";
import { getAccessToken } from "./api";
import { formatBytes } from "./utils";

/** Загрузка аватара или значка сервера.
 *
 *  Отдельно от вложений: сервер обрезает картинку в квадрат и
 *  уменьшает, а в ответ отдаёт только ссылку — ни записи в ленте,
 *  ни имени файла здесь не нужно.
 *
 *  Обычным fetch, а не обёрткой api: та ставит Content-Type
 *  application/json, а для multipart его должен выставить браузер
 *  сам — вместе с границей частей. */
export async function uploadPicture(file: File): Promise<string> {
  if (file.size > LIMITS.uploadBytes) {
    throw new Error(`Картинка больше ${formatBytes(LIMITS.uploadBytes)}`);
  }

  const body = new FormData();
  body.append("file", file);

  const res = await fetch("/api/uploads/picture", {
    method: "POST",
    headers: { Authorization: `Bearer ${getAccessToken() ?? ""}` },
    body,
  });

  const data = (await res.json().catch(() => null)) as
    | { url: string }
    | { error: { message: string } }
    | null;

  if (!res.ok || !data || !("url" in data)) {
    throw new Error(
      data && "error" in data ? data.error.message : "Не удалось загрузить картинку",
    );
  }
  return data.url;
}
