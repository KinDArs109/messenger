import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/** Заглушка на месте ещё не пришедших данных.
 *
 *  Не спиннер: спиннер сообщает «идёт загрузка», а скелет вдобавок
 *  показывает, что именно грузится и сколько места это займёт. Из-за
 *  этого лента не прыгает в момент подстановки настоящих данных. */
export function Skeleton({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div style={style} className={cn("animate-pulse rounded-md bg-raised/60", className)} />;
}

/** Скелет ленты сообщений. Ширины строк намеренно разные и заданы
 *  списком, а не случайные: случайные менялись бы на каждой
 *  перерисовке, и заглушка дрожала бы. */
const LINES = ["72%", "45%", "88%", "60%", "35%", "78%", "52%", "66%"];

export function MessagesSkeleton() {
  return (
    <div className="flex flex-col gap-5 px-4 py-6">
      {LINES.map((width, index) => (
        <div key={index} className="flex gap-4">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3.5" style={{ width }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChannelsSkeleton() {
  return (
    <div className="space-y-1.5 px-2 py-3">
      {[68, 52, 80, 44, 60].map((width, index) => (
        <div key={index} className="flex items-center gap-2 px-2 py-1.5">
          <Skeleton className="size-4 shrink-0 rounded" />
          <Skeleton className="h-3 rounded" style={{ width: `${width}%` }} />
        </div>
      ))}
    </div>
  );
}
