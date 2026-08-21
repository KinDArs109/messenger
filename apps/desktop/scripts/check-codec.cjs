// Проверка: показ экрана идёт через H264, а не через VP8.
//
//   npx electron scripts/check-codec.cjs
//
// От этого зависит, увидят ли собеседники экран или мыло. Замер
// (check-share.cjs) показал разницу: на одной и той же полосе VP8
// режет 1080p до 960×540 и пятнадцати кадров, H264 держит родной
// размер и вдвое больше кадров. Разница в том, кто жмёт: H264 умеет
// видеокарта, VP8 в этой сборке — только процессор.
//
// Просьба тихая: setCodecPreferences ничего не гарантирует и молча
// не срабатывает, если позвать её не вовремя. Поэтому проверяется
// не «позвали», а «договорились»: какой кодек в итоге в согласовании.
//
// Берётся та самая функция из мессенджера — apps/web/src/lib/codecs.ts,
// — а не её пересказ: пересказ проверял бы сам себя.

const { app, BrowserWindow } = require("electron");
const path = require("node:path");
const esbuild = require("esbuild");

const скажи = (строка) => process.stdout.write(`${строка}\n`);

const сторож = setTimeout(() => {
  скажи("\n  ПРОВАЛ: не уложились в минуту\n");
  app.exit(1);
}, 60_000);
сторож.unref?.();

/** Тот же файл, что и в мессенджере, — только собранный в обычный
 *  скрипт: страница TypeScript не понимает. */
function собрать() {
  const где = path.join(__dirname, "..", "..", "web", "src", "lib", "codecs.ts");
  return esbuild.buildSync({
    entryPoints: [где],
    bundle: true,
    format: "iife",
    globalName: "кодеки",
    write: false,
    charset: "utf8",
  }).outputFiles[0].text;
}

const сценарий = (модуль) => `
${модуль}
(async () => {
  const итог = [];
  const шаг = (что, вышло, ещё) => итог.push({ что, вышло: Boolean(вышло), ещё });

  /** Что в итоге согласовано для видео. */
  const договорились = (pc) => {
    const строка = (pc.remoteDescription?.sdp ?? "").split("m=video")[1] ?? "";
    const первый = (строка.match(/m=|^.*\\r\\n/) , строка.trim().split(" ")[2]);
    const карта = {};
    for (const m of строка.matchAll(/a=rtpmap:(\\d+) ([^/]+)/g)) карта[m[1]] = m[2];
    return карта[первый] ?? "?";
  };

  async function свести(просить) {
    const холст = document.createElement("canvas");
    холст.width = 640;
    холст.height = 360;
    холст.getContext("2d").fillRect(0, 0, 640, 360);
    const поток = холст.captureStream(30);

    const наша = new RTCPeerConnection();
    const чужая = new RTCPeerConnection();
    наша.onicecandidate = (e) => e.candidate && чужая.addIceCandidate(e.candidate);
    чужая.onicecandidate = (e) => e.candidate && наша.addIceCandidate(e.candidate);

    const отправитель = наша.addTrack(поток.getVideoTracks()[0], поток);
    const попросили = просить ? кодеки.просимH264(наша, отправитель) : false;

    const предложение = await наша.createOffer();
    await наша.setLocalDescription(предложение);
    await чужая.setRemoteDescription(предложение);
    const ответ = await чужая.createAnswer();
    await чужая.setLocalDescription(ответ);
    await наша.setRemoteDescription(ответ);

    await new Promise((r) => setTimeout(r, 1500));

    let кодек = "?";
    const записи = await отправитель.getStats();
    const по = new Map();
    for (const з of записи.values()) if (з.type === "codec") по.set(з.id, з.mimeType);
    for (const з of записи.values()) {
      if (з.type === "outbound-rtp" && з.kind === "video" && з.codecId) {
        кодек = по.get(з.codecId) ?? кодек;
      }
    }

    наша.close();
    чужая.close();
    поток.getTracks().forEach((t) => t.stop());
    return { кодек, попросили, sdp: договорились(наша) };
  }

  const сам = await свести(false);
  шаг("сам браузер берёт для показа не H264", сам.кодек.toLowerCase() !== "video/h264", сам.кодек);

  const наш = await свести(true);
  шаг("просьба принята", наш.попросили);
  шаг("показ идёт через H264", наш.кодек.toLowerCase() === "video/h264", наш.кодек);
  шаг("и это видно в самом согласовании", наш.sdp.toLowerCase() === "h264", наш.sdp);

  return итог;
})();
`;

void app.whenReady().then(async () => {
  const окно = new BrowserWindow({
    show: false,
    webPreferences: { backgroundThrottling: false, sandbox: true },
  });

  // WebRTC живёт только в безопасном источнике; about:blank им не
  // считается. Своя же страница здоровья подходит.
  await окно.loadURL(`${process.env.CHECK_URL ?? "https://45.130.42.77.sslip.io"}/health`);

  let итог;
  try {
    итог = await окно.webContents.executeJavaScript(сценарий(собрать()), true);
  } catch (беда) {
    скажи(`\n  ПРОВАЛ: проверка не отработала — ${беда.message}\n`);
    app.exit(1);
    return;
  }

  скажи("\nКодек показа экрана\n");
  let провалов = 0;
  for (const { что, вышло, ещё } of итог) {
    if (!вышло) провалов += 1;
    скажи(`${вышло ? "  ✔" : "  ✘ ПРОВАЛ"} ${что}${ещё === undefined ? "" : ` (${ещё})`}`);
  }

  скажи(
    провалов === 0
      ? `\nПоказ идёт тем кодеком, каким задумано — проверок ${итог.length}\n`
      : `\nПровалов: ${провалов} из ${итог.length}\n`,
  );

  app.exit(провалов === 0 ? 0 : 1);
});
