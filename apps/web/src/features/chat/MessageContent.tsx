import { Fragment, useMemo } from "react";
import { findMentions } from "@messenger/shared";
import { useStore } from "@/lib/store";

/** Текст сообщения с подсвеченными упоминаниями.
 *
 *  Разбор идёт по тому же правилу, что и на сервере — оно лежит
 *  в общем пакете. Иначе подсветка появлялась бы там, где счётчик
 *  не сработал, и наоборот.
 *
 *  Части складываем массивом React-узлов, а не строкой с разметкой:
 *  содержимое пришло от пользователя, и превращать его в HTML нельзя
 *  ни при каких обстоятельствах. */
export function MessageContent({ content }: { content: string }) {
  const me = useStore((s) => s.me);
  const members = useStore((s) => s.members);

  const parts = useMemo(() => {
    const mentions = findMentions(content);
    if (mentions.length === 0) return [content];

    const result: (string | { username: string })[] = [];
    let cursor = 0;
    for (const mention of mentions) {
      if (mention.start > cursor) result.push(content.slice(cursor, mention.start));
      result.push({ username: mention.username });
      cursor = mention.end;
    }
    if (cursor < content.length) result.push(content.slice(cursor));
    return result;
  }, [content]);

  return (
    <>
      {parts.map((part, index) => {
        if (typeof part === "string") return <Fragment key={index}>{part}</Fragment>;

        const isMe = me?.username === part.username;
        // Подсвечиваем только реально существующих участников:
        // иначе любое слово с собакой выглядело бы упоминанием.
        const known = isMe || members.some((m) => m.username === part.username);
        if (!known) return <Fragment key={index}>@{part.username}</Fragment>;

        return (
          <span
            key={index}
            className={
              isMe
                ? "rounded bg-accent/30 px-0.5 font-medium text-bright"
                : "rounded bg-accent/15 px-0.5 font-medium text-link"
            }
          >
            @{part.username}
          </span>
        );
      })}
    </>
  );
}
