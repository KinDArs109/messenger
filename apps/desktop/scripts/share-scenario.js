/*
 * Замер кодировщика — сценарий для check-share.cjs.
 *
 * Рисуем движущуюся картинку, отдаём её трём соединениям сразу
 * (как в разговоре вчетвером) и смотрим, что доходит: сколько кадров,
 * какого размера, каким битрейтом и во что упёрлось.
 *
 * Две тонкости, без которых замер врёт.
 *
 * Первая: браузер начинает отдачу с трёхсот килобит и поднимает её
 * вдвое за несколько секунд. На коротком замере это выглядит как
 * «упёрлось в канал» даже там, где канала полно, — поэтому стартовую
 * полосу задаём прямо в согласовании.
 *
 * Вторая: чёткость меряем не на глаз, а средним QP — это то самое
 * число, которым кодировщик огрубляет картинку, чтобы уложиться
 * в битрейт. Чем меньше, тем чётче; сравнивать кодеки на одном
 * битрейте иначе нечем.
 */
(async () => {
  const ЗАМЕР_МС = 10000;
  const РАЗГОН_МС = 4000;

  function источник(width, height, fps) {
    const холст = document.createElement("canvas");
    холст.width = width;
    холст.height = height;
    const кисть = холст.getContext("2d", { alpha: false });

    let кадр = 0;
    const таймер = setInterval(() => {
      кадр += 1;
      кисть.fillStyle = "#101820";
      кисть.fillRect(0, 0, width, height);

      for (let i = 0; i < 14; i += 1) {
        const t = кадр / 60 + i;
        кисть.fillStyle = "hsl(" + ((i * 27 + кадр) % 360) + " 70% 55%)";
        кисть.fillRect(
          (Math.sin(t) * 0.4 + 0.5) * width,
          (Math.cos(t * 0.7) * 0.4 + 0.5) * height,
          width / 9,
          height / 9,
        );
      }

      for (let i = 0; i < 600; i += 1) {
        кисть.fillStyle = "hsl(" + ((i * 7 + кадр * 3) % 360) + " 60% 60%)";
        кисть.fillRect((i * 97 + кадр * 5) % width, (i * 53 + кадр * 3) % height, 3, 3);
      }
    }, 1000 / fps);

    return { поток: холст.captureStream(fps), стоп: () => clearInterval(таймер) };
  }

  /** Сказать браузеру, с какой полосы начинать и ниже какой
   *  не опускаться. Без этого первые полминуты идут через ту самую
   *  мыльную картинку, на которую и жалуются. */
  function подкрутить(sdp, кбит) {
    const старт = Math.round(кбит * 0.8);
    return sdp
      .replace(/(m=video .*\r\n)/, "$1b=AS:" + кбит + "\r\n")
      .replace(
        /a=fmtp:(\d+) (.*)\r\n/g,
        (_, pt, хвост) =>
          "a=fmtp:" +
          pt +
          " " +
          хвост +
          ";x-google-start-bitrate=" +
          старт +
          ";x-google-min-bitrate=" +
          старт +
          ";x-google-max-bitrate=" +
          кбит +
          "\r\n",
      );
  }

  async function связать(дорожка, поток, опыт) {
    const наша = new RTCPeerConnection();
    const чужая = new RTCPeerConnection();
    наша.onicecandidate = (e) => e.candidate && чужая.addIceCandidate(e.candidate);
    чужая.onicecandidate = (e) => e.candidate && наша.addIceCandidate(e.candidate);

    const отправитель = наша.addTrack(дорожка, поток);

    if (опыт.кодек) {
      const умеет = RTCRtpSender.getCapabilities("video");
      const нужные = умеет.codecs.filter(
        (к) => к.mimeType.toLowerCase().indexOf(опыт.кодек.toLowerCase()) !== -1,
      );
      const трансивер = наша.getTransceivers().find((т) => т.sender === отправитель);
      if (трансивер && трансивер.setCodecPreferences) {
        трансивер.setCodecPreferences(
          нужные.concat(умеет.codecs.filter((к) => нужные.indexOf(к) === -1)),
        );
      }
    }

    const настройки = отправитель.getParameters();
    настройки.degradationPreference = "maintain-framerate";
    настройки.encodings = (
      настройки.encodings && настройки.encodings.length ? настройки.encodings : [{}]
    ).map((к) => Object.assign({}, к, { maxFramerate: опыт.fps, maxBitrate: опыт.битрейт }));
    await отправитель.setParameters(настройки);

    const кбит = Math.round(опыт.битрейт / 1000);
    const предложение = await наша.createOffer();
    await наша.setLocalDescription(предложение);
    await чужая.setRemoteDescription({ type: "offer", sdp: подкрутить(предложение.sdp, кбит) });
    const ответ = await чужая.createAnswer();
    await чужая.setLocalDescription(ответ);
    await наша.setRemoteDescription({ type: "answer", sdp: подкрутить(ответ.sdp, кбит) });

    return { наша, чужая, отправитель };
  }

  async function замерить(опыт) {
    const собеседников = опыт.собеседников || 3;
    const среда = источник(опыт.width, опыт.height, опыт.fps);
    const дорожка = среда.поток.getVideoTracks()[0];
    if (опыт.hint) дорожка.contentHint = опыт.hint;

    const пары = [];
    try {
      for (let i = 0; i < собеседников; i += 1) {
        пары.push(await связать(дорожка, среда.поток, опыт));
      }

      const снять = async () => {
        let кадров = 0;
        let байт = 0;
        let qp = 0;
        let width = 0;
        let height = 0;
        let предел = null;
        for (const пара of пары) {
          const записи = await пара.отправитель.getStats();
          for (const з of записи.values()) {
            if (з.type !== "outbound-rtp" || з.kind !== "video") continue;
            кадров = Math.max(кадров, з.framesEncoded || 0);
            байт += з.bytesSent || 0;
            qp += з.qpSum || 0;
            width = з.frameWidth || width;
            height = з.frameHeight || height;
            if (з.qualityLimitationReason && з.qualityLimitationReason !== "none") {
              предел = з.qualityLimitationReason;
            }
          }
        }
        return { кадров, байт, qp, width, height, предел, когда: performance.now() };
      };

      await new Promise((готово) => setTimeout(готово, РАЗГОН_МС));
      const до = await снять();
      await new Promise((готово) => setTimeout(готово, ЗАМЕР_МС));
      const после = await снять();

      const секунд = (после.когда - до.когда) / 1000;
      const кадров = после.кадров - до.кадров;
      return {
        имя: опыт.имя,
        fps: Math.round(кадров / секунд),
        width: после.width,
        height: после.height,
        // На одного собеседника: столько уходит в каждое соединение,
        // а всего с машины — втрое больше.
        мбит: (((после.байт - до.байт) * 8) / секунд / собеседников / 1e6)
          .toFixed(1)
          .replace(".", ","),
        qp: кадров > 0 ? Math.round((после.qp - до.qp) / (кадров * собеседников)) : 0,
        предел: после.предел,
      };
    } catch (беда) {
      return { имя: опыт.имя, ошибка: String((беда && беда.message) || беда).slice(0, 40) };
    } finally {
      for (const пара of пары) {
        пара.наша.close();
        пара.чужая.close();
      }
      дорожка.stop();
      среда.стоп();
    }
  }

  const М = (n) => Math.round(n * 1e6);
  const опыты = [
    { имя: 'VP8 720p30, 2,5 Мбит', width: 1280, height: 720, fps: 30, битрейт: М(2.5), hint: 'motion' },
    { имя: 'H264 720p30, 2,5 Мбит', width: 1280, height: 720, fps: 30, битрейт: М(2.5), hint: 'motion', кодек: 'H264' },
    { имя: 'H264 720p60, 6 Мбит', width: 1280, height: 720, fps: 60, битрейт: М(6), hint: 'motion', кодек: 'H264' },
    { имя: 'H264 1080p30, 5 Мбит', width: 1920, height: 1080, fps: 30, битрейт: М(5), hint: 'motion', кодек: 'H264' },
    { имя: 'H264 1080p15 текст', width: 1920, height: 1080, fps: 15, битрейт: М(3), hint: 'detail', кодек: 'H264' },
    { имя: 'H264 1080p30 вдвоём', width: 1920, height: 1080, fps: 30, битрейт: М(5), hint: 'motion', кодек: 'H264', собеседников: 1 },
  ];

  const итог = [];
  for (const опыт of опыты) итог.push(await замерить(опыт));
  return итог;
})();
