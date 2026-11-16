# Skin Studio — редактор скинов Minecraft

Простой редактор скинов для Minecraft в виде десктопного приложения. Работает прямо в браузере, без установки и сервера.

## Возможности

- Карандаш, ластик, заливка и пипетка (правая кнопка мыши — ластик)
- Отмена и повтор действий (Ctrl+Z / Ctrl+Y)
- Палитра, недавние цвета и выбор цвета по HEX
- Масштабирование и сетка
- Предпросмотр персонажа с вторым слоем (куртка, шапка)
- Открытие PNG 64×64 и 64×32 (старый формат конвертируется автоматически)
- Перетаскивание PNG прямо в окно
- Сохранение в PNG

## Горячие клавиши

| Клавиша | Действие |
| --- | --- |
| P / E / F / I | Карандаш / Ластик / Заливка / Пипетка |
| Ctrl+Z | Отменить |
| Ctrl+Y или Ctrl+Shift+Z | Повторить |
| Ctrl+O | Открыть PNG |
| Ctrl+S | Сохранить PNG |

## Запуск

Откройте файл `index.html` в браузере. Либо запустите локальный сервер:

```bash
npx serve .
```

## Структура проекта

```
minecraft-skin-editor/
├── index.html   — разметка интерфейса
├── style.css    — оформление
├── app.js       — логика редактора
└── README.md
```

## Публикация на GitHub

```bash
git init
git add .
git commit -m "Add Skin Studio skin editor"
git branch -M main
git remote add origin https://github.com/<ваш-логин>/minecraft-skin-editor.git
git push -u origin main
```

Чтобы приложение открывалось по ссылке, включите GitHub Pages: **Settings → Pages → Deploy from a branch → main / (root)**.
