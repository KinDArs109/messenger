// Проверка: человек не пропадает вместе со страницей сервера.
//
//   npm run check:people -w @messenger/web
//
// Список участников живёт ровно столько, сколько открыт сервер. По
// нему же раньше узнавали имена тех, кто сидит в голосовом канале, —
// и стоило уйти на главную, как собеседник в окошке поверх игры
// превращался в «Участника» с серым кружком вместо лица.
//
// Проверять это глазами дорого: нужен разговор вдвоём и запущенная
// игра. Здесь то же самое, но за секунду и без второго человека.

import { useStore, findPerson, acquaintanceOf } from "../src/lib/store.js";
import type { FriendshipDto, MemberDto, PrivateUser, PublicUser } from "@messenger/shared";

let failed = false;
const ok = (s: string) => console.log(`  ✔ ${s}`);
const fail = (s: string) => {
  console.log(`  ✘ ПРОВАЛ: ${s}`);
  failed = true;
};

const человек = (id: string, имя: string): PublicUser => ({
  id,
  username: имя.toLowerCase(),
  displayName: имя,
  avatarUrl: null,
  status: "online",
});

const я: PrivateUser = {
  ...человек("01HZZZZZZZZZZZZZZZZZZZZZZ1", "Хозяин"),
  email: "x@example.com",
  emailVerified: true,
  chosenStatus: "online",
};

const друг = человек("01HZZZZZZZZZZZZZZZZZZZZZZ2", "Друг");
const сосед = человек("01HZZZZZZZZZZZZZZZZZZZZZZ3", "Сосед");
const чужой = человек("01HZZZZZZZZZZZZZZZZZZZZZZ4", "Чужой");

const участник = (u: PublicUser): MemberDto => ({ ...u, role: "MEMBER" });

const store = useStore.getState();

console.log("\nПамять о людях\n");

console.log("=== Ушли с сервера ===");

store.setMe(я);
store.setMembers([участник(друг), участник(сосед)]);

const наСервере = findPerson(useStore.getState(), сосед.id);
if (наСервере?.displayName === "Сосед") ok("на сервере участник находится");
else fail("участник не нашёлся даже на открытом сервере");

// Ровно то, что делает уход на главную: список участников очищается.
useStore.setState({ members: [], serverId: null });

const послеУхода = findPerson(useStore.getState(), сосед.id);
if (послеУхода?.displayName === "Сосед") ok("после ухода на главную он всё ещё известен");
else fail("после ухода с сервера участник потерялся — окошко покажет «Участник»");

const себя = findPerson(useStore.getState(), я.id);
if (себя?.displayName === "Хозяин") ok("себя находим всегда, даже с пустым списком");
else fail("себя не нашли");

const никто = findPerson(useStore.getState(), "01HZZZZZZZZZZZZZZZZZZZZZZ9");
if (никто === undefined) ok("незнакомого не выдумываем");
else fail("нашёлся человек, которого мы никогда не видели");

console.log("\n=== Свежесть сведений ===");

// Сменил имя и аватарку — берём новое, а не то, что запомнили год назад.
store.setMembers([участник({ ...сосед, displayName: "Сосед Новый", avatarUrl: "/uploads/x.webp" })]);
useStore.setState({ members: [] });
const обновлённый = findPerson(useStore.getState(), сосед.id);
if (обновлённый?.displayName === "Сосед Новый") ok("новое имя вытесняет старое");
else fail("память держит устаревшее имя");

// Открытый сервер важнее памяти: там сведения приехали только что.
useStore.setState({ members: [участник({ ...сосед, displayName: "Сосед С Сервера" })] });
if (findPerson(useStore.getState(), сосед.id)?.displayName === "Сосед С Сервера") {
  ok("открытый сервер важнее памяти");
} else {
  fail("память перебила список открытого сервера");
}

console.log("\n=== Лишних перерисовок нет ===");

useStore.setState({ members: [] });
const до = useStore.getState().known;
store.setMembers([участник(друг)]);
const после = useStore.getState().known;
if (до === после) ok("повторный тот же список карту не пересобирает");
else fail("карта пересобирается на ровном месте — перерисуется весь разговор");

console.log("\n=== Кто нам кто ===");

const дружба = (u: PublicUser, s: FriendshipDto["status"], d: FriendshipDto["direction"]): FriendshipDto => ({
  id: `f-${u.id}`,
  user: u,
  status: s,
  direction: d,
  createdAt: new Date(0).toISOString(),
});

// Пока список друзей не приехал — молчим: показать друга чужим даже
// на секунду хуже, чем не показать ничего.
useStore.setState({ friendships: [], friendsLoaded: false });
if (acquaintanceOf(useStore.getState(), друг.id) === "unknown") ok("до загрузки друзей никого не метим");
else fail("метка появилась раньше, чем список друзей");

store.setFriendships([
  дружба(друг, "ACCEPTED", "outgoing"),
  дружба(сосед, "PENDING", "incoming"),
]);

const проверка: [string, string, string][] = [
  ["друг", друг.id, "friend"],
  ["сосед со встречной заявкой", сосед.id, "incoming"],
  ["чужой", чужой.id, "stranger"],
  ["сам себе", я.id, "unknown"],
];

for (const [имя, id, ждём] of проверка) {
  const получили = acquaintanceOf(useStore.getState(), id);
  if (получили === ждём) ok(`${имя} → ${ждём}`);
  else fail(`${имя} → ожидалось «${ждём}», получено «${получили}»`);
}

// Заявку приняли — метка обязана уйти сама.
store.upsertFriendship(дружба(сосед, "ACCEPTED", "incoming"));
if (acquaintanceOf(useStore.getState(), сосед.id) === "friend") ok("принятая заявка снимает метку");
else fail("метка осталась на человеке, который уже друг");

console.log(failed ? "\nЕсть провалы\n" : "\nВсё сходится\n");
process.exit(failed ? 1 : 0);
