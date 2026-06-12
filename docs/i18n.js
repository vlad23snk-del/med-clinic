/* =====================================================================
   Переключение языка RU ⇄ EN. Общий файл для всех страниц.
   Перевод «свой» (ручной словарь), без сторонних сервисов.
   Движок заменяет текст в DOM по словарю и умеет возвращать обратно.
   Динамически добавленный контент переводится через MutationObserver.
   Подключается в конце страницы: <script src="i18n.js"></script>
   ===================================================================== */
(function () {
  "use strict";

  // ---- Словарь: русский → английский ----
  var EN = {
    // Навигация и общее
    "О нас": "About us", "Врачи": "Doctors", "Услуги и цены": "Services and prices",
    "Запись на приём": "Appointment booking", "Личный кабинет": "My account",
    "👤 Личный кабинет": "👤 My account", "На главную": "Home", "← На главную": "← Home",
    "← К списку врачей": "← Back to doctors", "← Назад к выбору": "← Back to selection",
    "Клиника": "Clinic", "«Здоровье»": "“Zdorovie”", "Контакты": "Contacts",
    "Разделы": "Sections", "Сайт": "Website",

    // Заголовки страниц (title)
    "Медицинский центр «Здоровье» — запись к врачу онлайн": "Zdorovie Medical Center — book a doctor online",
    "Наши врачи — Медицинский центр «Здоровье»": "Our doctors — Zdorovie Medical Center",
    "Профиль врача — Медицинский центр «Здоровье»": "Doctor's profile — Zdorovie Medical Center",
    "Услуги и цены — Медицинский центр «Здоровье»": "Services and prices — Zdorovie Medical Center",
    "Личный кабинет — Клиника «Здоровье»": "My account — Zdorovie Clinic",
    "Админ-панель — Клиника «Здоровье»": "Admin panel — Zdorovie Clinic",
    "Кабинет врача — Клиника «Здоровье»": "Doctor's office — Zdorovie Clinic",
    "Вход для сотрудников — Клиника «Здоровье»": "Staff login — Zdorovie Clinic",

    // Главная
    "Принимаем сегодня · онлайн-запись 24/7": "Open today · online booking 24/7",
    "Здоровье начинается с": "Health begins with", "правильного врача": "the right doctor",
    "Опишите, что беспокоит — искусственный интеллект подскажет нужного специалиста, покажет цены и поможет записаться онлайн за пару минут.":
      "Describe what bothers you — the AI will suggest the right specialist, show prices and help you book online in a couple of minutes.",
    "Например: «уже три дня кашель и температура»…": "E.g.: “cough and fever for three days”…",
    "Найти врача": "Find a doctor", "Популярное:": "Popular:",
    "зубная боль": "toothache", "больное горло": "sore throat", "давление": "blood pressure",
    "зрение": "vision", "кожа": "skin",
    "Перейти в Telegram": "Open Telegram", "Перейти в Ватсап": "Open WhatsApp",
    "довольных пациентов": "happy patients", "врачей-специалистов": "specialist doctors",
    "лет заботы о пациентах": "years of patient care", "средняя оценка": "average rating",
    "Почему мы": "Why us", "Почему пациенты выбирают нас": "Why patients choose us",
    "ИИ-подбор врача": "AI doctor matching",
    "Опишите симптомы простыми словами — нейросеть подскажет нужного специалиста и срочность.":
      "Describe symptoms in simple words — the AI will suggest the right specialist and urgency.",
    "Запись за 2 минуты": "Booking in 2 minutes",
    "Онлайн, в Telegram или по телефону — выбирайте удобный способ в любое время суток.":
      "Online, in Telegram or by phone — choose the convenient way any time of day.",
    "Напоминания": "Reminders",
    "Подтверждение и напоминания о приёме за день и за час, чтобы вы ничего не забыли.":
      "Confirmation and reminders a day and an hour before, so you don't forget anything.",
    "30+ направлений": "30+ specialties",
    "Опытные врачи ведущих специальностей и современная диагностика под одной крышей.":
      "Experienced doctors of leading specialties and modern diagnostics under one roof.",
    "Прозрачные цены": "Transparent prices",
    "Стоимость и длительность приёма видны заранее — без скрытых доплат и сюрпризов.":
      "The price and length of the appointment are shown in advance — no hidden fees or surprises.",
    "Забота о каждом": "Care for everyone",
    "Внимательное отношение, удобное расписание и помощь на всех этапах лечения.":
      "Attentive care, convenient scheduling and support at every stage of treatment.",
    "Наши врачи": "Our doctors", "Опытные врачи, которым доверяют": "Experienced doctors you can trust",
    "Более 20 специалистов ведущих направлений. Откройте профиль врача, посмотрите услуги и запишитесь онлайн.":
      "Over 20 specialists in leading fields. Open a doctor's profile, view services and book online.",
    "👨‍⚕️ Посмотреть всех врачей →": "👨‍⚕️ View all doctors →",
    "Отзывы": "Reviews", "Что говорят наши пациенты": "What our patients say",
    "Реальные истории людей, которым мы помогли почувствовать себя лучше.":
      "Real stories of people we helped feel better.",
    "«Записалась через сайт за минуту, ИИ сразу подсказал к какому врачу идти. Приём прошёл вовремя, всё внимательно объяснили.»":
      "“I booked through the site in a minute, the AI immediately suggested which doctor to see. The appointment was on time, everything was explained carefully.”",
    "«Очень удобно, что напомнили о приёме в Telegram за день и за час. Не забыл, не опоздал. Сервис на высоте!»":
      "“Very convenient that they reminded me about the appointment in Telegram a day and an hour before. Didn't forget, wasn't late. Great service!”",
    "«Понравилось, что цены видно сразу. Врач профессиональный, клиника чистая и современная. Рекомендую!»":
      "“I liked that prices are shown right away. The doctor was professional, the clinic clean and modern. Recommend!”",
    "Мария К.": "Maria K.", "Алексей Д.": "Alexey D.", "Елена С.": "Elena S.", "Иван Иванов": "Ivan Ivanov",
    "Актуально для пациентов": "Useful for patients", "Важно знать": "Important to know",
    "Сезонные опасности, вспышки заболеваний и полезные предупреждения. Берегите себя и близких.":
      "Seasonal risks, disease outbreaks and useful warnings. Take care of yourself and loved ones.",
    "Запишитесь на приём": "Book an appointment",
    "Заполните форму — администратор перезвонит, чтобы подтвердить дату и время.":
      "Fill out the form — an administrator will call back to confirm the date and time.",
    "Ваше имя *": "Your name *", "Иван Иванов ": "Ivan Ivanov",
    "Телефон *": "Phone *", "Врач / направление *": "Doctor / specialty *",
    "Выберите специалиста": "Select a specialist", "Желаемая дата": "Preferred date",
    "Комментарий": "Comment", "Опишите симптомы или пожелания (необязательно)": "Describe symptoms or requests (optional)",
    "Записаться на приём": "Book an appointment",
    "Приём по предварительной записи. Если не дозвонились — перезвоним в течение 15 минут.":
      "By appointment. If you can't reach us, we'll call back within 15 minutes.",
    "Современный медицинский центр с онлайн-записью, ИИ-подбором врача и заботой о каждом пациенте.":
      "A modern medical center with online booking, AI doctor matching and care for every patient.",
    "Современная клиника, где технологии помогают заботиться о вас быстрее и точнее.":
      "A modern clinic where technology helps care for you faster and more accurately.",
    "Имеются противопоказания. Необходима консультация специалиста.":
      "Contraindications exist. Consult a specialist.",
    "© 2026 Медицинский центр «Здоровье»": "© 2026 Zdorovie Medical Center",
    "© 2026 Медицинский центр «Здоровье». Все права защищены.": "© 2026 Zdorovie Medical Center. All rights reserved.",
    "г. Москва, ул. Здоровья, д. 1": "Moscow, Zdorovya St., 1",
    "📍 г. Москва, ул. Здоровья, д. 1": "📍 Moscow, Zdorovya St., 1",
    "🗺️ г. Москва, ул. Здоровья, д. 1": "🗺️ Moscow, Zdorovya St., 1",
    "Пн–Вс: 8:00 – 21:00": "Mon–Sun: 8:00 – 21:00", "🕒 Пн–Вс: 8:00 – 21:00": "🕒 Mon–Sun: 8:00 – 21:00",
    "🔐 Вход для владельцев или для врачей →": "🔐 Login for owners or doctors →",

    // Врачи / услуги
    "Наша команда": "Our team",
    "Выберите специалиста: посмотрите, чем он занимается, сколько стоит и сколько длится приём — и запишитесь онлайн.":
      "Choose a specialist: see what they do, the price and appointment length — and book online.",
    "Поиск по имени или специализации...": "Search by name or specialty...",
    "Все направления": "All specialties", "Загружаем врачей…": "Loading doctors…",
    "Загружаем профиль врача…": "Loading doctor's profile…", "Загружаем услуги…": "Loading services…",
    "Полный перечень услуг клиники: что входит, к какому врачу, сколько длится и сколько стоит. Найдите нужную услугу и запишитесь онлайн.":
      "The clinic's full list of services: what's included, which doctor, how long it takes and how much it costs. Find the service you need and book online.",
    "Поиск услуги, направления или врача...": "Search for a service, specialty or doctor...",

    // Личный кабинет
    "👤 Личный кабинет ": "👤 My account",
    "Введите номер телефона — пришлём код для входа.": "Enter your phone number — we'll send a login code.",
    "Номер телефона": "Phone number", "Войти через Telegram": "Log in with Telegram",
    "Войти через WhatsApp": "Log in with WhatsApp", "Введите код": "Enter the code",
    "Мы отправили 6-значный код. Введите его ниже.": "We've sent a 6-digit code. Enter it below.",
    "Код из сообщения": "Code from the message", "Войти": "Log in", "← Изменить номер": "← Change number",
    "Карточка клиента": "Client card", "🪪 Основная информация": "🪪 Basic information",
    "Эти данные видит врач, когда вы записываетесь на приём.": "The doctor sees this information when you book an appointment.",
    "Имя": "First name", "Фамилия": "Last name", "Дата рождения": "Date of birth", "Возраст": "Age",
    "напр. 35": "e.g. 35", "Пол": "Gender", "Мужской": "Male", "Женский": "Female",
    "Группа крови": "Blood type", "напр. II (A) Rh+": "e.g. II (A) Rh+",
    "Телефон": "Phone", "Email (необязательно)": "Email (optional)", "для копий уведомлений": "for copies of notifications",
    "🩺 Карточка клиента": "🩺 Client card",
    "Заполните заранее — врач увидит это перед приёмом и будет готов помочь.":
      "Fill in advance — the doctor will see this before the appointment and be ready to help.",
    "Хронические болезни и диагнозы": "Chronic conditions and diagnoses",
    "Напр.: гипертония, сахарный диабет 2 типа, гастрит…": "E.g.: hypertension, type 2 diabetes, gastritis…",
    "Аллергии": "Allergies", "Напр.: пенициллин, орехи, пыльца…": "E.g.: penicillin, nuts, pollen…",
    "Перенесённые операции": "Past surgeries", "Напр.: удаление аппендикса (2018)…": "E.g.: appendix removal (2018)…",
    "Постоянно принимаемые лекарства": "Medications taken regularly", "Напр.: эналаприл 5 мг утром…": "E.g.: enalapril 5 mg in the morning…",
    "Комментарии и пожелания": "Comments and requests", "Любая важная для врача информация…": "Any information important for the doctor…",
    "💾 Сохранить карточку": "💾 Save card", "📅 Мои записи": "📅 My appointments",
    "Ваши прошлые и будущие приёмы.": "Your past and upcoming appointments.",

    // Вход сотрудников / админ / врач
    "Вход для сотрудников": "Staff login",
    "Выберите своё окно входа: для владельцев — слева, для врачей — справа.":
      "Choose your login: owners on the left, doctors on the right.",
    "Админ-панель": "Admin panel", "Для владельцев и администраторов клиники. Все записи и статусы.":
      "For clinic owners and administrators. All records and statuses.",
    "Пароль администратора": "Administrator password", "Введите пароль": "Enter password",
    "Войти в админ-панель": "Log in to admin panel",
    "Кабинет врача": "Doctor's office", "Для каждого врача — свой профиль и свои пациенты.":
      "For each doctor — their own profile and patients.",
    "Выберите себя": "Select yourself", "Личный пароль": "Personal password",
    "Войти в кабинет врача": "Log in to doctor's office", "Загрузка списка…": "Loading list…",
    "— Выберите специалиста —": "— Select a specialist —",
    "Вход для сотрудников ": "Staff login",
    "Администратор клиники": "Clinic administrator", "Все записи, статусы, управление": "All records, statuses, management",
    "Свой профиль и свои пациенты": "Your own profile and patients", "Выберите, как вы хотите войти.": "Choose how you want to log in.",
    "Вход администратора": "Administrator login", "Введите пароль, чтобы увидеть записи пациентов.": "Enter the password to see patient records.",
    "Пароль": "Password", "← Назад к выбору ": "← Back to selection",
    "Выберите себя и введите личный пароль.": "Select yourself and enter your personal password.",
    "Врач": "Doctor", "Выйти": "Log out",
    "Новые": "New", "Подтверждённые": "Confirmed", "Выполненные": "Completed", "Отменённые": "Cancelled",
    "Все статусы": "All statuses", "Все источники": "All sources",
    "↻ Обновить": "↻ Refresh", "Поиск: имя, телефон, специалист…": "Search: name, phone, specialist…",
    "Когда": "When", "Пациент": "Patient", "Специалист / услуга": "Specialist / service",
    "Источник": "Source", "Статус": "Status", "Запись": "Appointment",
    "Загрузка…": "Loading…", "Карточка клиента: ": "Client card: ",

    // Динамические строки из скриптов (переводятся при появлении)
    "Новая": "New", "Подтверждена": "Confirmed", "Выполнена": "Completed", "Отменена": "Cancelled",
    "Записей не найдено.": "No records found.", "Записей не найдено": "No records found",
    "Записей пока нет.": "No records yet.", "сегодня": "today",
    "🪪 Открыть карточку": "🪪 Open client card", "Проверяем…": "Checking…",
    "Сохраняем…": "Saving…", "✅ Сохранено": "✅ Saved", "Отправляем код…": "Sending code…",
    "Неверный пароль": "Wrong password", "время уточняется": "time to be confirmed",
    "Пол:": "Gender:", "Возраст:": "Age:", "Аллергии:": "Allergies:"
  };

  var ATTRS = ["placeholder", "title", "aria-label", "alt"];
  var SKIP_TAGS = { SCRIPT: 1, STYLE: 1, NOSCRIPT: 1, TEXTAREA: 0 };

  var lang = "ru";
  try { lang = localStorage.getItem("lang") || "ru"; } catch (e) {}
  var origText = new WeakMap();   // текстовый узел → исходный русский текст
  var origAttr = new WeakMap();   // элемент → { attr: исходный текст }
  var origTitle = null;

  function translateString(s) {
    var k = s.trim();
    if (!k) return s;
    var en = EN[k];
    return en ? s.replace(k, en) : s;
  }

  function applyTextNode(node, toEn) {
    var orig = origText.get(node);
    if (orig === undefined) { orig = node.nodeValue; origText.set(node, orig); }
    node.nodeValue = toEn ? translateString(orig) : orig;
  }

  function applyAttrs(el, toEn) {
    var store = origAttr.get(el) || {};
    var touched = false;
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      if (store[a] === undefined) store[a] = el.getAttribute(a);
      el.setAttribute(a, toEn ? translateString(store[a]) : store[a]);
      touched = true;
    }
    if (touched) origAttr.set(el, store);
  }

  function walk(root, toEn) {
    if (root.nodeType === 3) { applyTextNode(root, toEn); return; }
    if (root.nodeType !== 1) return;
    if (SKIP_TAGS[root.nodeName]) return;
    var tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        var p = n.parentNode;
        if (!p || SKIP_TAGS[p.nodeName]) return NodeFilter.FILTER_REJECT;
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = tw.nextNode())) nodes.push(n);
    for (var i = 0; i < nodes.length; i++) applyTextNode(nodes[i], toEn);
    // атрибуты самого корня и потомков
    if (root.nodeType === 1) applyAttrs(root, toEn);
    var els = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (var j = 0; j < els.length; j++) applyAttrs(els[j], toEn);
  }

  function setLang(l) {
    lang = l;
    try { localStorage.setItem("lang", l); } catch (e) {}
    document.documentElement.setAttribute("lang", l);
    var toEn = l === "en";
    walk(document.body, toEn);
    if (origTitle === null) origTitle = document.title;
    document.title = toEn ? translateString(origTitle) : origTitle;
    var b = document.getElementById("langToggle");
    if (b) { b.textContent = toEn ? "RU" : "EN"; b.title = toEn ? "Switch to Russian" : "Перевести на английский"; }
  }

  // Перевод динамически добавленного контента (карточки, сообщения и т.п.)
  var observer = new MutationObserver(function (muts) {
    if (lang !== "en") return;
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) walk(added[j], true);
    }
  });

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.createElement("button");
    btn.id = "langToggle";
    btn.className = "lang-toggle";
    btn.setAttribute("aria-label", "Сменить язык / Change language");
    btn.textContent = lang === "en" ? "RU" : "EN";
    btn.addEventListener("click", function () { setLang(lang === "en" ? "ru" : "en"); });
    document.body.appendChild(btn);

    if (lang === "en") setLang("en"); // применяем сохранённый выбор
    observer.observe(document.body, { childList: true, subtree: true });
  });
})();
