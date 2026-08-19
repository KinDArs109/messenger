import { useEffect, useState } from "react";

/**
 * Список звуковых устройств.
 *
 * Спрашиваем только когда список кому-то понадобился: без выданного
 * доступа к микрофону браузер отдаёт устройства без названий, а
 * спрашивать доступ на всякий случай, при открытии мессенджера, —
 * дурной тон.
 */
export function useDevices(active: boolean): {
  mics: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
} {
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    async function load() {
      const devices = await navigator.mediaDevices.enumerateDevices().catch(() => []);
      if (cancelled) return;
      setMics(devices.filter((d) => d.kind === "audioinput"));
      setSpeakers(devices.filter((d) => d.kind === "audiooutput"));
    }

    void load();
    // Воткнули наушники, пока меню открыто, — список должен обновиться.
    navigator.mediaDevices.addEventListener("devicechange", load);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener("devicechange", load);
    };
  }, [active]);

  return { mics, speakers };
}
