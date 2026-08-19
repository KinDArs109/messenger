/**
 * Игры, которые узнаются сами.
 *
 * Раньше «играет в …» работало так: человек заходил в настройки,
 * запускал игру, находил её в списке запущенных программ и отмечал.
 * Пока он этого не сделал, друзья не видели ничего — а не сделал этого
 * никто, потому что об этом никто не знал.
 *
 * Честно определить «это игра» нельзя: в игру мы не встраиваемся,
 * а Windows сама не знает, что считать игрой. Гадать по «тяжёлая
 * программа в полный экран» тоже нельзя — так браузер с роликом
 * превращается в игру, и друзья читают, что вы играете в Chrome.
 *
 * Поэтому список. Он скучный, зато не врёт: раз имя файла совпало,
 * значит запущена именно эта игра. Своё в настройках никуда не делось
 * и работает поверх этого — для того, чего в списке нет.
 *
 * Имя файла слева — то, что видно в диспетчере задач; справа —
 * то, что увидят друзья.
 */
export const KNOWN_GAMES: Record<string, string> = {
  // ── Стрельба ────────────────────────────────────────────────────
  "cs2.exe": "Counter-Strike 2",
  "csgo.exe": "CS:GO",
  "valorant-win64-shipping.exe": "Valorant",
  "valorant.exe": "Valorant",
  "r5apex.exe": "Apex Legends",
  "r5apex_dx12.exe": "Apex Legends",
  "overwatch.exe": "Overwatch 2",
  "rainbowsix.exe": "Rainbow Six Siege",
  "rainbowsix_be.exe": "Rainbow Six Siege",
  "rainbowsix_vulkan.exe": "Rainbow Six Siege",
  "escapefromtarkov.exe": "Escape from Tarkov",
  "fortniteclient-win64-shipping.exe": "Fortnite",
  "tslgame.exe": "PUBG",
  "destiny2.exe": "Destiny 2",
  "helldivers2.exe": "Helldivers 2",
  "readyornot.exe": "Ready or Not",
  "squadgame.exe": "Squad",
  "huntgame.exe": "Hunt: Showdown",
  "deltaforceclient-win64-shipping.exe": "Delta Force",
  "thefinals.exe": "The Finals",
  "discovery.exe": "The Finals",
  "left4dead2.exe": "Left 4 Dead 2",
  "tf_win64.exe": "Team Fortress 2",
  "hl2.exe": "Half-Life 2",
  "portal2.exe": "Portal 2",
  "gmod.exe": "Garry's Mod",
  "project8.exe": "Deadlock",
  "marvel-win64-shipping.exe": "Marvel Rivals",
  "marvelrivals_launcher.exe": "Marvel Rivals",
  "bf2042.exe": "Battlefield 2042",
  "bf6.exe": "Battlefield 6",
  "bfv.exe": "Battlefield V",
  "bf1.exe": "Battlefield 1",
  "bf4.exe": "Battlefield 4",
  "cod.exe": "Call of Duty",
  "modernwarfare.exe": "Call of Duty",
  "blackopscoldwar.exe": "Call of Duty",
  "crossout.exe": "Crossout",
  "warframe.x64.exe": "Warframe",
  "naraka_x64.exe": "Naraka: Bladepoint",

  // ── Выживание и песочницы ───────────────────────────────────────
  "rustclient.exe": "Rust",
  "dayz_x64.exe": "DayZ",
  "valheim.exe": "Valheim",
  "vrising.exe": "V Rising",
  "enshrouded.exe": "Enshrouded",
  "corekeeper.exe": "Core Keeper",
  "7daystodie.exe": "7 Days to Die",
  "arkascended.exe": "ARK: Survival Ascended",
  "projectzomboid64.exe": "Project Zomboid",
  "subnautica.exe": "Subnautica",
  "raft.exe": "Raft",
  "nms.exe": "No Man's Sky",
  "palworld-win64-shipping.exe": "Palworld",
  "palworld.exe": "Palworld",
  "oncehuman.exe": "Once Human",
  "grounded.exe": "Grounded",
  "terraria.exe": "Terraria",
  "starbound.exe": "Starbound",
  "minecraft.windows.exe": "Minecraft",
  "minecraftlauncher.exe": "Minecraft",
  "tlauncher.exe": "Minecraft",
  "robloxplayerbeta.exe": "Roblox",
  "dontstarve_steam_x64.exe": "Don't Starve Together",
  "fsd-win64-shipping.exe": "Deep Rock Galactic",
  "factorygame-win64-shipping.exe": "Satisfactory",
  "factorio.exe": "Factorio",
  "rimworldwin64.exe": "RimWorld",
  "kenshi_x64.exe": "Kenshi",

  // ── Ужасы и кооператив на вечер ─────────────────────────────────
  "phasmophobia.exe": "Phasmophobia",
  "deadbydaylight-win64-shipping.exe": "Dead by Daylight",
  "lethal company.exe": "Lethal Company",
  "content warning.exe": "Content Warning",
  "repo.exe": "R.E.P.O.",
  "schedule i.exe": "Schedule I",
  "among us.exe": "Among Us",
  "amongus.exe": "Among Us",
  "fallguys_client_game.exe": "Fall Guys",
  "brawlhalla.exe": "Brawlhalla",
  "rocketleague.exe": "Rocket League",
  "it takes two.exe": "It Takes Two",

  // ── Большие одиночные ───────────────────────────────────────────
  "gta5.exe": "GTA V",
  "gta5_enhanced.exe": "GTA V",
  "fivem.exe": "GTA V (FiveM)",
  "ragemp_v.exe": "GTA V (RAGE:MP)",
  "samp.exe": "GTA: San Andreas",
  "rdr2.exe": "Red Dead Redemption 2",
  "cyberpunk2077.exe": "Cyberpunk 2077",
  "witcher3.exe": "The Witcher 3",
  "eldenring.exe": "Elden Ring",
  "nightreign.exe": "Elden Ring Nightreign",
  "darksoulsiii.exe": "Dark Souls III",
  "sekiro.exe": "Sekiro",
  "bg3.exe": "Baldur's Gate 3",
  "bg3_dx11.exe": "Baldur's Gate 3",
  "starfield.exe": "Starfield",
  "skyrimse.exe": "Skyrim",
  "tesv.exe": "Skyrim",
  "fallout4.exe": "Fallout 4",
  "fallout76.exe": "Fallout 76",
  "falloutnv.exe": "Fallout: New Vegas",
  "metroexodus.exe": "Metro Exodus",
  "atomicheart-win64-shipping.exe": "Atomic Heart",
  "stalker2-win64-shipping.exe": "S.T.A.L.K.E.R. 2",
  "xrengine.exe": "S.T.A.L.K.E.R.",
  "kingdomcome.exe": "Kingdom Come: Deliverance",
  "b1-win64-shipping.exe": "Black Myth: Wukong",
  "sandfall-win64-shipping.exe": "Clair Obscur: Expedition 33",
  "gow.exe": "God of War",
  "horizonzerodawn.exe": "Horizon Zero Dawn",
  "spider-man.exe": "Marvel's Spider-Man",
  "monsterhunterwilds.exe": "Monster Hunter Wilds",
  "monsterhunterworld.exe": "Monster Hunter: World",
  "monsterhunterrise.exe": "Monster Hunter Rise",
  "hogwartslegacy.exe": "Hogwarts Legacy",

  // ── Онлайн-миры и карточки ──────────────────────────────────────
  "wow.exe": "World of Warcraft",
  "wowclassic.exe": "World of Warcraft Classic",
  "diablo iv.exe": "Diablo IV",
  "hearthstone.exe": "Hearthstone",
  "league of legends.exe": "League of Legends",
  "leagueoflegends.exe": "League of Legends",
  "dota2.exe": "Dota 2",
  "pathofexile_x64.exe": "Path of Exile",
  "pathofexilesteam.exe": "Path of Exile",
  "pathofexile_kg.exe": "Path of Exile",
  "lostarkgame.exe": "Lost Ark",
  "worldoftanks.exe": "Мир танков",
  "worldofwarships.exe": "Мир кораблей",
  "warthunder.exe": "War Thunder",
  "aces.exe": "War Thunder",
  "genshinimpact.exe": "Genshin Impact",
  "yuanshen.exe": "Genshin Impact",
  "starrail.exe": "Honkai: Star Rail",
  "zenlesszonezero.exe": "Zenless Zone Zero",

  // ── Стратегии и симуляторы ──────────────────────────────────────
  "warhammer3.exe": "Total War: Warhammer III",
  "civilizationvi.exe": "Civilization VI",
  "civilizationvii.exe": "Civilization VII",
  "stellaris.exe": "Stellaris",
  "hoi4.exe": "Hearts of Iron IV",
  "eu4.exe": "Europa Universalis IV",
  "ck3.exe": "Crusader Kings III",
  "victoria3.exe": "Victoria 3",
  "bannerlord.exe": "Mount & Blade II: Bannerlord",
  "bannerlord.native.exe": "Mount & Blade II: Bannerlord",
  "citiesskylines.exe": "Cities: Skylines",
  "cities2.exe": "Cities: Skylines II",
  "eurotrucks2.exe": "Euro Truck Simulator 2",
  "amtrucks.exe": "American Truck Simulator",
  "acs.exe": "Assetto Corsa",
  "acc.exe": "Assetto Corsa Competizione",
  "beamng.drive.x64.exe": "BeamNG.drive",
  "farmingsimulator2025game.exe": "Farming Simulator 25",

  // ── Небольшое, но затягивающее ──────────────────────────────────
  "hollow_knight.exe": "Hollow Knight",
  "hollow_knight_silksong.exe": "Hollow Knight: Silksong",
  "celeste.exe": "Celeste",
  "cuphead.exe": "Cuphead",
  "hades.exe": "Hades",
  "hades2.exe": "Hades II",
  "deadcells.exe": "Dead Cells",
  "slaythespire.exe": "Slay the Spire",
  "balatro.exe": "Balatro",
  "vampiresurvivors.exe": "Vampire Survivors",
  "risk of rain 2.exe": "Risk of Rain 2",
  "stardew valley.exe": "Stardew Valley",
  "webfishing.exe": "WEBFISHING",
};

/** Имена файлов, за которыми оболочка следит без всяких настроек. */
export const KNOWN_EXES = Object.keys(KNOWN_GAMES);

/**
 * Полный список того, за чем следить: известное плюс своё.
 *
 * Своё идёт после известного, но при совпадении победит оно —
 * человек, отметивший игру руками, знает лучше списка.
 */
export function watchList(own: string[]): string[] {
  const seen = new Set(KNOWN_EXES);
  return [...KNOWN_EXES, ...own.filter((name) => !seen.has(name.toLowerCase()))];
}

/**
 * Как назвать игру людям.
 *
 * Сначала то, что человек видел в заголовке окна, когда отмечал игру
 * сам: это его игра и его название. Потом список. В крайнем случае —
 * имя файла без расширения: «RustClient» хуже, чем «Rust», но лучше,
 * чем ничего.
 */
export function gameName(exe: string, own: Record<string, string>): string {
  const key = exe.toLowerCase();
  return own[key] ?? own[exe] ?? KNOWN_GAMES[key] ?? exe.replace(/\.exe$/i, "");
}
