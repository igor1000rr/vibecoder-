# Vibecoder Skills

Это директория skills'ов для Vibecoder IDE. Каждая подпапка — отдельный skill в формате, совместимом с [Anthropic Skills](https://www.anthropic.com/news/skills).

## Что такое skill

Skill — это инструкция для LLM-агента *когда и как* выполнять специфичную задачу. Vibecoder подгружает только descriptions всех skills в системный промпт (это занимает мало токенов), а полное содержимое `SKILL.md` модель запрашивает сама через специальный tool — только когда задача реально подходит под skill.

Преимущества:

- **Экономия контекста.** Можно иметь десятки skills, при этом расход токенов минимальный.
- **Переиспользование.** Skill из Claude Desktop или Anthropic Skills работает в Vibecoder без правок.
- **Версионирование в git.** Skills лежат рядом с кодом, эволюционируют вместе с проектом.

## Структура skill

```
.vibecoder/skills/<name>/
  SKILL.md          ← обязательно
  reference.md      ← опционально, дополнительные материалы
  examples/         ← опционально, примеры
    good.py
    bad.py
```

`SKILL.md` обязан содержать YAML frontmatter:

```markdown
---
name: my-skill
description: Use when the user asks for X, Y, or Z. Describes WHEN to trigger,
  in 1-3 sentences.
version: 1.0.0
---

# My Skill

Markdown с инструкциями для LLM...
```

## Какие skills здесь

- **code-review** — ревью PR/коммитов с акцентом на security и correctness.
- **write-tests** — написание/улучшение unit-тестов.

## Создать свой skill

1. Создай `.vibecoder/skills/<your-name>/SKILL.md`.
2. Заполни frontmatter (name, description, version).
3. Напиши инструкции в markdown.
4. В Vibecoder: Ctrl+Shift+P → `Vibecoder: Reload Skills`.

## Где skills загружаются

Vibecoder ищет skills:

1. В каждой папке workspace: `<workspace>/.vibecoder/skills/`
2. В будущем — в `~/.vibecoder/skills/` (глобально для всех проектов).

Workspace-skills имеют приоритет над глобальными при одинаковых именах.
