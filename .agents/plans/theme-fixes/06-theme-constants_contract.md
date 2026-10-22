# Контракт 06: Константы подсистемы тем и устранение неиспользуемого кода

- **Идентификатор контракта:** `06-theme-constants_contract.md`
- **Связанный пункт аудита:** Пункт 6 (`theme-system_review.md`)
- **Статус:** `APPROVED` (Архитектурная спецификация)

---

## 1. Архитектура и инварианты (System Architecture & Invariants)

1. **Единый источник истины (SSOT) констант тем:**
   Файл [`app/constants/theme.ts`](file:///c:/DATA/Development/js/z-trader-ai/app/constants/theme.ts) является каноническим местом объявления неизменяемых значений подсистемы тем терминала.
2. **Отсутствие мертвого кода:**
   Константы `THEMES` и `DEFAULT_THEME` должны быть экспортированы и активно использоваться всеми зависимыми модулями (валидация, хук `useTheme`, инлайн-скрипт в `RootLayout`, тесты). Объявление мертвых или фиктивных констант запрещено.
3. **Соответствие правилам кодовой базы:**
   - Соответствие [`.agents/rules/codebase-layout.md`](file:///c:/DATA/Development/js/z-trader-ai/.agents/rules/codebase-layout.md): типы импортируются строго из `app/types/theme.ts`, в `app/constants/` располагаются только константы и статические структуры.
   - Соответствие [`.agents/rules/naming-conventions.md`](file:///c:/DATA/Development/js/z-trader-ai/.agents/rules/naming-conventions.md): имя файла строго в единственном числе `theme.ts`, 1-в-1 совпадение с типом `app/types/theme.ts`.

---

## 2. Публичный шов (Minimal Public Seam)

### Целевой файл:
[`app/constants/theme.ts`](file:///c:/DATA/Development/js/z-trader-ai/app/constants/theme.ts)

### Экспортируемые сигнатуры:
```typescript
import type { Theme } from "../types/theme";

/**
 * Неизменяемый кортеж всех допустимых тем терминала.
 */
export const THEMES: readonly Theme[];

/**
 * Базовая тема по умолчанию для терминала Z-Trader AI.
 */
export const DEFAULT_THEME: Theme;
```

---

## 3. Критерии приемки (Given / When / Then)

### Сценарий 3.1: Значение темы по умолчанию
- **Given** константа `DEFAULT_THEME` импортирована из `app/constants/theme.ts`
- **When** считывается ее значение
- **Then** оно строго равно `"dark"`

### Сценарий 3.2: Состав доступных тем
- **Given** константа `THEMES` импортирована из `app/constants/theme.ts`
- **When** проверяется содержимое кортежа
- **Then** массив содержит ровно два элемента `["light", "dark"]` и является `readonly`

### Сценарий 3.3: Использование в кодовой базе
- **Given** сборка проекта или статический анализ
- **When** проверяются ссылки на `DEFAULT_THEME` и `THEMES`
- **Then** обе константы имеют внешние импорты в модулях инициализации, валидации и хуках без предупреждений линтера об unused variables

---

## 4. Компромиссы и обоснование (Trade-offs & Rationale)

- **Почему константы не в `app/types/theme.ts`:**
  Правило `codebase-layout.md` категорически запрещает размещать рантайм-код и константы внутри каталога `app/types/`. Тип `Theme` остается в `types/theme.ts`, а значения `THEMES` и `DEFAULT_THEME` — в `constants/theme.ts`.
