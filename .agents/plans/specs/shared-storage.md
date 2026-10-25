---
name: shared-storage
type: shared
status: approved
target_path: src/shared/storage
composition_point: none
e2e_required: false
---

# Спецификация: shared-storage

## 1. Цели и границы ответственности

### 1.1 В рамках задачи (In-Scope)
- Реализация единого низкоуровневого модуля отказоустойчивого хранилища `src/shared/storage/`.
- Предоставление дуального API (Dual API) в рамках единого интерфейса `SafeStorage`:
  1. **Низкоуровневые методы Web Storage:** базовые строковые операции (`getItem`, `setItem`, `removeItem`, `clear`).
  2. **Высокоуровневые типизированные хелперы:** методы для работы с JSON и внешними Zod-схемами (`getJSON<T>`, `setJSON<T>`) с перехватом ошибок парсинга/валидации и возвратом fallback-значений.
- Прозрачный автоматический fallback на in-memory хранилище (`Map<string, string>`) при недоступности браузерного `window.localStorage` (SSR, приватный режим / инкогнито, блокировка cookies, превышение дисковой квоты `QuotaExceededError`).
- Предоставление фабрики `createSafeStorage(storage?: Storage | null)` для инъекции mock-хранилищ в тестах и синглтона `safeStorage` по умолчанию.
- Модульные тесты чёрного ящика в `src/shared/storage/tests/storage.test.ts`.

### 1.2 Вне рамок задачи (Non-Goals)
- Любые UI-компоненты индикации состояния хранилища (`StorageStatusIcon`, поповеры диагностики, модальные окна, баннеры ошибок) — строго исключены из архитектуры согласно [ADR-0004](../../../docs/adr/0004-resilient-storage-and-terminal-status-bar.md).
- Доменные схемы валидации данных (они создаются и поддерживаются исключительно в модулях-потребителях, таких как `workspace` и `theme`, и передаются аргументом в `getJSON`).
- Собственные константы конфигурации или схемы ключей (хранилище работает с любыми строковыми ключами без искусственных ограничений).

### 1.3 Архитектурные инварианты
- **Правило однонаправленного фундамента (`src/shared/*`)**: модуль `src/shared/storage/` не имеет зависимостей от `src/modules/*`, `src/composition/*` или `app/*`.
- **Изоляция контракта**: внешние потребители импортируют функционал исключительно через публичный шов `@/src/shared/storage` (`index.ts`). Глубокие импорты внутренних файлов запрещены.
- **Соответствие ADR**:
  - [ADR-0001](../../../docs/adr/0001-modular-architecture.md): организация разделяемого фундамента в `src/shared/`.
  - [ADR-0002](../../../docs/adr/0002-boundary-enforcement-and-quarantine.md): правила валидации границ через `dependency-cruiser` и ESLint.
  - [ADR-0004](../../../docs/adr/0004-resilient-storage-and-terminal-status-bar.md): полный отказ от баннеров и иконок статуса хранилища; молчаливая деградация в in-memory хранилище.

---

## 2. Публичный периметр контракта

### 2.1 Типы (`src/shared/storage/types.ts`)
```typescript
import type { z } from "zod";

export interface SafeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): boolean;
  removeItem(key: string): boolean;
  clear(): boolean;
  getJSON<T>(key: string, schema?: z.ZodType<T>, fallback?: T): T | null;
  setJSON<T>(key: string, value: T): boolean;
}
```

### 2.2 Схемы (`src/shared/storage/schema.ts`)
`N/A: Non-applicable` — модуль не содержит собственных статических схем; Zod-схемы передаются потребителями в `getJSON`.

### 2.3 Константы (`src/shared/storage/constants.ts`)
`N/A: Non-applicable` — модуль не содержит статических констант или настроечных флагов.

### 2.4 Реэкспорты (`src/shared/storage/index.ts`)
```typescript
export type { SafeStorage } from "./types";
export { safeStorage, createSafeStorage } from "./safe-storage";
```

---

## 3. Внутренняя логика и реализация

### 3.1 Архитектура и алгоритмы (`safe-storage.ts`)

1. **Инициализация целевого хранилища**:
   - Фабрика `createSafeStorage(storage?: Storage | null)` принимает целевое браузерное хранилище (по умолчанию `window.localStorage`, если `typeof window !== "undefined"`).
   - Выполняется верификационный тест доступности (пробная запись и удаление тестового ключа в блоке `try-catch`).
   - Если переданный `storage` отсутствует, не определён (SSR) или выбрасывает исключение (`SecurityError` в Safari Incognito, отключённые cookies), адаптер переключается на внутренний `Map<string, string>` (in-memory fallback).

2. **Строковые методы**:
   - `getItem(key: string)`: считывает значение из браузерного хранилища. При ошибке или недоступности считывает из in-memory `Map`. Возвращает строку или `null`.
   - `setItem(key: string, value: string)`: сохраняет значение в браузерное хранилище. Если возникает ошибка (например, `QuotaExceededError`), сохраняет значение в in-memory `Map` и возвращает `true`.
   - `removeItem(key: string)`: удаляет ключ из браузерного хранилища и из in-memory `Map`. Возвращает `true`.
   - `clear()`: очищает браузерное хранилище и in-memory `Map`. Возвращает `true`.

3. **Типизированные методы**:
   - `getJSON<T>(key, schema?, fallback?)`:
     - Вызывает `getItem(key)`. Если значение отсутствует (`null`), возвращает `fallback ?? null`.
     - Выполняет `JSON.parse` в блоке `try-catch`. При синтаксической ошибке JSON возвращает `fallback ?? null`.
     - Если передана Zod-схема (`schema`), выполняет `schema.safeParse(parsed)`. При успехе возвращает валидированные данные, при ошибке валидации возвращает `fallback ?? null`.
     - Если схема не передана, возвращает распарсенное значение как `T`.
   - `setJSON<T>(key, value)`:
     - Выполняет `JSON.stringify(value)` в блоке `try-catch`. При ошибке сериализации (например, циклическая ссылка) возвращает `false`.
     - Передаёт сериализованную строку в `setItem(key, serializedString)` и возвращает результат.

---

## 4. UI-представление и стилизация

`N/A: Non-visual target` — модуль не содержит визуальных компонентов, CSS-стилей или разметки. Все UI-статусы исключены согласно [ADR-0004](../../../docs/adr/0004-resilient-storage-and-terminal-status-bar.md).

---

## 5. Сценарии тестирования чёрного ящика (Black-Box Tests)

> [!NOTE]
> Все тесты импортируют функционал исключительно из публичного шва `@/src/shared/storage`. Внутренние файлы реализации не тестируются напрямую.

### Scenario: Low-Level String Storage Operations
- **Given:** Инстанс `safeStorage` с доступным стандартным хранилищем.
- **When:** Вызываются методы `setItem("key1", "val1")`, `getItem("key1")`, `removeItem("key1")`.
- **Then:** Метод `getItem` возвращает записанное значение `"val1"`, а после `removeItem` возвращает `null`.

### Scenario: Graceful In-Memory Fallback on Quota or Security Errors
- **Given:** Инстанс `createSafeStorage`, сконфигурированный с фиктивным хранилищем, выбрасывающим `DOMException("QuotaExceededError")` при любой записи.
- **When:** Вызывается `setItem("quotaKey", "importantData")` и последующий `getItem("quotaKey")`.
- **Then:** `setItem` не выбрасывает исключение и возвращает `true`, а `getItem("quotaKey")` корректно возвращает `"importantData"` из in-memory fallback.

### Scenario: SSR and Missing Window Storage Safety
- **Given:** Инициализация хранилища без доступа к браузерному `window.localStorage` (`createSafeStorage(null)`).
- **When:** Выполняются операции записи `setItem("ssrKey", "ssrVal")` и чтения `getItem("ssrKey")`.
- **Then:** Операции выполняются прозрачно через in-memory структуру данных без падений и ошибок `ReferenceError: window is not defined`.

### Scenario: High-Level getJSON with Valid Zod Schema
- **Given:** В хранилище записана валидная JSON-строка `{"id": "win-1", "x": 100}`, и предоставлена соответствующая Zod-схема.
- **When:** Вызывается `getJSON("win-key", schema)`.
- **Then:** Возвращается типизированный объект `{ id: "win-1", x: 100 }`.

### Scenario: High-Level getJSON with Corrupted JSON Data
- **Given:** В хранилище по ключу находится повреждённый JSON (например, `"{{invalid-json"`).
- **When:** Вызывается `getJSON("bad-json", schema, fallbackValue)`.
- **Then:** Исключение не выбрасывается, метод возвращает указанный `fallbackValue`.

### Scenario: High-Level getJSON with Schema Validation Failure
- **Given:** В хранилище находится валидный JSON, но не удовлетворяющий условиям схемы (например, число вместо строки в обязательном поле).
- **When:** Вызывается `getJSON("schema-mismatch", schema, fallbackValue)`.
- **Then:** Ошибка схемы перехватывается, метод возвращает `fallbackValue` (или `null`, если fallback не задан).

### Scenario: High-Level setJSON with Circular Object
- **Given:** Объект с циклической ссылкой, сериализация которого вызывает ошибку сериализации.
- **When:** Вызывается `setJSON("circular", circularObj)`.
- **Then:** Метод не падает с ошибкой, а возвращает `false`.

### Scenario: Clear Operation Purging Both Storage and Memory
- **Given:** Данные записаны как в браузерное хранилище, так и в in-memory fallback.
- **When:** Вызывается `clear()`.
- **Then:** Последующие вызовы `getItem` для ранее созданных ключей возвращают `null`.

---

## 6. Интеграция и сборка

### 6.1 Точка связывания (Composition Point)
- `composition_point`: `none`. Модуль является разделяемой библиотечной утилитой (`src/shared/storage`) и импортируется напрямую доменными модулями (например, `src/shared/theme`, `src/modules/workspace`).

### 6.2 Необходимость E2E-тестов (Playwright)
- `e2e_required`: `false`. Модуль полностью покрывается быстрыми модульными тестами чёрного ящика в `src/shared/storage/tests/storage.test.ts`.
