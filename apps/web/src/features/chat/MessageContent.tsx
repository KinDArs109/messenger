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
/**
 * Ссылки в тексте.
 *
 * Ищем только http и https — и ничего больше. Схема вроде javascript:
 * или data: в ссылке из чужого сообщения была бы дырой размером
 * с мессенджер, а не удобством; писать их никто и не пишет.
 *
 * Голый www.— тоже ссылка: так их и присылают, без «http» впереди.
 */
const LINKS = /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi;

/** Знаки, которые прилипли к концу ссылки, но ею не являются.
 *  «Смотри тут: пример.рф/страница.» — точка в конце принадлежит
 *  предложению, а не адресу. Скобку убираем только непарную:
 *  в адресах вики скобки — часть пути. */
function trimTail(url: string): string {
  let end = url.length;
  while (end > 0) {
    const ch = url[end - 1] ?? "";
    if (".,;:!?»\"'".includes(ch)) end -= 1;
    else if (ch === ")" && !url.slice(0, end).includes("(")) end -= 1;
    else break;
  }
  return url.slice(0, end);
}

type Part = string | { username: string } | { url: string };

/** Разбить кусок обычного текста на текст и ссылки. */
function splitLinks(text: string): Part[] {
  const out: Part[] = [];
  let cursor = 0;
  for (const match of text.matchAll(LINKS)) {
    const raw = trimTail(match[0]);
    if (!raw) continue;
    const start = match.index;
    if (start > cursor) out.push(text.slice(cursor, start));
    out.push({ url: raw });
    cursor = start + raw.length;
  }
  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

export function MessageContent({ content }: { content: string }) {
  const me = useStore((s) => s.me);
  const members = useStore((s) => s.members);

  const parts = useMemo(() => {
    const mentions = findMentions(content);

    const plain: Part[] = [];
    let cursor = 0;
    for (const mention of mentions) {
      if (mention.start > cursor) plain.push(content.slice(cursor, mention.start));
      plain.push({ username: mention.username });
      cursor = mention.end;
    }
    if (cursor < content.length) plain.push(content.slice(cursor));

    // Ссылки ищем только в том, что не оказалось упоминанием: иначе
    // «@user» внутри адреса разъехалось бы на две части.
    return plain.flatMap((part) => (typeof part === "string" ? splitLinks(part) : [part]));
  }, [content]);

  return (
    <>
      {parts.map((part, index) => {
        if (typeof part === "string") return <Fragment key={index}>{part}</Fragment>;

        if ("url" in part) {
          // href всегда со схемой: без неё браузер считает адрес
          // относительным и уводит внутрь мессенджера.
          const href = part.url.startsWith("www.") ? `https://${part.url}` : part.url;
          return (
            <a
              key={index}
              href={href}
              target="_blank"
              // noreferrer вместе с noopener: чужая страница не должна
              // ни получить управление нашим окном, ни узнать, откуда
              // пришли. В оболочке ссылка и вовсе уходит в системный
              // браузер — внутри окна без адресной строки чужому сайту
              // делать нечего.
              rel="noreferrer noopener"
              className="text-link underline decoration-link/40 underline-offset-2 hover:decoration-link"
            >
              {part.url}
            </a>
          );
        }

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
