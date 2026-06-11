// ============================================================
//  Edge Function: telegram-bot
//  Это «мозг» Telegram-бота. Telegram присылает сюда каждое сообщение
//  пользователя (через webhook), а функция ведёт диалог записи на приём
//  и сохраняет запись в ту же базу, что и сайт (таблица appointments).
//
//  Секреты (задаются в Supabase → Edge Functions → Secrets):
//    BOT_TOKEN   — токен бота от @BotFather
//    TG_SECRET   — (необязательно) секретное слово для проверки webhook
//  SUPABASE_URL и SUPABASE_SERVICE_ROLE_KEY Supabase подставляет сам.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const TG_SECRET = Deno.env.get("TG_SECRET") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Часовой пояс клиники (Москва, +03:00). Если клиника в другом поясе — поменяй здесь.
const TZ_OFFSET = "+03:00";

const db = createClient(SUPABASE_URL, SERVICE_KEY);

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ---- Вспомогательные функции для отправки в Telegram ----
async function tg(method: string, payload: unknown) {
  const r = await fetch(`${API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

function sendMessage(chat_id: number, text: string, extra: Record<string, unknown> = {}) {
  // Автоперевод статичных строк по словарю, если выбран английский
  return tg("sendMessage", { chat_id, text: tr(text), parse_mode: "HTML", ...extra });
}

function answerCallback(id: string, text = "") {
  return tg("answerCallbackQuery", { callback_query_id: id, text });
}

// Клавиатура «Поделиться номером телефона» (язык — по текущему пользователю)
function phoneKb() {
  return {
    keyboard: [[{ text: btn("phone"), request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
}

// Убрать обычную клавиатуру
const removeKeyboard = { remove_keyboard: true };

// ============ Язык интерфейса (ru / en) ============
type Lang = "ru" | "en";
let CURRENT_LANG: Lang = "ru"; // ставится в начале обработки каждого обновления

// Подписи кнопок главного меню — на двух языках
const BTN = {
  book:   { ru: "📅 Записаться на приём",            en: "📅 Book an appointment" },
  card:   { ru: "🪪 Заполнить карточку клиента",     en: "🪪 Fill in client card" },
  edit:   { ru: "✏️ Изменить карточку клиента",      en: "✏️ Edit client card" },
  notify: { ru: "📱 Подключить уведомления",         en: "📱 Enable notifications" },
  lang:   { ru: "🌐 English",                        en: "🌐 Русский" },
  phone:  { ru: "📱 Поделиться номером телефона",     en: "📱 Share phone number" },
};
type BtnKey = keyof typeof BTN;
function btn(key: BtnKey): string { return BTN[key][CURRENT_LANG]; }
function isBtn(text: string, key: BtnKey): boolean { return text === BTN[key].ru || text === BTN[key].en; }

// Словарь статичных сообщений: русский → английский.
// sendMessage переводит текст по этому словарю, если язык пользователя = en.
const STR: Record<string, string> = {
  "Спасибо! Теперь поделитесь номером телефона — он нужен, чтобы администратор мог с вами связаться.\n\nНажмите кнопку ниже 👇 (или просто напишите номер).":
    "Thanks! Now share your phone number — we need it so the administrator can contact you.\n\nTap the button below 👇 (or just type the number).",
  "К какому специалисту хотите записаться?": "Which specialist would you like to book?",
  "Выберите удобную дату приёма:": "Choose a convenient appointment date:",
  "Выберите удобное время:": "Choose a convenient time:",
  "⚠️ Не удалось сохранить запись. Попробуйте ещё раз позже или позвоните: 8 800 123-45-67.":
    "⚠️ Could not save the appointment. Please try again later or call: 8 800 123-45-67.",
  "Запись отменена. Если что — нажмите /start, чтобы начать заново.":
    "Appointment cancelled. If needed, tap /start to begin again.",
  "🔎 Анализирую вашу жалобу…": "🔎 Analyzing your symptoms…",
  "Это не диагноз — точную помощь окажет врач на приёме.": "This is not a diagnosis — a doctor will help you at the appointment.",
  "Чтобы точнее подобрать врача, уточните, пожалуйста, ваш пол:": "To pick the right doctor, please specify your gender:",
  "Спасибо! Опишите, что вас беспокоит, и я подскажу подходящего врача.": "Thanks! Describe what bothers you and I'll suggest the right doctor.",
  "Опишите, пожалуйста, что вас беспокоит, текстом 🙂": "Please describe what bothers you in text 🙂",
  "Похоже, номер неполный. Напишите телефон в формате +7XXXXXXXXXX или нажмите кнопку «Поделиться номером».":
    "The number seems incomplete. Type it as +7XXXXXXXXXX or tap the “Share phone number” button.",
  "Похоже, номер неполный. Напишите в формате +7XXXXXXXXXX или нажмите кнопку «Поделиться номером».":
    "The number seems incomplete. Type it as +7XXXXXXXXXX or tap the “Share phone number” button.",
  "✅ Готово! Уведомления подключены. Если вы записывались на сайте этим номером — пришлём подтверждение и напоминания сюда.":
    "✅ Done! Notifications enabled. If you booked on the site with this number, we'll send confirmations and reminders here.",
  "Напишите имя текстом (минимум 2 буквы).": "Type your name in text (at least 2 letters).",
  "Напишите фамилию текстом.": "Type your last name in text.",
  "Напишите возраст числом, например 35.": "Type your age as a number, e.g. 35.",
  "Пожалуйста, выберите пол кнопкой выше 👆": "Please choose your gender with the button above 👆",
  "Пожалуйста, выберите пол кнопкой 👇": "Please choose your gender with the button below 👇",
  "Пожалуйста, выберите вариант кнопкой выше 👆": "Please choose an option with the button above 👆",
  "✅ Ваша карточка клиента уже заполнена. Изменить данные можно в личном кабинете на сайте.":
    "✅ Your client card is already filled in. You can change the data in your account on the site.",
  "Заполним карточку клиента 🪪 Это займёт минуту, и врач будет готов к вашему приёму.\n\n<b>Шаг 1.</b> Напишите ваше <b>имя</b>:":
    "Let's fill in your client card 🪪 It takes a minute, and the doctor will be ready for your appointment.\n\n<b>Step 1.</b> Type your <b>first name</b>:",
  "<b>Шаг 2.</b> Ваша <b>фамилия</b>:": "<b>Step 2.</b> Your <b>last name</b>:",
  "<b>Шаг 3.</b> Ваш <b>номер телефона</b> — нажмите кнопку ниже или напишите номер:":
    "<b>Step 3.</b> Your <b>phone number</b> — tap the button below or type it:",
  "<b>Шаг 4.</b> Сколько вам <b>полных лет</b>?": "<b>Step 4.</b> How <b>old</b> are you (full years)?",
  "<b>Шаг 5.</b> Укажите ваш <b>пол</b>:": "<b>Step 5.</b> Specify your <b>gender</b>:",
  "<b>Шаг 6.</b> Ваш <b>email</b> (по желанию). Напишите почту или отправьте «-», чтобы пропустить:":
    "<b>Step 6.</b> Your <b>email</b> (optional). Type it or send “-” to skip:",
  "<b>Шаг 7.</b> Хронические <b>болезни</b> и диагнозы (или «-», если нет):":
    "<b>Step 7.</b> Chronic <b>conditions</b> and diagnoses (or “-” if none):",
  "<b>Шаг 8.</b> <b>Аллергии</b> (или «-», если нет):": "<b>Step 8.</b> <b>Allergies</b> (or “-” if none):",
  "<b>Шаг 9.</b> Перенесённые <b>операции</b> (или «-», если не было):":
    "<b>Step 9.</b> Past <b>surgeries</b> (or “-” if none):",
  "<b>Шаг 10.</b> Постоянные <b>лекарства</b> (или «-», если нет). Это последний вопрос:":
    "<b>Step 10.</b> Regular <b>medications</b> (or “-” if none). This is the last question:",
  "⚠️ Не удалось сохранить карточку. Попробуйте позже.": "⚠️ Could not save the card. Please try later.",
  "Готово! Изменения сохранены. 💙": "Done! Changes saved. 💙",
  "Выберите новый <b>пол</b>:": "Choose your new <b>gender</b>:",
  "✅ «Пол» обновлён.": "✅ “Gender” updated.",
  "✅ «Телефон» обновлён.": "✅ “Phone” updated.",
  "Ссылка для входа устарела. Вернитесь на сайт и нажмите «Войти с помощью Telegram» ещё раз.":
    "The login link has expired. Go back to the site and tap “Log in with Telegram” again.",
  "Не удалось распознать номер телефона. Вернитесь на сайт и нажмите «Войти с помощью Telegram» ещё раз.":
    "Could not recognize the phone number. Go back to the site and tap “Log in with Telegram” again.",
  "Язык переключён на русский. 🇷🇺": "Language switched to English. 🇬🇧",
};
function tr(text: string): string {
  return CURRENT_LANG === "en" && STR[text] ? STR[text] : text;
}

// Поля карточки клиента (подписи на двух языках) — для показа и редактирования
const CARD_FIELDS = [
  { key: "first_name",  ru: "Имя",                 en: "First name" },
  { key: "last_name",   ru: "Фамилия",             en: "Last name" },
  { key: "phone",       ru: "Телефон",             en: "Phone" },
  { key: "age",         ru: "Возраст",             en: "Age" },
  { key: "gender",      ru: "Пол",                 en: "Gender" },
  { key: "email",       ru: "Email",               en: "Email" },
  { key: "diseases",    ru: "Хронические болезни", en: "Chronic conditions" },
  { key: "allergies",   ru: "Аллергии",            en: "Allergies" },
  { key: "surgeries",   ru: "Операции",            en: "Surgeries" },
  { key: "medications", ru: "Лекарства",           en: "Medications" },
];
function fieldLabel(f: any): string { return f[CURRENT_LANG]; }

// Красивое значение поля для показа
function cardValue(p: any, key: string): string {
  const v = p?.[key];
  if (v === null || v === undefined || v === "") return "—";
  if (key === "phone") return "+7" + v;
  if (key === "gender") {
    if (v === "м") return CURRENT_LANG === "en" ? "Male" : "Мужской";
    if (v === "ж") return CURRENT_LANG === "en" ? "Female" : "Женский";
    return String(v);
  }
  return String(v);
}

// ---- Память о пациенте: ищем его медкарту по Telegram ID ----
async function getPatientByChat(chat_id: number) {
  const { data } = await db.from("patients").select("*").eq("telegram_chat_id", chat_id).maybeSingle();
  return data;
}
// Карта считается заполненной, если есть имя и телефон
function cardFilled(p: any): boolean {
  return !!(p && p.first_name && p.phone);
}

// Главное меню — динамическое: пока карточка клиента не заполнена, предлагаем её
// заполнить; после заполнения показываем «Изменить карточку клиента».
async function menuFor(chat_id: number) {
  const p = await getPatientByChat(chat_id);
  const rows: unknown[] = [[{ text: btn("book") }]];
  rows.push([{ text: cardFilled(p) ? btn("edit") : btn("card") }]);
  rows.push([{ text: btn("notify"), request_contact: true }]);
  rows.push([{ text: btn("lang") }]); // переключение языка RU/EN
  return { keyboard: rows, resize_keyboard: true };
}

// ---- Работа с состоянием диалога (хранится в таблице telegram_users) ----
async function getUser(chat_id: number) {
  const { data } = await db.from("telegram_users").select("*").eq("chat_id", chat_id).maybeSingle();
  return data;
}

async function saveState(chat_id: number, patch: Record<string, unknown>) {
  await db.from("telegram_users").upsert({ chat_id, updated_at: new Date().toISOString(), ...patch });
}

function onlyDigits(s: string) {
  return (s || "").replace(/\D/g, "");
}

// SHA-256 (hex) — тем же способом, что и в patient-api, чтобы код входа совпал
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Вход в личный кабинет: телефон передаётся прямо в ссылке t.me/бот?start=p_<10цифр>.
// ПРИВЯЗКА: записываем chat_id ↔ phone (telegram_users), генерируем код и шлём в чат.
async function sendLoginCodeForPhone(chat_id: number, phoneRaw: string) {
  const phone = onlyDigits(phoneRaw).slice(-10);
  if (phone.length !== 10) {
    return sendMessage(
      chat_id,
      "Не удалось распознать номер телефона. Вернитесь на сайт и нажмите «Войти с помощью Telegram» ещё раз.",
      { reply_markup: await menuFor(chat_id) },
    );
  }
  // Привязываем телефон к этому чату (для входа + будущих подтверждений и напоминаний)
  await saveState(chat_id, { phone });
  // Генерируем код и сохраняем его хеш — сайт проверит ввод по таблице patient_codes
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await db.from("patient_codes").upsert({
    phone,
    code_hash: await sha256(code),
    channel: "telegram",
    attempts: 0,
    expires_at: new Date(Date.now() + 5 * 60000).toISOString(),
    created_at: new Date().toISOString(),
  });
  const codeMsg = CURRENT_LANG === "en"
    ? `🔐 <b>Login code for your account</b>\n\nYour code: <b>${code}</b>\n\nEnter it on the site to log in. The code is valid for 5 minutes. Don't share it with anyone.`
    : `🔐 <b>Код для входа в личный кабинет</b>\n\nВаш код: <b>${code}</b>\n\nВведите его на сайте, чтобы войти. Код действует 5 минут. Никому не сообщайте его.`;
  return sendMessage(chat_id, codeMsg, { reply_markup: await menuFor(chat_id) });
}

// Старый способ (ссылка с токеном code_<token>) — оставлен для совместимости.
async function sendLoginCode(chat_id: number, token: string) {
  const { data: row } = await db.from("tg_login").select("phone, expires_at").eq("token", token).maybeSingle();
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return sendMessage(chat_id, "Ссылка для входа устарела. Вернитесь на сайт и нажмите «Войти с помощью Telegram» ещё раз.", { reply_markup: await menuFor(chat_id) });
  }
  await db.from("tg_login").delete().eq("token", token);
  return sendLoginCodeForPhone(chat_id, row.phone);
}

// ---- Списки врачей и специальностей из базы ----
async function loadSpecialties(): Promise<{ spec: string; doctor: string | null }[]> {
  const { data: services } = await db.from("services").select("specialty");
  const { data: docs } = await db.from("doctors").select("name, specialty");
  const docBySpec = new Map<string, string>();
  (docs ?? []).forEach((d: any) => {
    if (d.specialty && !docBySpec.has(d.specialty)) docBySpec.set(d.specialty, d.name);
  });
  const specs = [...new Set((services ?? []).map((s: any) => s.specialty).filter(Boolean))];
  specs.sort((a, b) => String(a).localeCompare(String(b), "ru"));
  return specs.map((spec) => ({ spec, doctor: docBySpec.get(spec) ?? null }));
}

// ---- Построение клавиатур (кнопок) ----
function specialtyKeyboard(list: { spec: string }[]) {
  const rows = [];
  for (let i = 0; i < list.length; i += 2) {
    const row = [{ text: list[i].spec, callback_data: `sp:${i}` }];
    if (list[i + 1]) row.push({ text: list[i + 1].spec, callback_data: `sp:${i + 1}` });
    rows.push(row);
  }
  return { inline_keyboard: rows };
}

const WD = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function fmtDateHuman(d: Date) {
  return `${WD[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}`;
}

function dateKeyboard() {
  const rows = [];
  const today = new Date();
  let row: any[] = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const iso = d.toISOString().slice(0, 10); // YYYY-MM-DD
    row.push({ text: fmtDateHuman(d), callback_data: `d:${iso}` });
    if (row.length === 2) { rows.push(row); row = []; }
  }
  if (row.length) rows.push(row);
  return { inline_keyboard: rows };
}

function timeKeyboard() {
  const times = ["09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];
  const rows = [];
  for (let i = 0; i < times.length; i += 3) {
    rows.push(times.slice(i, i + 3).map((t) => ({ text: t, callback_data: `t:${t}` })));
  }
  return { inline_keyboard: rows };
}

const confirmKeyboard = {
  inline_keyboard: [[
    { text: "✅ Подтвердить запись", callback_data: "ok" },
    { text: "✖️ Отменить", callback_data: "cancel" },
  ]],
};

// ---- Шаги диалога ----
async function startBooking(chat_id: number, user: any) {
  await saveState(chat_id, { state: { step: "name", data: {} } });
  const greetName = user?.full_name ? `, ${user.full_name}` : "";
  const msg = CURRENT_LANG === "en"
    ? `Great${greetName}! I'll book your appointment in a minute. 🩺\n\nWhat's your name? (Last and first name)`
    : `Отлично${greetName}! Запишу вас на приём за минуту. 🩺\n\nКак вас зовут? (Фамилия и имя)`;
  await sendMessage(chat_id, msg, { reply_markup: removeKeyboard });
}

async function askPhone(chat_id: number) {
  await sendMessage(
    chat_id,
    "Спасибо! Теперь поделитесь номером телефона — он нужен, чтобы администратор мог с вами связаться.\n\nНажмите кнопку ниже 👇 (или просто напишите номер).",
    { reply_markup: phoneKb() },
  );
}

async function askSpecialty(chat_id: number, data: any) {
  const list = await loadSpecialties();
  data.specialties = list; // запоминаем список, чтобы потом узнать выбор по номеру
  await saveState(chat_id, { state: { step: "specialty", data } });
  await sendMessage(chat_id, "К какому специалисту хотите записаться?", {
    reply_markup: specialtyKeyboard(list),
  });
}

// После телефона: если специальность уже выбрана (например, подсказал ИИ) —
// сразу переходим к дате, иначе спрашиваем специальность.
async function afterPhone(chat_id: number, data: any) {
  if (data.specialty) return askDate(chat_id, data);
  return askSpecialty(chat_id, data);
}

async function askDate(chat_id: number, data: any) {
  await saveState(chat_id, { state: { step: "date", data } });
  await sendMessage(chat_id, "Выберите удобную дату приёма:", { reply_markup: dateKeyboard() });
}

async function askTime(chat_id: number, data: any) {
  await saveState(chat_id, { state: { step: "time", data } });
  await sendMessage(chat_id, "Выберите удобное время:", { reply_markup: timeKeyboard() });
}

function summaryText(data: any) {
  const d = new Date(`${data.date}T${data.time}:00${TZ_OFFSET}`);
  const human = `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${data.time}`;
  const en = CURRENT_LANG === "en";
  const docLine = data.doctor && data.doctor !== "—" ? `\n👨‍⚕️ ${en ? "Doctor" : "Врач"}: <b>${data.doctor}</b>` : "";
  return en
    ? "Please check the appointment:\n\n" +
      `👤 Name: <b>${data.full_name}</b>\n📞 Phone: <b>${data.phone}</b>\n` +
      `🩺 Specialist: <b>${data.specialty}</b>${docLine}\n📅 When: <b>${human}</b>\n\nIs everything correct?`
    : "Проверьте запись:\n\n" +
      `👤 Имя: <b>${data.full_name}</b>\n📞 Телефон: <b>${data.phone}</b>\n` +
      `🩺 Специалист: <b>${data.specialty}</b>${docLine}\n📅 Когда: <b>${human}</b>\n\nВсё верно?`;
}

async function askConfirm(chat_id: number, data: any) {
  await saveState(chat_id, { state: { step: "confirm", data } });
  await sendMessage(chat_id, summaryText(data), { reply_markup: confirmKeyboard });
}

async function finishBooking(chat_id: number, data: any) {
  const appointment_at = new Date(`${data.date}T${data.time}:00${TZ_OFFSET}`).toISOString();

  const { error } = await db.from("appointments").insert({
    full_name: data.full_name,
    phone: data.phone,
    specialty: data.specialty,
    doctor_name: data.doctor && data.doctor !== "—" ? data.doctor : null,
    appointment_at,
    preferred_date: data.date,
    telegram_chat_id: chat_id,
    source: "telegram",
    status: "confirmed",
    confirmation_sent: true, // подтверждение бот отправляет прямо сейчас
  });

  // Сбрасываем диалог, но сохраняем телефон/имя на будущее
  await saveState(chat_id, {
    full_name: data.full_name,
    phone: data.phone,
    state: {},
  });

  if (error) {
    await sendMessage(chat_id, "⚠️ Не удалось сохранить запись. Попробуйте ещё раз позже или позвоните: 8 800 123-45-67.");
    return;
  }

  const d = new Date(appointment_at);
  const human = `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}, ${data.time}`;
  const done = CURRENT_LANG === "en"
    ? `✅ <b>Done! You're booked.</b>\n\n🩺 Specialist: <b>${data.specialty}</b>\n📅 When: <b>${human}</b>\n\n` +
      `We'll remind you <b>a day</b> and <b>an hour</b> before.\nIf your plans change, call: 8 800 123-45-67.\n\nStay healthy! 💙`
    : `✅ <b>Готово! Вы записаны.</b>\n\n🩺 Специалист: <b>${data.specialty}</b>\n📅 Когда: <b>${human}</b>\n\n` +
      `Мы напомним вам <b>за день</b> и <b>за час</b> до приёма.\nЕсли планы изменятся — позвоните: 8 800 123-45-67.\n\nБудьте здоровы! 💙`;
  await sendMessage(chat_id, done, { reply_markup: removeKeyboard });
}

// ============================================================
//  Мастер заполнения медкарты в Telegram (пошаговый опрос)
//  Сохраняет в ту же таблицу patients, что и сайт. Привязывает к Telegram ID.
// ============================================================
const SKIP_WORDS = ["-", "–", "—", "нет", "пропустить", "skip"];
function isSkip(t: string) { return SKIP_WORDS.includes((t || "").trim().toLowerCase()); }

// Начать заполнение медкарты
async function startCard(chat_id: number) {
  const existing = await getPatientByChat(chat_id);
  if (cardFilled(existing)) {
    return sendMessage(chat_id, "✅ Ваша карточка клиента уже заполнена. Изменить данные можно в личном кабинете на сайте.", { reply_markup: await menuFor(chat_id) });
  }
  const user = await getUser(chat_id);
  const card: Record<string, unknown> = {};
  if (user?.phone) card.phone = onlyDigits(user.phone).slice(-10); // если телефон уже знаем
  await saveState(chat_id, { state: { step: "card_first", data: { card } } });
  return sendMessage(
    chat_id,
    "Заполним карточку клиента 🪪 Это займёт минуту, и врач будет готов к вашему приёму.\n\n<b>Шаг 1.</b> Напишите ваше <b>имя</b>:",
    { reply_markup: removeKeyboard },
  );
}

// Сохранить заполненную медкарту в базу
async function saveCard(chat_id: number, card: any) {
  const row: Record<string, unknown> = {
    phone: card.phone,
    first_name: card.first_name ?? null,
    last_name: card.last_name ?? null,
    age: card.age ?? null,
    gender: card.gender ?? null,
    email: card.email ?? null,
    diseases: card.diseases ?? null,
    allergies: card.allergies ?? null,
    surgeries: card.surgeries ?? null,
    medications: card.medications ?? null,
    telegram_chat_id: chat_id,
    updated_at: new Date().toISOString(),
  };
  // upsert по телефону — это та же карта, что и в личном кабинете на сайте
  const { error } = await db.from("patients").upsert(row, { onConflict: "phone" });
  // запоминаем имя и телефон также в telegram_users
  await saveState(chat_id, {
    full_name: [card.first_name, card.last_name].filter(Boolean).join(" "),
    phone: card.phone,
    state: {},
  });
  if (error) {
    return sendMessage(chat_id, "⚠️ Не удалось сохранить карточку. Попробуйте позже.", { reply_markup: await menuFor(chat_id) });
  }
  const fio = [card.first_name, card.last_name].filter(Boolean).join(" ");
  const en = CURRENT_LANG === "en";
  const saved = en
    ? `✅ <b>Client card saved!</b>\n\n` +
      `👤 ${fio}\n📞 +7${card.phone}\n🎂 Age: ${card.age}\n\n` +
      `Thanks! The doctor will now see your card when you book an appointment. ` +
      `You can change the data anytime in your account on the site.`
    : `✅ <b>Карточка клиента сохранена!</b>\n\n` +
      `👤 ${fio}\n📞 +7${card.phone}\n🎂 Возраст: ${card.age}\n\n` +
      `Спасибо! Теперь врач увидит вашу карту, когда вы запишетесь на приём. ` +
      `Изменить данные всегда можно в личном кабинете на сайте.`;
  return sendMessage(
    chat_id,
    saved,
    { reply_markup: await menuFor(chat_id) },
  );
}

// Обработка одного шага мастера (текстовые ответы)
async function handleCardStep(chat_id: number, st: any, text: string) {
  const card = st.data?.card ?? {};
  const t = text.trim();

  if (st.step === "card_first") {
    if (t.length < 2) return sendMessage(chat_id, "Напишите имя текстом (минимум 2 буквы).");
    card.first_name = t;
    await saveState(chat_id, { state: { step: "card_last", data: { card } } });
    return sendMessage(chat_id, "<b>Шаг 2.</b> Ваша <b>фамилия</b>:");
  }
  if (st.step === "card_last") {
    if (t.length < 2) return sendMessage(chat_id, "Напишите фамилию текстом.");
    card.last_name = t;
    if (card.phone) { // телефон уже знаем — пропускаем шаг 3
      await saveState(chat_id, { state: { step: "card_age", data: { card } } });
      return sendMessage(chat_id, "<b>Шаг 4.</b> Сколько вам <b>полных лет</b>?", { reply_markup: removeKeyboard });
    }
    await saveState(chat_id, { state: { step: "card_phone", data: { card } } });
    return sendMessage(chat_id, "<b>Шаг 3.</b> Ваш <b>номер телефона</b> — нажмите кнопку ниже или напишите номер:", { reply_markup: phoneKb() });
  }
  if (st.step === "card_phone") {
    const digits = onlyDigits(t);
    if (digits.length < 10) return sendMessage(chat_id, "Похоже, номер неполный. Напишите в формате +7XXXXXXXXXX или нажмите кнопку «Поделиться номером».", { reply_markup: phoneKb() });
    card.phone = digits.slice(-10);
    await saveState(chat_id, { state: { step: "card_age", data: { card } } });
    return sendMessage(chat_id, "<b>Шаг 4.</b> Сколько вам <b>полных лет</b>?", { reply_markup: removeKeyboard });
  }
  if (st.step === "card_age") {
    const age = parseInt(onlyDigits(t), 10);
    if (!age || age < 1 || age > 120) return sendMessage(chat_id, "Напишите возраст числом, например 35.");
    card.age = age;
    await saveState(chat_id, { state: { step: "card_gender", data: { card } } });
    return sendMessage(chat_id, "<b>Шаг 5.</b> Укажите ваш <b>пол</b>:", {
      reply_markup: { inline_keyboard: [[
        { text: "👨 Мужской", callback_data: "card_g:м" },
        { text: "👩 Женский", callback_data: "card_g:ж" },
      ]] },
    });
  }
  if (st.step === "card_gender") {
    return sendMessage(chat_id, "Пожалуйста, выберите пол кнопкой выше 👆");
  }
  if (st.step === "card_email") {
    card.email = isSkip(t) ? null : t;
    await saveState(chat_id, { state: { step: "card_diseases", data: { card } } });
    return sendMessage(chat_id, "<b>Шаг 7.</b> Хронические <b>болезни</b> и диагнозы (или «-», если нет):");
  }
  if (st.step === "card_diseases") {
    card.diseases = isSkip(t) ? null : t;
    await saveState(chat_id, { state: { step: "card_allergies", data: { card } } });
    return sendMessage(chat_id, "<b>Шаг 8.</b> <b>Аллергии</b> (или «-», если нет):");
  }
  if (st.step === "card_allergies") {
    card.allergies = isSkip(t) ? null : t;
    await saveState(chat_id, { state: { step: "card_surgeries", data: { card } } });
    return sendMessage(chat_id, "<b>Шаг 9.</b> Перенесённые <b>операции</b> (или «-», если не было):");
  }
  if (st.step === "card_surgeries") {
    card.surgeries = isSkip(t) ? null : t;
    await saveState(chat_id, { state: { step: "card_meds", data: { card } } });
    return sendMessage(chat_id, "<b>Шаг 10.</b> Постоянные <b>лекарства</b> (или «-», если нет). Это последний вопрос:");
  }
  if (st.step === "card_meds") {
    card.medications = isSkip(t) ? null : t;
    return saveCard(chat_id, card);
  }
}

// ---- Изменение медкарты в Telegram (показ по пунктам + кнопки с цифрами) ----
// Показывает всю карту по пунктам 1–10 и кнопки выбора пункта для изменения.
async function showEditCard(chat_id: number) {
  const p = await getPatientByChat(chat_id);
  if (!cardFilled(p)) return startCard(chat_id); // карты ещё нет — предложим заполнить

  const en = CURRENT_LANG === "en";
  let body = en ? "🪪 <b>Your client card:</b>\n\n" : "🪪 <b>Ваша карточка клиента:</b>\n\n";
  CARD_FIELDS.forEach((f, i) => {
    body += `${i + 1}. ${fieldLabel(f)}: <b>${cardValue(p, f.key)}</b>\n`;
  });
  body += en ? "\nWhich item would you like to change?" : "\nКакой пункт вы хотите изменить?";

  // Кнопки с цифрами пунктов: 1–5, 6–10, затем «Готово»
  const nums = CARD_FIELDS.map((_, i) => ({ text: String(i + 1), callback_data: `ef:${i}` }));
  const inline_keyboard = [nums.slice(0, 5), nums.slice(5, 10), [{ text: en ? "✅ Done" : "✅ Готово", callback_data: "ef_done" }]];
  return sendMessage(chat_id, body, { reply_markup: { inline_keyboard } });
}

// Сохраняет одно изменённое поле медкарты (привязка по Telegram ID)
async function updatePatientField(chat_id: number, key: string, value: unknown) {
  await db.from("patients").update({ [key]: value, updated_at: new Date().toISOString() }).eq("telegram_chat_id", chat_id);
  // держим имя/телефон в telegram_users в актуальном виде
  const p = await getPatientByChat(chat_id);
  if (p) {
    await saveState(chat_id, {
      full_name: [p.first_name, p.last_name].filter(Boolean).join(" "),
      ...(p.phone ? { phone: p.phone } : {}),
    });
  }
}

// ---- ИИ-консультант по симптомам (как умный поиск на сайте) ----
const URGENCY: Record<string, string> = {
  emergency: "⚠️ Похоже на срочную ситуацию. При острых симптомах звоните 103 (скорая помощь).",
  soon: "🟠 Желательно обратиться к врачу в ближайшее время.",
  routine: "🟢 Плановое обращение.",
};

// Анализирует свободную жалобу пациента и советует специалиста.
// Использует ту же серверную функцию symptom-search (OpenAI), что и сайт.
async function handleSymptom(chat_id: number, text: string) {
  const user = await getUser(chat_id);
  const sex = user?.sex;
  // Пол спрашиваем ОДИН раз и запоминаем — чтобы не советовать, например,
  // гинеколога мужчине. Жалобу сохраняем и продолжим после ответа о поле.
  if (sex !== "male" && sex !== "female") {
    await saveState(chat_id, { state: { step: "ask_sex", data: { pendingSymptom: text } } });
    return sendMessage(chat_id, "Чтобы точнее подобрать врача, уточните, пожалуйста, ваш пол:", {
      reply_markup: { inline_keyboard: [[
        { text: "👨 Мужской", callback_data: "sex:male" },
        { text: "👩 Женский", callback_data: "sex:female" },
      ]] },
    });
  }
  return runSymptomAnalysis(chat_id, text, sex);
}

// Сам ИИ-анализ жалобы — уже с известным полом пациента
async function runSymptomAnalysis(chat_id: number, text: string, sex: string) {
  await sendMessage(chat_id, "🔎 Анализирую вашу жалобу…");

  const list = await loadSpecialties();
  const specialties = list.map((x) => x.spec);

  let specialty = "Терапевт";
  let advice = "";
  let urgency = "routine";

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/symptom-search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${SERVICE_KEY}`,
        "apikey": SERVICE_KEY,
      },
      body: JSON.stringify({ symptoms: text, specialties, sex }),
    });
    if (resp.ok) {
      const d = await resp.json();
      if (!d.error) {
        specialty = d.specialty || "Терапевт";
        advice = d.advice || "";
        urgency = d.urgency || "routine";
      }
    }
  } catch (_) {
    /* если ИИ временно недоступен — мягко советуем Терапевта */
  }

  // специалист обязательно должен быть из нашего списка
  if (!specialties.includes(specialty)) specialty = "Терапевт";

  const en = CURRENT_LANG === "en";
  let out = en
    ? `🩺 I recommend seeing a specialist: <b>${specialty}</b>\n\n`
    : `🩺 Рекомендую обратиться к специалисту: <b>${specialty}</b>\n\n`;
  if (advice) out += advice + "\n\n";
  if (URGENCY[urgency]) out += URGENCY[urgency] + "\n\n";
  out += en ? "This is not a diagnosis — a doctor will help you at the appointment." : "Это не диагноз — точную помощь окажет врач на приёме.";

  return sendMessage(chat_id, out, {
    reply_markup: { inline_keyboard: [[{ text: `📅 ${en ? "Book with" : "Записаться к"}: ${specialty}`, callback_data: `bookspec:${specialty}` }]] },
  });
}

// ---- Главный обработчик одного обновления от Telegram ----
async function handleUpdate(update: any) {
  // Язык пользователя — для всех ответов в этом обновлении
  const _cid = update.callback_query?.message?.chat?.id ?? update.message?.chat?.id;
  CURRENT_LANG = _cid ? ((await getUser(_cid))?.lang === "en" ? "en" : "ru") : "ru";

  // 1) Нажатие на кнопку (inline)
  if (update.callback_query) {
    const cq = update.callback_query;
    const chat_id = cq.message.chat.id;
    const dataStr: string = cq.data || "";
    await answerCallback(cq.id);

    const user = await getUser(chat_id);
    const st = user?.state ?? {};

    if (dataStr === "book") return startBooking(chat_id, user);

    // Запись к специалисту, которого подсказал ИИ-консультант (специальность уже известна)
    if (dataStr.startsWith("bookspec:")) {
      const spec = dataStr.slice(9);
      const list = await loadSpecialties();
      const found = list.find((x) => x.spec === spec);
      await saveState(chat_id, { state: { step: "name", data: { specialty: spec, doctor: found?.doctor ?? null } } });
      const m = CURRENT_LANG === "en"
        ? `Booking you with the specialist “${spec}”. 🩺\n\nWhat's your name? (Last and first name)`
        : `Записываю вас к специалисту «${spec}». 🩺\n\nКак вас зовут? (Фамилия и имя)`;
      return sendMessage(chat_id, m, { reply_markup: removeKeyboard });
    }

    // Изменение медкарты: завершить
    if (dataStr === "ef_done") {
      await saveState(chat_id, { state: {} });
      return sendMessage(chat_id, "Готово! Изменения сохранены. 💙", { reply_markup: await menuFor(chat_id) });
    }

    // Изменение медкарты: выбран пункт N → спрашиваем новое значение
    if (dataStr.startsWith("ef:")) {
      const idx = Number(dataStr.slice(3));
      const f = CARD_FIELDS[idx];
      if (!f) return;
      await saveState(chat_id, { state: { step: "edit_field", data: { fieldIdx: idx } } });
      const en = CURRENT_LANG === "en";
      if (f.key === "gender") {
        return sendMessage(chat_id, "Выберите новый <b>пол</b>:", {
          reply_markup: { inline_keyboard: [[
            { text: en ? "👨 Male" : "👨 Мужской", callback_data: "eg:м" },
            { text: en ? "👩 Female" : "👩 Женский", callback_data: "eg:ж" },
          ]] },
        });
      }
      const extra = f.key === "phone" ? { reply_markup: phoneKb() } : { reply_markup: removeKeyboard };
      const optional = ["email","diseases","allergies","surgeries","medications"].includes(f.key);
      const tip = optional ? (en ? " (or “-” to clear)" : " (или «-», чтобы очистить)") : "";
      const prompt = en
        ? `Enter a new value for “<b>${fieldLabel(f)}</b>”${tip}:`
        : `Введите новое значение для пункта «<b>${fieldLabel(f)}</b>»${tip}:`;
      return sendMessage(chat_id, prompt, extra);
    }

    // Изменение медкарты: выбран пол
    if (dataStr.startsWith("eg:") && st.step === "edit_field") {
      await updatePatientField(chat_id, "gender", dataStr.slice(3));
      await saveState(chat_id, { state: {} });
      await sendMessage(chat_id, "✅ «Пол» обновлён.");
      return showEditCard(chat_id);
    }

    // Пол при заполнении медкарты
    if (dataStr.startsWith("card_g:") && st.step === "card_gender") {
      const card = st.data?.card ?? {};
      card.gender = dataStr.slice(7); // "м" / "ж"
      await saveState(chat_id, { state: { step: "card_email", data: { card } } });
      return sendMessage(chat_id, "<b>Шаг 6.</b> Ваш <b>email</b> (по желанию). Напишите почту или отправьте «-», чтобы пропустить:");
    }

    // Пользователь указал пол — запоминаем и продолжаем анализ отложенной жалобы
    if (dataStr.startsWith("sex:")) {
      const sex = dataStr.slice(4); // "male" или "female"
      const pending = st.step === "ask_sex" ? st.data?.pendingSymptom : null;
      await saveState(chat_id, { sex, state: {} });
      if (pending) return runSymptomAnalysis(chat_id, pending, sex);
      return sendMessage(chat_id, "Спасибо! Опишите, что вас беспокоит, и я подскажу подходящего врача.", { reply_markup: await menuFor(chat_id) });
    }

    if (dataStr === "cancel") {
      await saveState(chat_id, { state: {} });
      return sendMessage(chat_id, "Запись отменена. Если что — нажмите /start, чтобы начать заново.", { reply_markup: removeKeyboard });
    }

    if (dataStr.startsWith("sp:") && st.step === "specialty") {
      const idx = Number(dataStr.slice(3));
      const chosen = st.data.specialties?.[idx];
      if (!chosen) return;
      st.data.specialty = chosen.spec;
      st.data.doctor = chosen.doctor;
      delete st.data.specialties; // больше не нужно
      return askDate(chat_id, st.data);
    }

    if (dataStr.startsWith("d:") && st.step === "date") {
      st.data.date = dataStr.slice(2);
      return askTime(chat_id, st.data);
    }

    if (dataStr.startsWith("t:") && st.step === "time") {
      st.data.time = dataStr.slice(2);
      return askConfirm(chat_id, st.data);
    }

    if (dataStr === "ok" && st.step === "confirm") {
      return finishBooking(chat_id, st.data);
    }
    return;
  }

  // 2) Обычное сообщение
  const msg = update.message;
  if (!msg) return;
  const chat_id = msg.chat.id;
  const text: string = (msg.text || "").trim();

  // Пользователь поделился контактом
  if (msg.contact) {
    const user = await getUser(chat_id);
    const st = user?.state ?? {};
    const phone = onlyDigits(msg.contact.phone_number);
    if (st.step === "phone") {
      st.data.phone = phone;
      return afterPhone(chat_id, st.data);
    }
    // Поделился контактом на шаге телефона в мастере медкарты
    if (st.step === "card_phone") {
      const card = st.data?.card ?? {};
      card.phone = phone.slice(-10);
      await saveState(chat_id, { state: { step: "card_age", data: { card } } });
      return sendMessage(chat_id, "<b>Шаг 4.</b> Сколько вам <b>полных лет</b>?", { reply_markup: removeKeyboard });
    }
    // Поделился контактом при изменении пункта «Телефон»
    if (st.step === "edit_field" && CARD_FIELDS[st.data?.fieldIdx]?.key === "phone") {
      await updatePatientField(chat_id, "phone", phone.slice(-10));
      await saveState(chat_id, { state: {} });
      await sendMessage(chat_id, "✅ «Телефон» обновлён.", { reply_markup: removeKeyboard });
      return showEditCard(chat_id);
    }
    // контакт прислали вне записи — просто запоминаем телефон,
    // чтобы связать с записью с сайта и слать подтверждения/напоминания
    await saveState(chat_id, { phone });
    return sendMessage(
      chat_id,
      "✅ Готово! Уведомления подключены. Если вы записывались на сайте этим номером — пришлём подтверждение и напоминания сюда.",
      { reply_markup: await menuFor(chat_id) },
    );
  }

  // Переключение языка RU ⇄ EN
  if (isBtn(text, "lang")) {
    const newLang = CURRENT_LANG === "en" ? "ru" : "en";
    await saveState(chat_id, { lang: newLang });
    CURRENT_LANG = newLang;
    return sendMessage(chat_id, "Язык переключён на русский. 🇷🇺", { reply_markup: await menuFor(chat_id) });
  }

  // Нажата кнопка «Записаться» из главного меню
  if (isBtn(text, "book")) {
    return startBooking(chat_id, await getUser(chat_id));
  }

  // Нажата кнопка «Заполнить карточку клиента»
  if (isBtn(text, "card")) {
    return startCard(chat_id);
  }

  // Нажата кнопка «Изменить карточку клиента» — показываем карту по пунктам
  if (isBtn(text, "edit")) {
    return showEditCard(chat_id);
  }

  // Команда /start (возможно с параметром, например /start book со страницы сайта)
  if (text.startsWith("/start")) {
    const param = text.split(" ")[1] || "";
    const user = await getUser(chat_id);
    // создаём запись о пользователе, если её ещё нет
    if (!user) await saveState(chat_id, { state: {} });
    // Вход в личный кабинет: телефон зашит в ссылке (start=p_<10цифр>)
    if (param.startsWith("p_")) {
      return sendLoginCodeForPhone(chat_id, param.slice(2));
    }
    // Старый способ (start=code_<token>) — на случай старых ссылок
    if (param.startsWith("code_")) {
      return sendLoginCode(chat_id, param.slice(5));
    }
    if (param === "book") {
      return startBooking(chat_id, await getUser(chat_id));
    }
    // Узнаём пациента по Telegram ID — здороваемся по имени, если знаем
    const patient = await getPatientByChat(chat_id);
    const filled = cardFilled(patient);
    const en = CURRENT_LANG === "en";
    const greet = en
      ? `${filled ? `Hello, ${patient.first_name}! 👋` : "Hello! 👋"} This is the <b>“Zdorovie”</b> clinic bot.\n\n` +
        "I'll help you book an appointment in a minute and send reminders.\n" +
        (filled
          ? "Your client card is already filled in — the doctor will see it when you book. 💙"
          : "New patients: tap <b>“Fill in client card”</b> — the doctor will be ready for your appointment.") +
        "\n\nChoose an action with the buttons below 👇"
      : `${filled ? `Здравствуйте, ${patient.first_name}! 👋` : "Здравствуйте! 👋"} Это бот клиники <b>«Здоровье»</b>.\n\n` +
        "Я помогу записаться на приём за минуту и пришлю напоминания.\n" +
        (filled
          ? "Ваша карточка клиента уже заполнена — врач увидит её при записи. 💙"
          : "Новым пациентам советуем нажать <b>«Заполнить карточку клиента»</b> — врач будет готов к вашему приёму.") +
        "\n\nВыберите действие на кнопках ниже 👇";
    return sendMessage(chat_id, greet, { reply_markup: await menuFor(chat_id) });
  }

  // Текстовые ответы внутри диалога
  const user = await getUser(chat_id);
  const st = user?.state ?? {};

  if (st.step === "name") {
    if (text.length < 2) return sendMessage(chat_id, "Пожалуйста, напишите имя текстом (минимум 2 буквы).");
    st.data.full_name = text;
    await saveState(chat_id, { full_name: text, state: { step: "phone", data: st.data } });
    return askPhone(chat_id);
  }

  if (st.step === "phone") {
    const digits = onlyDigits(text);
    if (digits.length < 10) return sendMessage(chat_id, "Похоже, номер неполный. Напишите телефон в формате +7XXXXXXXXXX или нажмите кнопку «Поделиться номером».");
    st.data.phone = digits;
    return afterPhone(chat_id, st.data);
  }

  // Шаги мастера заполнения медкарты
  if (typeof st.step === "string" && st.step.startsWith("card_")) {
    return handleCardStep(chat_id, st, text);
  }

  // Изменение одного пункта медкарты: пришло новое значение
  if (st.step === "edit_field") {
    const f = CARD_FIELDS[st.data?.fieldIdx];
    if (!f) { await saveState(chat_id, { state: {} }); return showEditCard(chat_id); }
    let value: unknown;
    if (f.key === "gender") {
      return sendMessage(chat_id, "Пожалуйста, выберите пол кнопкой 👇", {
        reply_markup: { inline_keyboard: [[
          { text: "👨 Мужской", callback_data: "eg:м" },
          { text: "👩 Женский", callback_data: "eg:ж" },
        ]] },
      });
    } else if (f.key === "phone") {
      const digits = onlyDigits(text);
      if (digits.length < 10) return sendMessage(chat_id, "Похоже, номер неполный. Напишите в формате +7XXXXXXXXXX или нажмите кнопку «Поделиться номером».", { reply_markup: phoneKb() });
      value = digits.slice(-10);
    } else if (f.key === "age") {
      const n = parseInt(onlyDigits(text), 10);
      if (!n || n < 1 || n > 120) return sendMessage(chat_id, "Напишите возраст числом, например 35.");
      value = n;
    } else if (f.key === "first_name" || f.key === "last_name") {
      if (text.trim().length < 2) return sendMessage(chat_id, `Напишите ${fieldLabel(f).toLowerCase()} текстом (минимум 2 буквы).`);
      value = text.trim();
    } else {
      value = isSkip(text) ? null : text.trim(); // email и медицинские поля можно очистить «-»
    }
    await updatePatientField(chat_id, f.key, value);
    await saveState(chat_id, { state: {} });
    await sendMessage(chat_id, CURRENT_LANG === "en" ? `✅ “${fieldLabel(f)}” updated.` : `✅ «${fieldLabel(f)}» обновлено.`, { reply_markup: removeKeyboard });
    return showEditCard(chat_id);
  }

  // Пустое сообщение (стикер/фото без текста) — просим описать жалобу словами
  if (!text) {
    return sendMessage(chat_id, "Опишите, пожалуйста, что вас беспокоит, текстом 🙂", { reply_markup: await menuFor(chat_id) });
  }

  // Короткие приветствия — здороваемся и предлагаем описать жалобу
  const greet = text.toLowerCase().replace(/[^а-яёa-z]/gi, "");
  if (["привет", "приветик", "здравствуйте", "здравствуй", "хай", "ку", "hi", "hello", "добрыйдень", "доброеутро", "добрыйвечер"].includes(greet)) {
    return sendMessage(
      chat_id,
      "Здравствуйте! 👋 Опишите, что вас беспокоит (например: «болит низ живота» или «болит правая нога»), и я подскажу, к какому врачу обратиться. Или нажмите кнопку ниже, чтобы записаться.",
      { reply_markup: await menuFor(chat_id) },
    );
  }

  // Если человек печатает во время выбора кнопками — мягко подсказываем
  if (st.step === "specialty" || st.step === "date" || st.step === "time" || st.step === "confirm") {
    return sendMessage(chat_id, "Пожалуйста, выберите вариант кнопкой выше 👆");
  }

  // Свободный вопрос о симптомах — отвечает ИИ-консультант (как умный поиск на сайте)
  return handleSymptom(chat_id, text);
}

// ---- Точка входа: Telegram стучится сюда ----
Deno.serve(async (req) => {
  // Проверка секретного слова (если задан секрет TG_SECRET при установке webhook)
  if (TG_SECRET) {
    const got = req.headers.get("X-Telegram-Bot-Api-Secret-Token");
    if (got !== TG_SECRET) return new Response("forbidden", { status: 401 });
  }

  try {
    const update = await req.json();
    await handleUpdate(update);
  } catch (e) {
    console.error("Ошибка обработки обновления:", e);
  }
  // Telegram важно получить ответ 200, иначе он будет слать обновление повторно
  return new Response("ok");
});
