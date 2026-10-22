# Контракт 07: Согласованность темы по умолчанию между слоями (SSOT Mismatch)

- **Идентификатор контракта:** `07-default-theme-ssot_contract.md`
- **Связанный пункт аудита:** Пункт 7 (`theme-system_review.md`)
- **Статус:** `APPROVED` (Архитектурная спецификация)

---

## 1. Архитектура и инварианты (System Architecture & Invariants)

1. **Единый источник истины для темы по умолчанию (SSOT):**
   Базовой темой терминала Z-Trader AI является тёмная тема (`DEFAULT_THEME = "dark"`), согласно дизайн-системе [`DESIGN.md`](file:///c:/DATA/Development/js/z-trader-ai/DESIGN.md).
2. **Синхронизация стилей `:root` в CSS:**
   - Селектор `:root` по умолчанию в [`app/globals.css`](file:///c:/DATA/Development/js/z-trader-ai/app/globals.css) обязан определять токены **тёмной темы** (`color-scheme: dark; --canvas: #0e0e0e; --text-primary: #ffffff; ...`).
   - Светлая тема объявляется как явное переопределение через селектор `:root[data-theme="light"]` (`color-scheme: light; --canvas: #ffffff; --text-primary: #0e0e0e; ...`).
3. **Инициализирующий инлайн-скрипт (`app/layout.tsx`):**
   - Инлайн-скрипт в `<head>` выставляет `document.documentElement.dataset.theme`.
   - В соответствии с решением об отказе от системной темы, скрипт использует `DEFAULT_THEME` (`"dark"`) в качестве базового значения при отсутствии сохраненного пользовательского выбора в `localStorage`. Обращение к `window.matchMedia` исключено.
4. **Отказоустойчивость и Zero FOUC:**
   - Если JavaScript в браузере отключен, заблокирован или упал до завершения парсинга DOM, терминал отображается в целевой тёмной теме без вспышек белого фона (Zero FOUC).
   - При наличии сохраненной темы `"light"` в `localStorage`, скрипт в `<head>` переключает `data-theme` до первой отрисовки страницы.

---

## 2. Публичный шов (Minimal Public Seam)

### Затрагиваемые файлы:
1. [`app/globals.css`](file:///c:/DATA/Development/js/z-trader-ai/app/globals.css) (CSS-токены)
2. [`app/layout.tsx`](file:///c:/DATA/Development/js/z-trader-ai/app/layout.tsx) (HTML Head Script)

### Ожидаемая структура селекторов в CSS:
```css
/* Базовые токены по умолчанию: Темная тема (DEFAULT_THEME = "dark") */
:root {
  color-scheme: dark;
  --canvas: #0e0e0e;
  --surface: #1a1a1a;
  --surface-raised: #242424;
  --text-primary: #ffffff;
  --text-secondary: #bdbdbd;
  --border: #393939;
  --grid: #2b2b2b;
  --brand-gold: #ffb700;
  --on-gold: #0e0e0e;
  --market-buy: #61d6ab;
  --market-sell: #ff8797;
  /* Шрифтовые переменные */
}

/* Переопределение для светлой темы */
:root[data-theme="light"] {
  color-scheme: light;
  --canvas: #ffffff;
  --surface: #f7f7f7;
  --surface-raised: #efefef;
  --text-primary: #0e0e0e;
  --text-secondary: #555555;
  --border: #d8d8d8;
  --grid: #e9e9e9;
  --brand-gold: #f5a600;
  --on-gold: #0e0e0e;
  --market-buy: #146c51;
  --market-sell: #b33142;
}
```

---

## 3. Критерии приемки (Given / When / Then)

### Сценарий 3.1: Первая загрузка без сохраненных настроек (No-JS / Fresh visit)
- **Given** браузер без сохраненного ключа темы в `localStorage`
- **When** страница загружается и парсится
- **Then** элемент `<html>` получает `data-theme="dark"`, стили фона и текста соответствуют темной теме (`--canvas: #0e0e0e`), белые вспышки отсутствуют

### Сценарий 3.2: Загрузка с сохраненной светлой темой
- **Given** в `localStorage` по ключу темы сохранено значение `"light"`
- **When** выполняется инициализирующий инлайн-скрипт в `<head>`
- **Then** на элемент `<html>` устанавливается атрибут `data-theme="light"` до отрисовки `<body>`, активируя стили светлой темы

### Сценарий 3.3: Согласованность токенов между CSS и JS
- **Given** константа `DEFAULT_THEME = "dark"` в `app/constants/theme.ts`
- **When** сопоставляются значения по умолчанию в CSS `:root` и константах проекта
- **Then** оба слоя строго ссылаются на тёмную тему как на базовое состояние

---

## 4. Компромиссы и обоснование (Trade-offs & Rationale)

- **Почему по умолчанию тёмная тема, а не светлая:**
  Z-Trader AI — профессиональный торговый терминал, где тёмная тема является отраслевым стандартом комфорта трейдера и первичным стилем спецификации `DESIGN.md`. Сделать светлую тему базовой в `:root` было источником багов FOUC и визуального рассогласования при любых сбоях клиентских скриптов.
- **Отказ от `matchMedia` в пользу `DEFAULT_THEME`:**
  В соответствии с утвержденным решением не внедрять системную тему, терминал стартует с детерминированной темной темы без попыток угадать цветовую схему ОС.
