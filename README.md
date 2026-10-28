# Yard Stars

Уютная игра в Telegram: кухня-мерж, ремонт дома, герои-соседи, цели дня. Бот: @YardStarsGameBot.

| Папка | Что внутри | Куда выкладывается |
| --- | --- | --- |
| `game/` | сама игра (`index.html`) и картинки (`assets/`) | GitHub Pages: https://shawnwild-wq.github.io/yardstars/ |
| `worker/` | сервер: сохранения, оплата звёздами, уведомления, команды бота | Cloudflare Workers: https://yardstars.shawnwild.workers.dev |
| `tools/slice.py` | режет листы иконок из Canva на отдельные картинки | запускается вручную |
| `migration/` | две версии старой игры «Береги его» для переезда игроков | репозиторий `beregi` |

Выкладка автоматическая: любое изменение в `game/` или `worker/` на ветке `main` само публикуется (вкладка Actions).

## Секреты (Settings → Secrets and variables → Actions)

`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_ID`, `BOT_TOKEN` (новый бот), `OLD_BOT_TOKEN` (бот «Береги его»),
`ADMIN_ID` (твой Telegram ID), `WEBHOOK_SECRET` (любые 30 латинских букв и цифр), `SETUP_KEY` (любое слово).

После первой выкладки сервера один раз открыть: `https://yardstars.shawnwild.workers.dev/setup?key=SETUP_KEY`.

## Баланс

Все числа игры — в блоке `CONFIG` в начале `game/index.html`. Цены в звёздах и проверки — в `worker/src/config.js`.

## Проверки

`node --no-warnings worker/test/run.mjs` — 32 проверки сервера без Cloudflare.
