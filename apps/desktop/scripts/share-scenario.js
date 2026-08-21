/*
 * Замер кодировщика — сценарий для check-share.cjs.
 *
 * Рисуем движущуюся картинку, отдаём её в несколько соединений сразу
 * (как в разговоре вчетвером) и смотрим, что доходит: сколько кадров,
 * какого размера, каким битрейтом и во что упёрлось.
 *
 * Три тонкости, без которых замер врёт.
 *
 * Первая: браузер начинает отдачу с трёхсот килобит и поднимает её
 * вдвое за несколько секунд. На коротком замере это выглядит как
 * «упёрлось в канал» даже там, где канала полно, — поэтому стартовую
 * полосу задаём прямо в согласовании.
 *
 * Вторая: чёткость меряем не на глаз, а средним QP — это то самое
 * число, которым кодировщик огрубляет картинку, чтобы уложиться
 * в битрейт. Чем меньше, тем чётче.
 *
 * Третья, на которой замер один раз уже соврал: считаем и кадры
 * самого источника. Рисование 1080p стоит дорого, и если холст выдаёт
 * тридцать кадров, то «кодировщик выдал тридцать» не значит ничего.
 * Столбец «источник» и есть та правда, с которой надо сравнивать.
 */
(async () => {
  const ЗАМЕР_МС = 10000;
  const РАЗГОН_МС = 4000;

  /**
   * Движущаяся картинка, которую дорого жать и дёшево рисовать.
   *
   * Шум готовим один раз в запасной холст и потом сдвигаем — так кадр
   * остаётся тяжёлым для кодировщика (меняется каждый пиксель), но
   * обходится нам в четыре отрисовки картинки, а не в шестьсот
   * прямоугольников.
   */
  function источник(width, height, fps) {
    const шум = document.createElement("canvas");
    шум.width = width;
    шум.height = height;
    const шумК = шум.getContext("2d", { alpha: false });
    const пятна = шумК.createImageData(width, height);
    for (let i = 0; i < пятна.data.length; i += 4) {
      const v = Math.abs((Math.sin(i * 12.9898) * 43758.5453) % 1);
      const c = Math.floor(v * 255);
      пятна.data[i] = c;
      пятна.data[i + 1] = (c * 3) % 255;
      пятна.data[i + 2] = (c * 7) % 255;
      пятна.data[i + 3] = 255;
    }
    шумК.putImageData(пятна, 0, 0);

    const холст = document.createElement("canvas");
    холст.width = width;
    холст.height = height;
    const кисть = холст.getContext("2d", { alpha: false });

    let кадр = 0;
    let рисовали = 0;
    const таймер = setInterval(() => {
      кадр += 1;
      рисовали += 1;

      const сдвигX = (кадр * 7) % width;
      const сдвигY = (кадр * 3) % height;
      кисть.drawImage(шум, -сдвигX, -сдвигY);
      кисть.drawImage(шум, width - сдвигX, -сдвигY);
      кисть.drawImage(шум, -сдвигX, height - сдвигY);
      кисть.drawImage(шум, width - сдвигX, height - сдвигY);

      for (let i = 0; i < 10; i += 1) {
        const t = кадр / 60 + i;
        кисть.fillStyle = "hsl(" + ((i * 33 + кадр) % 360) + " 80% 55%)";
        кисть.fillRect(
          (Math.sin(t) * 0.4 + 0.5) * width,
          (Math.cos(t * 0.7) * 0.4 + 0.5) * height,
          width / 8,
          height / 8,
        );
      }
    }, 1000 / fps);

    return {
      поток: холст.captureStream(fps),
      сколькоРисовали: () => рисовали,
      стоп: () => clearInterval(таймер),
    };
  }

  /** Сказать браузеру, с какой полосы начинать. Без этого первые
   *  полминуты идут через ту самую мыльную картинку. */
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
    настройки.degradationPreference = опыт.деградация || "maintain-framerate";
    настройки.encodings = (
      настройки.encodings && настройки.encodings.length ? настройки.encodings : [{}]
    ).map((к) =>
      Object.assign({}, к, {
        maxFramerate: опыт.безПотолкаКадров ? undefined : опыт.fps,
        maxBitrate: опыт.битрейт,
      }),
    );
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
        return {
          кадров,
          байт,
          qp,
          width,
          height,
          предел,
          рисовали: среда.сколькоРисовали(),
          когда: performance.now(),
        };
      };

      await new Promise((готово) => setTimeout(готово, РАЗГОН_МС));
      const до = await снять();
      await new Promise((готово) => setTimeout(готово, ЗАМЕР_МС));
      const после = await снять();

      const секунд = (после.когда - до.когда) / 1000;
      const кадров = после.кадров - до.кадров;
      return {
        имя: опыт.имя,
        источник: Math.round((после.рисовали - до.рисовали) / секунд),
        fps: Math.round(кадров / секунд),
        width: после.width,
        height: после.height,
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
  const H = { hint: "motion", кодек: "H264" };
  const опыты = [
    Object.assign({ имя: "1080p60, 4 Мбит, втроём", width: 1920, height: 1080, fps: 60, битрейт: М(4) }, H),
    Object.assign({ имя: "1080p60, 8 Мбит, втроём", width: 1920, height: 1080, fps: 60, битрейт: М(8) }, H),
    Object.assign({ имя: "1080p60, 8 Мбит, вдвоём", width: 1920, height: 1080, fps: 60, битрейт: М(8), собеседников: 1 }, H),
    Object.assign({ имя: "900p60, 6 Мбит, втроём", width: 1600, height: 900, fps: 60, битрейт: М(6) }, H),
    Object.assign({ имя: "720p60, 4 Мбит, втроём", width: 1280, height: 720, fps: 60, битрейт: М(4) }, H),
    Object.assign({ имя: "720p60, 6 Мбит, втроём", width: 1280, height: 720, fps: 60, битрейт: М(6) }, H),
    Object.assign({ имя: "1080p60 без потолка кадров", width: 1920, height: 1080, fps: 60, битрейт: М(8), безПотолкаКадров: true }, H),
    { имя: "1080p60 VP8 для сравнения", width: 1920, height: 1080, fps: 60, битрейт: М(8), hint: "motion" },
  ];

  const итог = [];
  for (const опыт of опыты) итог.push(await замерить(опыт));
  return итог;
})();
