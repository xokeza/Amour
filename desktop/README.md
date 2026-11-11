# Amour!

Музыкальный плеер от [xokeza](https://github.com/xokeza).

[Описание и скачивание](../README.md) · [Релизы](https://github.com/xokeza/Amour/releases) · [API](../api/README.md) · [Android](docs/ANDROID.md)

## Запуск

Node.js 22.13+ и pnpm 10+. Все команды выполняются из этого каталога.

```sh
pnpm install --frozen-lockfile
pnpm dev
```

## Проверка и сборка

```sh
pnpm lint
pnpm exec tsc -b
pnpm test
pnpm electron:build:linux
# На Windows: pnpm electron:build:win
```

Результат сборки — `release/`. Локальные настройки, ключи, агентские инструкции и сборки исключены из Git. Условия использования — в [LICENSE](LICENSE).
