# Vibecoder Proxy

Cloudflare Worker, проксирующий запросы к LLM-провайдерам (Anthropic, OpenAI, Gemini, OpenRouter) от Vibecoder IDE.

## Зачем нужен прокси

1. **CORS.** Браузерный фронт (а Vibecoder = Electron renderer ≈ браузер) не может вызывать Anthropic/OpenAI API напрямую: нет CORS-заголовков.
2. **География.** В РФ/РБ часть провайдеров недоступна без VPN.
3. **Единая точка отказа/мониторинга.** Один URL для всех облачных моделей.

## Что прокси НЕ делает

- **Не хранит ключи.** Юзер передаёт свой API-ключ в каждом запросе (BYOK), прокси только форвардит.
- **Не логирует содержимое запросов.** Только метрики (количество запросов, ошибки) без payload'а.
- **Не модифицирует тело запроса.** Только маршрутизация по path.

## Маршруты

| Путь Vibecoder | Перенаправляется в |
|---|---|
| `/anthropic/v1/messages` | `https://api.anthropic.com/v1/messages` |
| `/openai/v1/chat/completions` | `https://api.openai.com/v1/chat/completions` |
| `/openai/v1/models` | `https://api.openai.com/v1/models` |
| `/gemini/v1beta/...` | `https://generativelanguage.googleapis.com/v1beta/...` |
| `/openrouter/v1/...` | `https://openrouter.ai/api/v1/...` |

## Деплой

```bash
cd proxy
npm install
npx wrangler login
npx wrangler deploy
```

После деплоя URL будет вида `https://vibecoder-proxy.<account>.workers.dev`.

Для прода — настроить custom domain `proxy.vibecoder.dev` через Cloudflare DNS.

## Локальная разработка

```bash
npx wrangler dev
# слушает на http://localhost:8787
```

В Vibecoder Settings → `vibecoder.proxy.mode` = `custom`, `vibecoder.proxy.customUrl` = `http://localhost:8787`.

## Архитектура

- Single file `src/index.ts` — стейтлесс Worker, маршрутизация и проксирование.
- TransformStream используется чтобы пробрасывать SSE-стримы без буферизации.
- Прокси добавляет CORS-заголовки в ответы, чтобы Electron-renderer мог читать body.

## Лицензия

Apache-2.0. См. `../LICENSE.txt`.
