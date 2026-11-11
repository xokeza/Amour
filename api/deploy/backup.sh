#!/bin/sh
set -eu
umask 077
folder=/var/lib/amour-api/backups
mkdir -p "$folder"
backup="$folder/amour-$(date -u +%Y%m%dT%H%M%SZ).sqlite"
sqlite3 /var/lib/amour-api/amour.sqlite ".backup '$backup'"
find "$folder" -type f -name 'amour-*.sqlite' -mtime +14 -delete
