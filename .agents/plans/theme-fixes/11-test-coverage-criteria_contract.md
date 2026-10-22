# Контракт 11: Критерии верификации и тестирования подсистемы тем

- **Идентификатор контракта:** `11-test-coverage-criteria_contract.md`
- **Связанный пункт аудита:** Пункт 11 (`theme-system_review.md`)
- **Статус:** `APPROVED` (Архитектурная спецификация)

---

## 1. Архитектура и инварианты верификации (System Invariants)

1. **Запрет маскирующих проверок (No Masking Assertions):**
   В тестах интерфейса строго запрещено использование нестрогих регулярных выражений (например, `/Switch to (light|dark) theme/`), которые маскируют дефекты доступности и одновременный рендеринг нескольких лейблов. Проверки доступных имен обязаны осуществляться по **точному строковому соответствию** ожидаемому состоянию кнопки.
2. **Полнота покрытия наблюдаемых контрактов:**
   Тестовый набор обязан верифицировать поведение всех публичных швов подсистемы тем как «черного ящика»:
   - Реактивное обновление состояния хука `useTheme()`;
   - Межвкладочную синхронизацию через `StorageEvent`;
   - Реакцию на изменение атрибута `data-theme` на элементе `<html>`;
   - Селективную отрисовку графических ассетов логотипа;
   - Защиту от сбоев `localStorage`.
3. **Разделение ответственности:**
   Спецификация задает критерии приемки и наблюдаемые эффекты. Выбор тестового фреймворка, моков окружения (jsdom/happy-dom) и внутренней структуры тест-кейсов находится в полной автономии Тестера.

---

## 2. Публичные швы для верификации (Public Seams Under Test)

1. [`app/hooks/use-theme.ts`](file:///c:/DATA/Development/js/z-trader-ai/app/hooks/use-theme.ts) (`useTheme`)
2. [`app/components/theme-toggle.tsx`](file:///c:/DATA/Development/js/z-trader-ai/app/components/theme-toggle.tsx) (`ThemeToggle`)
3. [`app/constants/theme.ts`](file:///c:/DATA/Development/js/z-trader-ai/app/constants/theme.ts) (`THEMES`, `DEFAULT_THEME`, `isTheme`)
4. [`app/components/top-bar.tsx`](file:///c:/DATA/Development/js/z-trader-ai/app/components/top-bar.tsx) (`TopBar`)
5. [`app/components/workspace-canvas.tsx`](file:///c:/DATA/Development/js/z-trader-ai/app/components/workspace-canvas.tsx) (`WorkspaceCanvas`)

---

## 3. Критерии приемки тестов (Behavioral Verification Criteria)

### Сценарий 3.1: Строгая верификация доступности кнопки (Strict Name Match)
- **Given** смонтирован компонент `ThemeToggle` при активной тёмной теме
- **When** тестируется доступное имя кнопки
- **Then** поиск кнопки по точному имени `"Switch to light theme"` успешен, атрибут `aria-pressed` равен `"true"`, а поиск по имени `"Switch to dark theme"` возвращает отсутствие элемента

### Сценарий 3.2: Переключение и инверсия доступности
- **Given** кнопка `ThemeToggle` в темной теме
- **When** инициируется клик по кнопке
- **Then** доступное имя кнопки строго переключается на `"Switch to dark theme"`, `aria-pressed` становится `"false"`

### Сценарий 3.3: Реактивность `useTheme` при мутации DOM
- **Given** компонент подписан на `useTheme()`
- **When** на `document.documentElement` программно изменяется атрибут `data-theme`
- **Then** компонент немедленно получает актуализированные значения `theme` и `isDark`

### Сценарий 3.4: Межвкладочная синхронизация
- **Given** терминал работает в текущей вкладке
- **When** диспетчеризуется событие `window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'light' }))`
- **Then** `document.documentElement.dataset.theme` становится `"light"`, и подписчики `useTheme()` отражают светлую тему

### Сценарий 3.5: Изоляция ререндеров
- **Given** дерево компонентов, где часть компонентов использует `useTheme()`, а часть не использует
- **When** переключается тема
- **Then** не подписанные компоненты не подвергаются лишним ререндерам

---

## 4. Компромиссы и обоснование (Trade-offs & Rationale)

- **Почему критерии сформулированы как BDD Given/When/Then:**
  Это исключает привязку к деталям реализации тестов и позволяет Тестеру самостоятельно выбирать между юнит-тестами компонентов, хуковыми тестами (`renderHook`) или интеграционными сценариями, сохраняя полную независимость разработки.
