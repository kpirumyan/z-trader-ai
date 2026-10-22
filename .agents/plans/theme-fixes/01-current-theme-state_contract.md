# Контракт 01: Публичный контракт состояния хука useTheme

- **Идентификатор контракта:** `01-current-theme-state_contract.md`
- **Связанный пункт аудита:** Пункт 1 (`theme-system_review.md`)
- **Статус:** `APPROVED` (Архитектурная спецификация)

---

## 1. Архитектура и инварианты (System Architecture & Invariants)

1. **Доступность состояния темы в JavaScript:**
   Компоненты графиков (HTML5 Canvas, WebGL), торговые виджеты и оверлеи должны иметь прямой доступ к текущему значению темы (`theme`) и булеву флагу (`isDark`) в JavaScript для своевременного пересчета цветов и вызова циклов отрисовки (`requestAnimationFrame`).
2. **Единый источник истины (SSOT):**
   Единственным источником истины активной темы в рантайме является атрибут `data-theme` на элементе `document.documentElement` (`"light" | "dark"`).
3. **Обратная совместимость:**
   Существующий метод `toggleTheme: () => void` сохраняет свою сигнатуру и семантику. Дополнительно предоставляется метод явной установки `setTheme: (theme: Theme) => void`.
4. **Связь `theme` и `isDark`:**
   Флаг `isDark` всегда строго эквивалентен условию `theme === "dark"`.

---

## 2. Публичный шов (Minimal Public Seam)

### Целевой файл:
[`app/hooks/use-theme.ts`](file:///c:/DATA/Development/js/z-trader-ai/app/hooks/use-theme.ts)

### Экспортируемые типы и интерфейсы:
```typescript
import type { Theme } from "../types/theme";

export interface UseThemeResult {
  /** Текущая активная тема ("light" | "dark") */
  theme: Theme;
  /** Булев флаг: true, если активна темная тема */
  isDark: boolean;
  /** Переключает тему на противоположную (dark <-> light) */
  toggleTheme: () => void;
  /** Явно устанавливает указанную тему */
  setTheme: (theme: Theme) => void;
}

/**
 * Хук доступа к текущей теме и методам управления темой терминала.
 */
export function useTheme(): UseThemeResult;
```

---

## 3. Критерии приемки (Given / When / Then)

### Сценарий 3.1: Считывание начального состояния тёмной темы
- **Given** на `document.documentElement` установлен атрибут `data-theme="dark"`
- **When** компонент вызывает `useTheme()`
- **Then** возвращается объект с `theme: "dark"` и `isDark: true`

### Сценарий 3.2: Считывание состояния светлой темы
- **Given** на `document.documentElement` установлен атрибут `data-theme="light"`
- **When** компонент вызывает `useTheme()`
- **Then** возвращается объект с `theme: "light"` и `isDark: false`

### Сценарий 3.3: Переключение темы через `toggleTheme`
- **Given** активная тема `"dark"`
- **When** вызывается функция `toggleTheme()`
- **Then** атрибут `dataset.theme` документа переключается в `"light"`, хук возвращает `theme: "light"` и `isDark: false`, значение сохраняется в `localStorage`

### Сценарий 3.4: Прямая установка через `setTheme`
- **Given** активная тема `"dark"`
- **When** вызывается функция `setTheme("light")`
- **Then** тема устанавливается в `"light"`; при повторном вызове `setTheme("light")` состояние остается неизменным без лишних мутаций

---

## 4. Компромиссы и обоснование (Trade-offs & Rationale)

- **Почему `isDark` включен в возвращаемый объект:**
  Подавляющее большинство проверок в UI и Canvas проверяют `isDark`. Предоставление флага `isDark` исключает дублирование строковых сравнений `theme === "dark"` в десятках доменных компонентов терминала.
