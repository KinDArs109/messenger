import type { ReactNode } from "react";

/**
 * Раздел настроек: заголовок и черта над ним.
 *
 * Отдельным файлом, потому что нужен и в SettingsDialog, и в VoiceTab,
 * а второй импортируется первым — положи он его у себя, получилось бы
 * кольцо импортов.
 *
 * Заголовок крупнее и ярче подписей у полей. Когда они одного веса,
 * вкладка читается как одна длинная простыня без начала и конца:
 * глазу не за что зацепиться, и кажется, что настройки свалены как
 * попало, даже если порядок в них есть.
 */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-line pt-4 first:border-0 first:pt-0">
      <h4 className="mb-3 text-sm font-semibold text-bright">{title}</h4>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
