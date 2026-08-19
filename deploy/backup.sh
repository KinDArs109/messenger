#!/bin/bash
# Ночная копия мессенджера: база и загруженные файлы.
#
# Копия лежит на той же машине — это защита от «удалил не то»
# и от порчи данных, но не от гибели самого сервера. Чтобы копия
# пережила и сервер, её надо забирать наружу; см. README.
set -euo pipefail

DIR=/opt/backups
KEEP=14
STAMP=$(date +%Y-%m-%d)

mkdir -p "$DIR"

# База. --clean, чтобы восстановление не требовало пустой базы,
# и без владельцев: восстанавливать может другой пользователь.
su - postgres -c "pg_dump --clean --if-exists --no-owner messenger" | gzip -9 > "$DIR/db-$STAMP.sql.gz.tmp"
mv "$DIR/db-$STAMP.sql.gz.tmp" "$DIR/db-$STAMP.sql.gz"

# Загруженные картинки и вложения. Без них база ссылается в пустоту.
tar -czf "$DIR/uploads-$STAMP.tar.gz.tmp" -C /opt/messenger/apps/server uploads
mv "$DIR/uploads-$STAMP.tar.gz.tmp" "$DIR/uploads-$STAMP.tar.gz"

# Настройки сервера: в них ключи и пароль к базе. Права — только root.
install -m 600 /opt/messenger/apps/server/.env "$DIR/env-$STAMP"

# Старое убираем: диск здесь маленький.
find "$DIR" -name 'db-*.sql.gz' -mtime +$KEEP -delete
find "$DIR" -name 'uploads-*.tar.gz' -mtime +$KEEP -delete
find "$DIR" -name 'env-*' -mtime +$KEEP -delete

echo "копия готова: $(du -sh "$DIR" | cut -f1) всего, свободно $(df -h / | awk 'NR==2{print $4}')"
