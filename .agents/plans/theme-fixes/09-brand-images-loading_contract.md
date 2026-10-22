# Контракт 09: Оптимизация загрузки растровых PNG логотипов брендинга

- **Идентификатор контракта:** `09-brand-images-loading_contract.md`
- **Связанный пункт аудита:** Пункт 9 (`theme-system_review.md`)
- **Статус:** `APPROVED` (Архитектурная спецификация)

---

## 1. Архитектура и инварианты (System Architecture & Invariants)

1. **Исключение двойной загрузки графических ассетов:**
   Preload scanner современных браузеров инициирует загрузку элементов `<img>` с атрибутами `loading="eager"` и `fetchPriority="high"`, даже если на них навешан класс `display: none`. В DOM должен рендериться **только один** актуальный вариант изображения для текущей активной темы.
2. **Использование реактивного флага `isDark`:**
   Компоненты [`TopBar`](file:///c:/DATA/Development/js/z-trader-ai/app/components/top-bar.tsx) и [`WorkspaceCanvas`](file:///c:/DATA/Development/js/z-trader-ai/app/components/workspace-canvas.tsx) получают флаг `isDark` из хука `useTheme()` и селективно монтируют нужный ресурс:
   - Тёмная тема (`isDark: true`): `/logo-dark.png`, `/brand-dark.png`, `/logo-full-dark.png`
   - Светлая тема (`isDark: false`): `/logo.png`, `/brand.png`, `/logo-full.png`
3. **Нулевой сдвиг макета (Cumulative Layout Shift = 0):**
   Габариты контейнеров (`.brand-symbol`, `.brand-wordmark`, `.workspace-watermark`) и пропорции `aspect-ratio` сохраняются строго в соответствии со спецификацией [`DESIGN.md`](file:///c:/DATA/Development/js/z-trader-ai/DESIGN.md) и стилями [`app/globals.css`](file:///c:/DATA/Development/js/z-trader-ai/app/globals.css).
4. **Доступность (Accessibility):**
   Декоративные элементы брендинга сохраняют атрибут `aria-hidden="true"`, а текстовая метка терминала передается через `aria-label="Z-Trader AI"`.

---

## 2. Публичный шов (Minimal Public Seam)

### Затронутые компоненты:
1. [`app/components/top-bar.tsx`](file:///c:/DATA/Development/js/z-trader-ai/app/components/top-bar.tsx)
   - Экспорт: `export function TopBar(props: TopBarProps): JSX.Element;`
2. [`app/components/workspace-canvas.tsx`](file:///c:/DATA/Development/js/z-trader-ai/app/components/workspace-canvas.tsx)
   - Экспорт: `export function WorkspaceCanvas(props: { children?: ReactNode }): JSX.Element;`

---

## 3. Критерии приемки (Given / When / Then)

### Сценарий 3.1: Загрузка в активной тёмной теме
- **Given** активна тёмная тема (`isDark === true`)
- **When** рендерятся компоненты `TopBar` и `WorkspaceCanvas`
- **Then** в DOM присутствуют `<img>` только с путями `/logo-dark.png`, `/brand-dark.png` и `/logo-full-dark.png`; светлые варианты изображений отсутствуют в DOM-дереве

### Сценарий 3.2: Загрузка в активной светлой теме
- **Given** активна светлая тема (`isDark === false`)
- **When** рендерятся компоненты `TopBar` и `WorkspaceCanvas`
- **Then** в DOM присутствуют `<img>` только с путями `/logo.png`, `/brand.png` и `/logo-full.png`; тёмные варианты изображений отсутствуют в DOM-дереве

### Сценарий 3.3: Переключение темы на лету
- **Given** страница открыта в тёмной теме
- **When** пользователь переключает тему на светлую
- **Then** `src` изображений логотипа и водяного знака реактивно переключаются на светлые версии без нарушения верстки и без сдвига макета

---

## 4. Компромиссы и обоснование (Trade-offs & Rationale)

- **Почему селективный рендер в React вместо CSS `display: none`:**
  CSS-правило `display: none` не останавливает браузерный network preload scanner для картинок с высоким приоритетом. Только физическое отсутствие элемента в DOM гарантирует экономию более 50% трафика изображений на первом кадре загрузки терминала.
