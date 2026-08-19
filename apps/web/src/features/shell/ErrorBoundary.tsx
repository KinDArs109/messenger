import { Component, type ErrorInfo, type ReactNode } from "react";
import { RotateCw } from "lucide-react";

/**
 * Последний рубеж: показать что-нибудь вместо пустого экрана.
 *
 * Любая необработанная ошибка в отрисовке размонтирует всё дерево,
 * и человек видит ровный серый прямоугольник — тот самый «серый экран»,
 * который лечится перезагрузкой. Хуже него только серый экран без
 * объяснений: непонятно, сломалось ли приложение, кончился ли интернет
 * или это надолго.
 *
 * Границу ошибок нельзя сделать хуком — React даёт её только классам.
 */
interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // В консоль — полностью: человеку показываем короткое, а разбирать
    // потом придётся по стеку.
    console.error("Приложение упало:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-chat p-6 text-center">
        <h1 className="text-xl font-semibold text-bright">Приложение сломалось</h1>
        <p className="max-w-[420px] text-sm text-muted">
          Обычно помогает перезагрузка — переписка и настройки от этого не теряются.
        </p>
        <button
          onClick={() => location.reload()}
          className="flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-white hover:bg-accent-hover"
        >
          <RotateCw className="size-4" />
          Перезагрузить
        </button>
        {/* Текст ошибки мелким шрифтом: обычному человеку он не нужен,
            но именно его перешлют, когда придут жаловаться. */}
        <p className="max-w-[520px] font-mono text-[11px] break-words text-faint">
          {error.message}
        </p>
      </div>
    );
  }
}
