// Проверка автообновления без пересборки и переустановки.
//
//   npx electron scripts/test-update.cjs
//
// Притворяется старой версией (0.0.1) и проходит весь путь, который
// проходит приложение у друга: находит релиз на GitHub, читает
// latest.yml, качает установщик и сверяет контрольную сумму. Не делает
// только последнего шага — самой установки.
//
// Смысл в том, чтобы поломка обнаружилась здесь, а не у человека,
// которому обновление тихо не приходит и он об этом даже не узнает.

const { app } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");

// Именно тот semver, которым пользуется electron-updater, а не тот,
// что лежит в корне: у них разные копии, и объект из чужой копии он
// не признаёт своим — «Invalid version. Got type object».
const { SemVer } = require(
  require.resolve("semver", { paths: [require.resolve("electron-updater")] }),
);

// Берём настройки из dev-app-update.yml: в отладке собранного
// app-update.yml рядом нет. Путь указываем полностью — сам по себе
// electron-updater ищет файл рядом со скриптом, то есть в scripts/.
autoUpdater.forceDevUpdateConfig = true;
autoUpdater.updateConfigPath = path.join(__dirname, "..", "dev-app-update.yml");
autoUpdater.autoDownload = false;
// Иначе при выходе скрипт молча ставит скачанное поверх установленного
// приложения: проверка не должна ничего менять на машине.
autoUpdater.autoInstallOnAppQuit = false;
autoUpdater.currentVersion = new SemVer("0.0.1");

const done = (code) => {
  app.exit(code);
};

autoUpdater.on("error", (error) => {
  console.error("\n  ОШИБКА:", error?.message ?? error, "\n");
  done(1);
});

autoUpdater.on("update-available", (info) => {
  console.log(`  Найдено обновление: ${info.version}`);
  for (const file of info.files ?? []) {
    console.log(`  Файл: ${file.url} (${file.size} байт)`);
  }
  console.log("  Качаю…");
  autoUpdater.downloadUpdate().then(
    (paths) => {
      // downloadUpdate сам сверяет sha512 из latest.yml и падает,
      // если файл не совпал. Дошли сюда — значит совпал.
      console.log(`\n  Скачано и проверено: ${paths}\n`);
      done(0);
    },
    (error) => {
      console.error("\n  Не скачалось:", error?.message ?? error, "\n");
      done(1);
    },
  );
});

autoUpdater.on("update-not-available", () => {
  console.error("\n  Обновление не найдено — а должно было: мы притворяемся 0.0.1.\n");
  done(1);
});

void app.whenReady().then(() => {
  const { owner, repo } = require("../package.json").build.publish[0];
  console.log(`\n  Источник: github.com/${owner}/${repo}`);
  console.log("  Прикидываюсь версией 0.0.1\n");
  void autoUpdater.checkForUpdates().catch(() => {
    /* обработчик error выше уже отчитался */
  });
});
