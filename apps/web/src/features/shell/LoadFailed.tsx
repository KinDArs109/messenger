import { useState } from "react";
import { Loader2, RefreshCw, ServerCrash } from "lucide-react";

/** Экран, когда данные не загрузились.
 *
 *  Раньше на его месте показывалось приветствие «вы пока никуда
 *  не вступили» — то есть сбой выглядел как пустой аккаунт. Это хуже
 *  ошибки: человек решает, что данные пропали, а не что связь отпала. */
export function LoadFailed({ onRetry }: { onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false);

  async function retry() {
    setRetrying(true);
    await onRetry();
    setRetrying(false);
  }

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-[420px] text-center">
        <ServerCrash className="mx-auto mb-4 size-16 text-danger" />

        <h1 className="text-xl font-semibold text-bright">Не удалось загрузить данные</h1>
        <p className="mt-2 mb-1 text-muted">
          Серверы и переписки на месте — до них просто не достучаться.
        </p>
        <p className="mb-6 text-sm text-faint">
          Проверьте, запущен ли сервер и есть ли связь с базой. Подробности — в консоли
          браузера.
        </p>

        <button
          onClick={() => void retry()}
          disabled={retrying}
          className="mx-auto flex items-center gap-2 rounded-sm bg-accent px-6 py-2.5 font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {retrying ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4" />
          )}
          {retrying ? "Пробую…" : "Попробовать снова"}
        </button>
      </div>
    </div>
  );
}
