import { useEffect, useRef } from "react";
import { desktop } from "@/lib/desktop";
import { gameName } from "@/lib/games";
import { getPreferences, setPreference } from "@/lib/preferences";
import { rememberGame } from "@/lib/gameAlerts";
import { getSocket } from "@/lib/socket";
import { useStore } from "@/lib/store";

/**
 * «Играет в Rust» — своё и чужое.
 *
 * Запущенную игру видит только оболочка на компьютере: браузер списка
 * программ не видит и увидеть не может. Оболочка присылает сюда имя
 * файла, здесь оно превращается в человеческое название и уходит
 * на сервер, а сервер разносит его тем, кому есть дело.
 *
 * Что считать игрой, решают вместе список известных игр и настройки:
 * известное узнаётся само, остальное человек отмечает руками. Гадать
 * по «тяжёлая программа в полный экран» можно, но ошибаться такая
 * догадка будет на браузере с роликом, а рассказывать друзьям, что вы
 * «играете в Chrome», — плохо.
 */
export function usePlaying(): void {
  /** Что оболочка сказала последним. Нужно после обрыва связи:
   *  сервер держит «кто во что играет» в памяти и теряет это, когда
   *  человек уходит из сети или когда его самого перезапускают. */
  const last = useRef<string | null>(null);
  const connected = useStore((s) => s.connected);

  useEffect(() => {
    const bridge = desktop();
    if (!bridge?.onGame) return;

    return bridge.onGame((exe) => {
      last.current = exe;
      send(exe);
    });
  }, []);

  useEffect(() => {
    if (!connected) return;
    const bridge = desktop();
    if (!bridge?.onGame) return;

    /*
     * Связь поднялась заново — рассказать всё сначала.
     *
     * Оболочка говорит только про перемены: запустилась игра, закрылась
     * игра. Пока идёт одна и та же, она молчит — и правильно делает.
     * А вот сервер за это время мог перезапуститься или посчитать
     * человека ушедшим из сети, и «играет в Rust» пропадало у друзей
     * до тех пор, пока игру не закроют и не откроют снова.
     *
     * Спрашиваем и саму оболочку: страницу могли перезагрузить, и тогда
     * здесь не помнят ничего, а там игра как шла, так и идёт. Старые
     * оболочки такого вопроса не знают — обходимся памятью.
     */
    void Promise.resolve(bridge.currentGame?.() ?? last.current).then((exe) => {
      if (!exe) return;
      last.current = exe;
      send(exe);
    });
  }, [connected]);
}

/** Сказать серверу, во что играем. Название берём то, что человек
 *  видел, когда отмечал игру, иначе — из списка известных. */
function send(exe: string | null): void {
  const socket = getSocket();
  if (!socket) return;

  if (!exe) {
    socket.emit("presence:playing", { game: null });
    return;
  }

  const name = gameName(exe, getPreferences().gameNames);
  // Заодно запоминаем игру себе: по этому списку решается, будить ли
  // нас, когда её запустит друг.
  setPreference("myGames", rememberGame(getPreferences().myGames, name));
  socket.emit("presence:playing", { game: name });
}

/** Во что играет человек. null — ни во что или мы не знаем. */
export function usePlayingOf(userId: string | undefined): string | null {
  const games = useStore((s) => s.games);
  return userId ? (games.get(userId) ?? null) : null;
}
