import type { MemberRole } from "./constants.js";

/** Все права проекта. Держим их в одном месте, а не размазываем
 *  проверки `if (role === "OWNER")` по обработчикам — иначе однажды
 *  забудете одну и получите дыру. */
export type Permission =
  | "server:edit"
  | "server:delete"
  | "channel:create"
  | "channel:edit"
  | "channel:delete"
  | "invite:create"
  | "member:kick"
  // Бан отдельно от кика: выгнать — это «уйди сейчас», забанить —
  // «не возвращайся». Второе тяжелее и не всякому, кто может первое,
  // стоит его доверять.
  | "member:ban"
  | "message:send"
  | "message:deleteAny";

const ROLE_PERMISSIONS: Record<MemberRole, readonly Permission[]> = {
  OWNER: [
    "server:edit",
    "server:delete",
    "channel:create",
    "channel:edit",
    "channel:delete",
    "invite:create",
    "member:kick",
    "member:ban",
    "message:send",
    "message:deleteAny",
  ],
  ADMIN: [
    "server:edit",
    "channel:create",
    "channel:edit",
    "channel:delete",
    "invite:create",
    "member:kick",
    "member:ban",
    "message:send",
    "message:deleteAny",
  ],
  MEMBER: ["invite:create", "message:send"],
};

export function can(role: MemberRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Кикать можно только тех, кто ниже по роли. Владельца — никогда. */
export function canActOn(actor: MemberRole, target: MemberRole): boolean {
  const rank: Record<MemberRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };
  return rank[actor] > rank[target];
}
