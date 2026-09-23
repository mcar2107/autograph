# План прогона: sheet-markup-editor

База прогона: `6bd473baa5845a2aa43386f483d9226ae5ac1eb5`
Гейт: `npm run lint && npm test` + K4 (`md5 -q public/paper/profiles.json` = `bbb9e9b963bc092e50aad90f60fd39ce`)
Быстрые проверки: `npm run typecheck`, `npx vitest run --project=unit tests/<файл>`
Долгие слои: `npm run test:stories` — G2, G6–G9, G11; `npm run test:pwa` — G2, G11; `npm run test:visual` — G11
Хук коммита гоняет полный `typecheck` и `vitest --changed`: каждая группа оставляет типы и тесты зелёными.
Пути ниже — от `src/pages/Generator/`, если не начинаются с `tests/`, `.storybook/` или имени корневого файла.

## Контракты

- **K1 mirrorOverride** — `SheetRuling.mirrorOverride: {marginLineX, marginLineSide, marginLeft, marginRight} | null`,
  обязательное; `mirrorSheetRuling` применяет и обнуляет; нет в JSON → `null`. Владелец G1; потребители G4, G5, G9.
- **K2 булавки** — `RulingPin = {index, left: {x, y}, right: {x, y}}` в px фото; `fitRulingPins` → разлиновка или отказ +
  невязка каждой; `deriveRulingPins(ruling, frame)` — начальные (D2; контур берётся из `ruling.outline`, кадр нужен правому и нижнему полям). Владелец G1; потребители G4, G6, G7.
- **K3 изгиб и магнит** — `editRulingBend(ruling, point, delta, {radius, radiusX, isWholeColumn})`;
  `snapToRulingLine(image, point, step)` → точка или `null` (яркость, ±s/3, парабола); `snapToMarginLine(image, point, step)` — яркостный магнит линии поля (запасной путь серого снимка для G10); `refitRulingBend(image, ruling)` — «Подогнать по фото»; `resolveBendRadius(ruling, frame)` — радиусы по умолчанию; у `editRulingBend` опция `frame`. Вес узла гаснет к 2R (`FADE_REACH·R`) — G8 рисует кольцо на 2R. Владелец G3; потребители G7, G8, G10.
- **K4 детектор заморожен** — `git diff 6bd473b -- 'src/pages/Generator/lib/paper/'{detect,measure,trace,marginLine}'*'` пуст,
  кроме: G3 — необязательный `perspective` в `BendBaseRuling` (без него вывод до бита, `detectRuling.ts` не меняется);
  G1 — литералы `mirrorOverride: null`, если их требует тип. `profiles.json` бит-в-бит, `build:paper` не запускать. Все.
- **K5 воркер разбора** — единственный путь импорта и перемера: `Blob` + `SheetPhotoOptions` → `SheetPhotoMeasurement` +
  производные + `SheetImageData` (с `redMinusGreen`) для магнитов; до бита = `measureSheetPhoto` в основном потоке.
  Владелец G2; потребители G5, G6, G7, G10.
- **K6 запись листа** — IndexedDB `autograph`/`sheets`, ключ `id`: `{id, familyId, kind, label, width, height, ruling,
  measuredRuling, pins, lighting, source: Blob, texture: {image: Blob, width, height, amplitude} | null}` (isAnalyzed не хранится — прочитанное считается разобранным); прежняя: `kind = isBlank ? 'blank' : family.kind`,
  `pins = deriveRulingPins`; API асинхронное, `writeUserSheet(record, markup?)` → `Promise<boolean>`; без `markup` пишет measuredRuling = ruling и выводит pins — G5/G6 передают markup при каждой перезаписи, иначе затрут разметку автомата. Владелец G4; потребители G5, G6.
- **K7 стор** — флаг отказа записи, статус чтения своих листов, одно действие сохранения разметки `{ruling, pins, kind}`;
  семья по `kind` (D6). Владелец G5; потребители G6, G9.
- **K8 каркас редактора** — `ui/Generator/SettingsPane/SheetMarkupEditor/` с заглушками `OutlineTool LinesTool BendTool
  MarginsTool RulingKindControl MirrorTab TrialText`; черновик `model/useMarkupEditorStore.ts` (`commit(patch, {coalesceKey})`,
  undo/redo, сброс к `measuredRuling`); ручки — общий `MarkupHandle` (px фото, `aria-label`). Инструмент правит только
  свою папку. Владелец G6; потребители G7–G11.
- **K9 геометрия оверлея** — линии только через `getPageRuling` + `lineHeightAt` + `sampleRulingBend`, своей формулы нет.
  Владелец G6; потребители G7–G9.

## Группы

### G1 · Модель: зеркало и булавки · M · волна 1
- Задачи: 2.1, 2.2
- Зависит от: —
- Файлы: `lib/paper/{paper.types,sheetRuling,mirrorSheetRuling,index,fitRulingPins*}.ts`, `model/{paperSheetJson,measureLayout,geometrySelectors}.ts`, `config/paperFamilies.ts`, `tests/**` (фикстуры)
- Требования: `paper-profile` → «Ручная правка разлиновки сохраняется целиком»; `sheet-markup-editor` → «Линии правятся закреплением»
- Design: D2, D5
- Контракты: вводит K1, K2; соблюдает K4
- Усиление проверок: 2.1 — перекладку правой страницы мерить раскладкой, не отпечатком; 2.2 — эталон из параметров синтетики, не из формулы подгонки
### G2 · Разбор снимка в воркере · M · волна 1
- Задачи: 3.1, 3.2
- Зависит от: —
- Файлы: `model/*measureSheet*{worker,Client}*.ts`, `ui/Generator/SettingsPane/{useSheetImport,useSheetRemeasure}/**`, `vite.config.ts`, `tests/*worker*`
- Требования: `generator-settings` → «Разбор фотографии виден на своём элементе»; `paper-profile` → «Импорт фотографии листа…»
- Design: D8, D11
- Контракты: вводит K5; соблюдает K4
- Усиление проверок: 3.1 — в Chromium воркер против основного потока на 8 пресетах: вся `SheetPhotoMeasurement`, байты производных, `redMinusGreen`; разово то же на 26 живых снимках → `journal.md`
### G3 · Правка изгиба и магнит линий · M · волна 2
- Задачи: 2.3, 2.4, 2.6
- Зависит от: G1
- Файлы: `lib/paper/{editRulingBend,snapToRulingLine}*.ts`, `lib/paper/detectRulingBend.ts` (по K4), `lib/paper/index.ts`, `tests/paper-*`
- Требования: `sheet-markup-editor` → «Изгиб правится перетаскиванием», «Линии правятся закреплением» (магнит)
- Design: D2, D3, D8
- Контракты: вводит K3; соблюдает K4
- Усиление проверок: 2.3 — линию мерить `lineHeightAt` + `sampleRulingBend`; 2.4 — тест «без `perspective` вывод равен базе до бита»; 2.6 — линия в 0,4 шага не притягивается
### G4 · Хранилище своих листов в IndexedDB · M · волна 2
- Задачи: 1.1, 1.2, 1.3, 1.4
- Зависит от: G1
- Файлы: `model/{indexedDb*,userSheetsStorage*,paperSheetJson,useStoredUserSheets}.ts`, `model/useGeneratorStore*.ts` (только async-вызовы), `tests/helpers/jsdom-setup.ts`, `package*.json`, `tests/*user-sheets*`
- Требования: `paper-profile` → «Пользовательские листы сохраняются между сессиями»
- Design: D6, D10
- Контракты: вводит K6; потребляет K1, K2
- Усиление проверок: 1.4 — фикстуры `localStorage` в формате базы, не записанные новым кодом; 1.3 — чтение новым соединением через публичное API
### G5 · Стор и экран: отказ записи, асинхронный старт, вид листа · M · волна 3
- Задачи: 1.5, 1.6, 1.7, 2.5
- Зависит от: G2, G4
- Файлы: `model/{useGeneratorStore*,generator.types,useStoredUserSheets,paperSelectors,sessionSchema}.ts`, `ui/Generator/SettingsPane/{PaperPicker,useSheetImport}/**`, `ui/Generator/SheetViewport/**`, `tests/{paper-picker,session-refs,stored-user-sheets}*`
- Требования: `paper-profile` → «Пользовательские листы сохраняются между сессиями», «Импорт…» («Вид предложен по снимку»)
- Design: D6, D10
- Контракты: вводит K7; потребляет K5, K6
- Усиление проверок: 1.5 — отказ через настоящий импорт и `put`; 1.7 — отложенное чтение: до него ни одной страницы на пресете; 2.5 — через путь импорта
### G6 · Каркас редактора разметки · M · волна 4
- Задачи: 4.1, 4.2, 4.11
- Зависит от: G1, G2, G5
- Файлы: `ui/Generator/SettingsPane/{SheetMarkupEditor,SheetDialog,PaperPicker}/**`, `ui/Generator/SettingsPane/{SettingsPane.tsx,useSheetImport/*manualRulingRequest*}`, `model/useMarkupEditorStore*.ts`, `ui/Generator/useHistoryHotkeys/**`, `.storybook/visual-setup.ts`, `tests/{sheet-dialog,markup-editor-*}*`
- Требования: `sheet-markup-editor` → «Редактор открывается после импорта», «Разметка видна поверх фотографии», «Правка в редакторе отменяема до сохранения»; `generator-settings` → «Свой лист настраивается в отдельном диалоге»
- Design: D1, D13
- Контракты: вводит K8, K9; потребляет K2, K5, K7
- Усиление проверок: 4.1 — через импорт с плитки; `rg 'SheetDialogForm|manualRulingRequest' src` пуст; 4.2 — лента вызовов отрисовки против точек SVG из DOM; сверка на 26 живых снимках сразу после группы → `journal.md`; 4.11 — история генератора не меняется от Ctrl/⌘+Z в редакторе
### G7 · Инструменты «Контур» и «Линии» · M · волна 5
- Задачи: 4.3, 4.4
- Зависит от: G3, G6
- Файлы: `ui/Generator/SettingsPane/SheetMarkupEditor/{OutlineTool,LinesTool}/**`, `tests/markup-editor-{outline,lines}*`
- Требования: `sheet-markup-editor` → «Контур листа правится углами», «Линии правятся закреплением»; `paper-profile` → «Ручная правка границ листа перемеряет лист»
- Design: D1, D2, D3
- Контракты: потребляет K2, K3, K5, K8, K9
- Усиление проверок: 4.3 — перемер на отложенном промисе воркера; 4.4 — 19 линий считать в DOM, после сохранения страница по новому шагу
### G8 · Инструменты «Изгиб», «Поля» и вид разлиновки · M · волна 5
- Задачи: 4.5, 4.6, 4.7
- Зависит от: G3, G6
- Файлы: `ui/Generator/SettingsPane/SheetMarkupEditor/{BendTool,MarginsTool,RulingKindControl}/**`, `tests/markup-editor-{bend,margins,kind}*`
- Требования: `sheet-markup-editor` → «Изгиб правится перетаскиванием», «Поля и линия поля правятся направляющими», «Вид разлиновки выбирается»
- Design: D3, D4, D6
- Контракты: потребляет K3, K7, K8, K9
- Усиление проверок: 4.6, 4.7 — итог мерить геометрией блока и раскладкой после сохранения, не черновиком
### G9 · Точность, пробный текст, зеркало · M · волна 6
- Задачи: 4.8, 4.9, 4.10
- Зависит от: G7, G8
- Файлы: `ui/Generator/SettingsPane/SheetMarkupEditor/{MarkupHandle,Loupe,ExactValues,TrialText,MirrorTab}/**` и корень `SheetMarkupEditor/*.tsx`, `tests/markup-editor-{precision,trial,mirror}*`; `MarginsTool/**` — не трогать
- Требования: `sheet-markup-editor` → «Точная правка без мыши и числами», «Пробный текст проверяет разметку», «Зеркальная страница видна и правится в редакторе»
- Design: D1, D5, D12
- Контракты: потребляет K1, K7, K8, K9
- Усиление проверок: 4.8 — сдвиг стрелкой в px фото при зуме ≠ 1; 4.10 — чётная страница сохранённого листа через `getPageRuling`
### G10 · После #10: сверка и цветовой магнит линии поля · M · волна 6
- Задачи: 5.1, 5.2, 5.3
- Зависит от: G2, G3, G8
- Файлы: `lib/paper/{snapMarginLine*,index}.ts`, `ui/Generator/SettingsPane/SheetMarkupEditor/MarginsTool/**`, `tests/*snap-margin*`, `design.md`, `journal.md`
- Требования: `sheet-markup-editor` → «Поля и линия поля правятся направляющими»
- Design: D7, D11 — первым шагом сверить с кодом (`SheetImageData.redMinusGreen`, `MARGIN_LINE_COLOUR_GATE`); расхождение → правка design + журнал
- Контракты: потребляет K3, K5; соблюдает K4
- Усиление проверок: 5.3 — вертикаль клетки темнее красной черты по яркости (яркостный магнит промахнулся бы); серый снимок → яркостный магнит
### G11 · Stories, документация, финальный гейт · M · волна 7
- Задачи: 4.12, 7.3, 7.4, 7.5
- Зависит от: G9, G10
- Файлы: `ui/Generator/SettingsPane/SheetMarkupEditor/**/*.stories.tsx`, `tests/visual/**`, `CLAUDE.md`, `package*.json`, `journal.md`
- Требования: итоговое покрытие всех сценариев change
- Design: D1, D10
- Контракты: соблюдает K4
- Усиление проверок: 7.5 — «до» мерить на worktree базы `6bd473b` тем же скриптом на тех же 26 снимках

## Волны

1. G1, G2 — модель и воркер, файлы не пересекаются
2. G3, G4 — `lib/paper` против хранилища в `model/`
3. G5
4. G6
5. G7, G8 — свои папки инструментов (K8)
6. G9, G10 — `MarginsTool/**` только у G10
7. G11
