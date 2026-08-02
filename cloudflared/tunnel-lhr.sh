#!/usr/bin/env bash
# Туннель через localhost.run с автоматическим переподключением.
#
# Соединение периодически закрывается удалённой стороной — при
# нестабильном канале это норма, а в наших условиях, похоже, ещё и
# следствие вмешательства в трафик. Поэтому не «запустил и забыл»,
# а цикл: упало — поднимаем заново.
#
# Подключаемся как nokey: без ключа сервис выдаёт случайный поддомен
# сразу и без регистрации. С ключом поддомен был бы постоянным, но
# для этого нужна учётная запись на localhost.run.
#
# Запуск:  bash cloudflared/tunnel-lhr.sh

PORT="${1:-3001}"
LOG="${2:-tunnel.log}"

echo "Туннель на localhost:$PORT. Остановить — Ctrl+C."
echo "Лог: $LOG"
echo

attempt=0
while true; do
  attempt=$((attempt + 1))
  started=$(date +%s)
  echo "[$(date '+%H:%M:%S')] попытка $attempt — подключаюсь…"

  ssh -o StrictHostKeyChecking=accept-new \
      -o ServerAliveInterval=20 \
      -o ServerAliveCountMax=3 \
      -o ExitOnForwardFailure=yes \
      -R "80:localhost:$PORT" nokey@localhost.run 2>&1 | tee -a "$LOG" |
    grep --line-buffered -oE 'https://[a-z0-9-]+\.lhr\.life' | head -1

  lived=$(( $(date +%s) - started ))
  echo "[$(date '+%H:%M:%S')] соединение прожило ${lived}с — переподключаюсь через 5с"
  sleep 5
done
