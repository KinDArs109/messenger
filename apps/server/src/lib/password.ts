import { hash, verify } from "@node-rs/argon2";

/** Argon2id — текущая рекомендация для хеширования паролей.
 *  Пакет @node-rs поставляется собранным, поэтому на Windows
 *  не требует Visual Studio Build Tools, в отличие от классического
 *  argon2 на node-gyp.
 *
 *  Параметры — базовый профиль OWASP: 19 МиБ памяти, 2 прохода. */
const options = {
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, options);
}

export async function verifyPassword(
  storedHash: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plain, options);
  } catch {
    // Битый или чужого формата хеш — это не совпадение, а не падение.
    return false;
  }
}
