# Vibecoder Alpha 0.1.0 — Setup Guide

> 📌 Этот документ — единый чек-лист как развернуть Vibecoder Alpha 0.1.0 после `git pull`.
> Игорь, читай по порядку. После каждого шага не нужно ничего проверять — продолжай. Тесты в конце.

## Шаг 1. Подтянуть весь код

```cmd
cd C:\dev\vibecoder-
git stash
git pull origin main
git stash pop
```

Если `git stash pop` ругается на конфликт — это от `npm install` правки `package.json` и `package-lock.json`. Решается так:

```cmd
git checkout --theirs package.json package-lock.json
git stash drop
```

## Шаг 2. Применить иконки

Скачай `vibecoder-icons.zip` (из предыдущих сообщений ассистента), распакуй и положи файлы:

```
zip → C:\dev\vibecoder-\resources\win32\code.ico                  (заменить)
zip → C:\dev\vibecoder-\resources\win32\code_70x70.png            (заменить)
zip → C:\dev\vibecoder-\resources\win32\code_150x150.png          (заменить)
zip → C:\dev\vibecoder-\resources\server\favicon.ico              (заменить)
zip → C:\dev\vibecoder-\resources\server\code-192.png             (заменить)
zip → C:\dev\vibecoder-\resources\server\code-512.png             (заменить)
```

Потом:

```cmd
cd C:\dev\vibecoder-
git add resources/win32/code.ico resources/win32/code_70x70.png resources/win32/code_150x150.png resources/server/favicon.ico resources/server/code-192.png resources/server/code-512.png
git commit -m "Иконки Vibecoder (плейсхолдер, фиолетовый V)"
git push origin main
```

## Шаг 3. Запустить watch (если ещё не запущен)

В отдельном окне CMD:

```cmd
cd C:\dev\vibecoder-
nvm use 22.18.0
npm run watch
```

Watch будет собирать TS → JS в `/out/` непрерывно. Жди пока появится `Finished compilation` (~1-2 минуты после изменений).

## Шаг 4. Запустить Vibecoder

В **отдельном** окне CMD (НЕ закрывая watch):

```cmd
cd C:\dev\vibecoder-
.\scripts\code.bat
```

## Шаг 5. Тесты — это и есть момент проверки

Выполни в Vibecoder по очереди:

### Test 1 — модуль загрузился

`Ctrl+Shift+P` → напечатай `Vibecoder` → должны появиться **6 команд**:

- `Vibecoder: Hello`
- `Vibecoder: Test LM Studio Connection`
- `Vibecoder: Set API Key for Provider`
- `Vibecoder: List All Available Models`
- `Vibecoder: Reload Skills`
- `Vibecoder: Apply Changes from Clipboard`

Запусти `Vibecoder: Hello` — должно показать "Vibecoder v0.1.0 is alive 🎉  Skills loaded: 2".

**Если 2 skills загружены — Skills service работает.**

### Test 2 — Activity Bar sparkle иконка

Слева в Activity Bar (узкая колонка иконок) ищи **иконку sparkle** ✨ (звёздочка). Нажми — откроется сайдбар "Vibecoder" с панелью "Chat".

В чате сверху:
- 2 dropdown'а: провайдер и модель
- Снизу — textarea + кнопки Send / Stop / New Chat

### Test 3 — LM Studio (без API ключей, локально)

Открой LM Studio, Developer → Start Server (обычно localhost:1234). Загрузи любую модель.

В Vibecoder Chat: оставь "LM Studio (local)", выбери модель в dropdown. Напиши "привет" → нажми Send. Должен пойти **стрим ответа** в чате.

**Если стрим работает — LLM Router, LMStudioProvider, ChatView, system prompt — всё работает.**

### Test 4 — облачный провайдер (нужен API key)

`Ctrl+Shift+P` → `Vibecoder: Set API Key for Provider` → выбери Anthropic / OpenAI / Gemini / OpenRouter → вставь свой ключ.

Потом в чате выбери этого провайдера, выбери модель, отправь запрос.

**Если работает напрямую без VPN — отлично.** Если нет (что вероятно из РБ) — Settings → найди `vibecoder.proxy.mode` → переключи в `vibecoder`. Сейчас прокси по адресу `proxy.vibecoder.dev` ещё не задеплоен, поэтому надо либо:

- Деплоить прокси самостоятельно (см. `proxy/README.md`)
- Использовать VPN

### Test 5 — Skills загрузились

`Ctrl+Shift+P` → `Vibecoder: Reload Skills` → должно показать "Skills перезагружены ✅ Найдено: 2".

В чате попроси LM Studio (или любую модель): "сделай code review этого фрагмента: ```console.log(eval(userInput));```". Если модель упомянет security проблему — значит skill-индекс попал в system prompt.

### Test 6 — Composer Apply from Clipboard

В чате попроси LM Studio: "создай файл test.txt со строкой 'Hello Vibecoder' используя search/replace формат".

Модель должна выдать примерно:

````
test.txt
<<<<<<< SEARCH
=======
Hello Vibecoder
>>>>>>> REPLACE
````

Скопируй весь её ответ. `Ctrl+Shift+P` → `Vibecoder: Apply Changes from Clipboard` → выбери "Apply All". В workspace должен появиться `test.txt` с содержимым.

**Если файл создан — Composer работает.**

## Шаг 6 (опционально). Задеплоить прокси

```cmd
cd C:\dev\vibecoder-\proxy
npm install
npx wrangler login
npx wrangler deploy
```

Получишь URL вида `https://vibecoder-proxy.<account>.workers.dev`.

В Vibecoder Settings → `vibecoder.proxy.mode` = `custom`, `vibecoder.proxy.customUrl` = твой URL → теперь Anthropic/OpenAI/Gemini/OpenRouter будут ходить через прокси.

## Что НЕ работает в Alpha 0.1.0

- **Tab autocomplete** — `autocompleteService.ts` есть, но НЕ подключён в contribution. Использует `editor.api.js` который может не работать в workbench-контексте. Подключим в следующей итерации с реальной FIM-моделью.
- **MCP полный JSON-RPC** — сейчас только HTTP/SSE health check; tools/call возвращает заглушку.
- **stdio MCP-серверы** — нужен канал в electron-main, добавим позже.
- **Diff editor перед apply** — composer пока применяет без preview.
- **React UI чата** — сейчас vanilla DOM. Это для будущей итерации.

## Сообщить о проблемах

- Issue в репо: https://github.com/igor1000rr/vibecoder-/issues
- Если что-то не работает — открой DevTools (`Help → Toggle Developer Tools` → Console), скинь сюда вывод.
