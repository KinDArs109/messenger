/** Access-токен живёт только в памяти модуля.
 *
 *  В localStorage его класть нельзя: любой XSS читает localStorage
 *  одной строкой. Плата за это — при обновлении страницы токена нет,
 *  и его приходится получать заново по refresh-cookie. Обмен честный:
 *  cookie помечена httpOnly, до неё скрипты не дотягиваются. */
let accessToken: string | null = null;

export const setAccessToken = (token: string | null): void => {
  accessToken = token;
};
export const getAccessToken = (): string | null => accessToken;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface Options {
  method?: string;
  body?: unknown;
}

/** Сеть недоступна — это не то же самое, что ошибка от сервера.
 *  Различать важно: в первом случае помогает «повторить», во втором
 *  обычно нет. */
export class NetworkError extends Error {
  constructor() {
    super("Сервер не отвечает. Проверьте, запущен ли он.");
    this.name = "NetworkError";
  }
}

async function refreshSession(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST" });
    if (!res.ok) return false;
    const data = (await res.json()) as { accessToken: string };
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

/** Одно обновление на всех: если пять запросов одновременно получили
 *  401, обновляем сессию один раз, а не пять. Иначе первый же ответ
 *  отзовёт токен, которым в этот момент пользуются остальные, — и все
 *  разлогинятся при том, что сессия была живой. */
let refreshing: Promise<boolean> | null = null;

function refreshOnce(): Promise<boolean> {
  refreshing ??= refreshSession().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function request<T>(path: string, options: Options = {}, retry = true): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new NetworkError();
  }

  if (res.status === 401 && retry && !path.startsWith("/auth/")) {
    if (await refreshOnce()) return request<T>(path, options, false);
  }

  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    const error = (data as { error?: { code: string; message: string; fields?: Record<string, string> } })?.error;
    const code = error?.code ?? "UNKNOWN";

    // Непредвиденную ошибку сервера показывать человеку дословно
    // нельзя: в режиме разработки туда попадают пути к файлам и куски
    // исходного кода. Подробности — в консоль, на экран — по-русски.
    if (code === "INTERNAL_ERROR" || code === "UNKNOWN") {
      console.error(`[${code}] ${error?.message ?? res.status}`);
      throw new ApiError(code, "Что-то пошло не так на сервере. Подробности в консоли.");
    }

    throw new ApiError(code, error?.message ?? `Ошибка ${res.status}`, error?.fields);
  }

  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  /** Восстановление сессии после перезагрузки страницы. */
  restore: refreshOnce,
};
