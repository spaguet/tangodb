# AI Context — индекс документов

Перед задачей читай только файлы, относящиеся к текущей работе.

## Структура

```
project/
├── tangodb/                  ← основное приложение (React + Vite)
├── tangodb-dev-console/      ← админ-консоль
└── .cursor/
    ├── rules/
    │   ├── core.mdc          ← главные правила агента
    │   └── memory.mdc        ← правила работы с памятью
    └── docs/
        └── ai/
            ├── AI_CONTEXT.md     ← этот файл (индекс)
            ├── architecture.md   ← структура и архитектура
            ├── changelog.md      ← история изменений кода
            ├── decision_log.md   ← архитектурные решения
            ├── design_system.md  ← цвета, шрифты, отступы
            └── lessons.md        ← ошибки и как их избежать
```

## Когда что читать

| Задача | Файл |
|--------|------|
| Любая | `.cursor/docs/ai/AI_CONTEXT.md` (первым) |
| Структура, модули, слои | `.cursor/docs/ai/architecture.md` |
| UI, стили, компоненты | `.cursor/docs/ai/design_system.md` |
| Похожая ошибка в прошлом | `.cursor/docs/ai/lessons.md` |
| Почему сделано именно так | `.cursor/docs/ai/decision_log.md` |
| Что менялось недавно | `.cursor/docs/ai/changelog.md` |

Не загружай остальные файлы без необходимости.
