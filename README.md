# Family tree (Родинний архів)

[Українською](#українською) · [English](#english)

## Українською

Родинне дерево, яке живе у вашій папці. Люди, нотатки й фото зберігаються як звичайні файли на вашому комп’ютері: сайт нічого не вивантажує, не має сервера й не бачить ваших даних.

**Відкрити: <https://alekseenko.github.io/family-tree/>**

### Як почати

1. Відкрийте сайт у **Chrome** або **Edge** на комп’ютері.
2. Виберіть **Створити нове дерево** і вкажіть порожню папку, наприклад `Документи/Родина`. Або **Відкрити своє дерево**, якщо папка з `family.js` у вас уже є.
3. Додавайте людей кнопками **+** на картках. Кожна зміна записується в папку приблизно за секунду.

Браузер іноді питає, чи може сайт записувати в папку. Натисніть **Дозволити**, а якщо є варіант **Дозволяти під час кожного відвідування**, виберіть його, і питати більше не буде.

Firefox, Safari й телефони не вміють записувати в папки, тож там можна переглянути лише зразок, родину Коваленків.

### Що в папці

```
Родина/
├── family.js     усе дерево: люди, зв’язки, нотатки (JSON після «window.FAMILY_DATA =»)
├── photos/       фото, <особа>-<n>.jpg
└── backups/      щоденні копії family.js, останні 14
```

Це звичайні файли: копіюйте папку на флешку, у Dropbox чи iCloud, як будь-що інше. Щоб показати дерево родичам, дайте їм копію папки й посилання на сайт.

### Корисне

- Натисніть на людину, щоб дерево стало на ній по центру; ще один клік або **Enter** відкриває подробиці.
- **Показати всіх** унизу дерева (або **A**) показує всі покоління й гілки; **Esc** повертає до головної особи.
- **Перегляд** ховає всі кнопки редагування, щоб показати дерево родині.
- Дату можна писати як зручно: `12.03.1931`, `12 3 1931`, `12 березня 1931`, `березень 1931`, `1931`, `бл. 1930`.
- Під іменем у панелі видно, ким людина доводиться головній особі: «Ваша бабуся по матері», «Ваш тесть».
- ☰ → **Перевірка даних** показує дати, що не сходяться (смерть раніше за народження, дитина, народжена раніше за батьків чи після смерті матері), малоймовірний вік, можливі дублікати й людей без зв’язку з деревом.
- **Хронологія** (або **4**) — роки життя всіх, у кого відомий хоч один рік, одне під одним: наведіть на рік, щоб побачити, хто тоді жив; натисніть на людину, щоб відкрити її фото й нотатки.
- **Кадрувати** під портретом у панелі вибирає, яку частину головного фото видно на картках (можна й наблизити).
- **⌘Z / Ctrl+Z** скасовує будь-яку зміну, **?** показує всі клавіші.
- ☰ → **Завантажити family.js** — один файл з усім деревом і всіма фото, щоб надіслати родичам чи зберегти копію. Відкрити його: ☰ → **Імпорт** (фото опиняться в `photos/`; ті, що там уже є, не перезаписуються й не дублюються).
- ☰ → **Надрукувати постер…** — одна сторінка A3.
- ☰ → **Експорт GEDCOM** — для інших програм для родоводу. `family.js` зберігає все разом із фото, тож саме він — основна копія.

Коли виходить нова версія, сайт покаже **Оновити**; ваші дані при цьому не змінюються.

### Без інтернету

Можна завантажити цей репозиторій і відкрити `index.html` просто з диска. Тоді папкою даних може бути будь-яка папка, зокрема папка `data/` поруч із застосунком (її не видно в git).

---

## English

A family tree that lives in a folder you own. Open the site in Chrome or Edge on a computer, pick an empty folder (or one with an existing `family.js`), and every change is written there about a second later. There is no server and no analytics: the page loads only its own files, and your tree never leaves your computer. Other browsers and phones can only browse the bundled sample family. The interface is in Ukrainian.

### Development

No dependencies and no build step to run the app: plain `<script>` tags, so `index.html` also works opened from disk (ES modules and `fetch()` are blocked on `file://`).

```bash
node tests/tree-engine.test.js
```

```bash
node scripts/build-site.js _site dev
```

- `scripts/build-site.js` builds what GitHub Pages serves: the app and the sample (`family.js`, `photos/`), never `data/`. It stamps `version.js` and `version.json` with the commit, adds `?v=<commit>` to scripts and styles, and adds a Content Security Policy that allows only the site's own files.
- `.github/workflows/pages.yml` runs the tests on every push and pull request and publishes `main`. In the repository settings, set **Pages → Source** to **GitHub Actions** once.
- The app checks `version.json` at start, every 15 minutes and when the tab is shown again, and offers a reload when a newer build is live.
- `.claude/launch.json` serves the folder for the Claude Code preview pane only.

```
index.html, boot.js, version.js     page, error capture, build version
app.js, drawer.js, views.js         interface
tree-engine.js                      layout and data rules (tested)
storage.js                          folder (File System Access), browser copy, GEDCOM
ui.js, familytree.css, app.css      helpers, design system, additions
family.js, photos/                  the sample family
```

### License

MIT, see [LICENSE](LICENSE).
