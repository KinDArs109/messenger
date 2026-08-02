import { motion } from "motion/react";

/** Экран первой загрузки.
 *
 *  Показывается, пока восстанавливается сессия по cookie. Это почти
 *  всегда доли секунды, но без заставки момент выглядит как пустой
 *  чёрный экран, и на медленной сети — как поломка.
 *
 *  Знак рисуется линией (pathLength), а не появляется целиком:
 *  движение занимает ровно то время, которое всё равно приходится
 *  ждать, и превращает паузу в часть приложения. */
export function Splash({ label = "Загружаем…" }: { label?: string }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-7 bg-chat">
      <div className="relative flex size-28 items-center justify-center">
        {/* Два расходящихся кольца. Второе отстаёт на треть цикла —
            получается непрерывная волна, а не пульс в один такт. */}
        {[0, 1].map((index) => (
          <motion.span
            key={index}
            className="absolute inset-0 rounded-full border border-accent/40"
            initial={{ scale: 0.55, opacity: 0.55 }}
            animate={{ scale: 1.15, opacity: 0 }}
            transition={{
              duration: 2.1,
              repeat: Infinity,
              ease: "easeOut",
              delay: index * 0.7,
            }}
          />
        ))}

        <motion.svg
          viewBox="0 0 48 48"
          className="size-14 text-accent"
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4, ease: [0.2, 0, 0.2, 1] }}
        >
          <motion.path
            d="M10 8h28a4 4 0 0 1 4 4v18a4 4 0 0 1-4 4H22l-10 8v-8h-2a4 4 0 0 1-4-4V12a4 4 0 0 1 4-4Z"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinejoin="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 1.1, ease: "easeInOut" }}
          />
          {/* Три точки внутри — «печатает». Появляются после того,
              как контур дорисован. */}
          {[17, 24, 31].map((cx, index) => (
            <motion.circle
              key={cx}
              cx={cx}
              cy={21}
              r={2.2}
              fill="currentColor"
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: [0, 1, 0.25], y: 0 }}
              transition={{
                duration: 1.2,
                repeat: Infinity,
                delay: 1 + index * 0.16,
                ease: "easeInOut",
              }}
            />
          ))}
        </motion.svg>
      </div>

      <div className="flex flex-col items-center gap-3">
        <motion.p
          className="text-sm text-muted"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5, duration: 0.35 }}
        >
          {label}
        </motion.p>

        {/* Полоса без процентов: настоящего прогресса у восстановления
            сессии нет, а рисовать выдуманный — врать пользователю. */}
        <div className="h-0.5 w-40 overflow-hidden rounded-full bg-raised">
          <motion.div
            className="h-full w-1/3 rounded-full bg-accent"
            animate={{ x: ["-120%", "360%"] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>
    </div>
  );
}
