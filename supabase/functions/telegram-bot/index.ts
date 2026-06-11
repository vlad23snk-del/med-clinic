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
  return tg("sendMessage", { chat_id, text, parse_mode: "HTML", ...extra });
}

function answerCallback(id: string, text = "") {
  return tg("answerCallbackQuery", { callback_query_id: id, text });
}

// Кнопка «Поделиться номером телефона» (специальная клавиатура Telegram)
const phoneKeyboard = {
  keyboard: [[{ text: "📱 Поделиться номером телефона", request_contact: true }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

// Убрать обычную клавиатуру
const removeKeyboard = { remove_keyboard: true };

// Текст кнопки запуска записи (главное меню)
const BOOK_BTN = "📅 Записаться на приём";

// Кнопки медкарты
const CARD_BTN = "🪪 Заполнить медкарту";
const MYCARD_BTN = "🪪 Моя медкарта";

// Запасное статичное меню (если вдруг не удалось определить пациента)
const mainMenu = {
  keyboard: [
    [{ text: BOOK_BTN }],
    [{ text: CARD_BTN }],
    [{ text: "📱 Подключить уведомления", request_contact: true }],
  ],
  resize_keyboard: true,
};

// ---- Память о пациенте: ищем его медкарту по Telegram ID ----
async function getPatientByChat(chat_id: number) {
  const { data } = await db.from("patients").select("*").eq("telegram_chat_id", chat_id).maybeSingle();
  return data;
}
// Карта считается заполненной, если есть имя и телефон
function cardFilled(p: any): boolean {
  return !!(p && p.first_name && p.phone);
}

// Главное меню — динамическое: пока медкарта не заполнена, предлагаем её заполнить;
// после заполнения эту кнопку больше НЕ показываем (вместо неё — «Моя медкарта»).
async function menuFor(chat_id: number) {
  const p = await getPatientByChat(chat_id);
  const rows: unknown[] = [[{ text: BOOK_BTN }]];
  rows.push([{ text: cardFilled(p) ? MYCARD_BTN : CARD_BTN }]);
  rows.push([{ text: "📱 Подключить уведомления", request_contact: true }]);
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
  return sendMessage(
    chat_id,
    `🔐 <b>Код для входа в личный кабинет</b>\n\nВаш код: <b>${code}</b>\n\nВведите его на сайте, чтобы войти. Код действует 5 минут. Никому не сообщайте его.`,
    { reply_markup: await menuFor(chat_id) },
  );
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
  await sendMessage(
    chat_id,
    `Отлично${greetName}! Запишу вас на приём за минуту. 🩺\n\nКак вас зовут? (Фамилия и имя)`,
    { reply_markup: removeKeyboard },
  );
}

async function askPhone(chat_id: number) {
  await sendMessage(
    chat_id,
    "Спасибо! Теперь поделитесь номером телефона — он нужен, чтобы администратор мог с вами связаться.\n\nНажмите кнопку ниже 👇 (или просто напишите номер).",
    { reply_markup: phoneKeyboard },
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
  const docLine = data.doctor && data.doctor !== "—" ? `\n👨‍⚕️ Врач: <b>${data.doctor}</b>` : "";
  return (
    "Проверьте запись:\n\n" +
    `👤 Имя: <b>${data.full_name}</b>\n` +
    `📞 Телефон: <b>${data.phone}</b>\n` +
    `🩺 Специалист: <b>${data.specialty}</b>${docLine}\n` +
    `📅 Когда: <b>${human}</b>\n\n` +
    "Всё верно?"
  );
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
  await sendMessage(
    chat_id,
    `✅ <b>Готово! Вы записаны.</b>\n\n` +
      `🩺 Специалист: <b>${data.specialty}</b>\n` +
      `📅 Когда: <b>${human}</b>\n\n` +
      `Мы напомним вам <b>за день</b> и <b>за час</b> до приёма.\n` +
      `Если планы изменятся — позвоните: 8 800 123-45-67.\n\n` +
      `Будьте здоровы! 💙`,
    { reply_markup: removeKeyboard },
  );
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
    return sendMessage(chat_id, "✅ Ваша медкарта уже заполнена. Изменить данные можно в личном кабинете на сайте.", { reply_markup: await menuFor(chat_id) });
  }
  const user = await getUser(chat_id);
  const card: Record<string, unknown> = {};
  if (user?.phone) card.phone = onlyDigits(user.phone).slice(-10); // если телефон уже знаем
  await saveState(chat_id, { state: { step: "card_first", data: { card } } });
  return sendMessage(
    chat_id,
    "Заполним медкарту 🪪 Это займёт минуту, и врач будет готов к вашему приёму.\n\n<b>Шаг 1.</b> Напишите ваше <b>имя</b>:",
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
    return sendMessage(chat_id, "⚠️ Не удалось сохранить медкарту. Попробуйте позже.", { reply_markup: await menuFor(chat_id) });
  }
  const fio = [card.first_name, card.last_name].filter(Boolean).join(" ");
  return sendMessage(
    chat_id,
    `✅ <b>Медкарта сохранена!</b>\n\n` +
      `👤 ${fio}\n📞 +7${card.phone}\n🎂 Возраст: ${card.age}\n\n` +
      `Спасибо! Теперь врач увидит вашу карту, когда вы запишетесь на приём. ` +
      `Изменить данные всегда можно в личном кабинете на сайте.`,
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
    return sendMessage(chat_id, "<b>Шаг 3.</b> Ваш <b>номер телефона</b> — нажмите кнопку ниже или напишите номер:", { reply_markup: phoneKeyboard });
  }
  if (st.step === "card_phone") {
    const digits = onlyDigits(t);
    if (digits.length < 10) return sendMessage(chat_id, "Похоже, номер неполный. Напишите в формате +7XXXXXXXXXX или нажмите кнопку «Поделиться номером».", { reply_markup: phoneKeyboard });
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

  let out = `🩺 Рекомендую обратиться к специалисту: <b>${specialty}</b>\n\n`;
  if (advice) out += advice + "\n\n";
  if (URGENCY[urgency]) out += URGENCY[urgency] + "\n\n";
  out += "Это не диагноз — точную помощь окажет врач на приёме.";

  return sendMessage(chat_id, out, {
    reply_markup: { inline_keyboard: [[{ text: `📅 Записаться к: ${specialty}`, callback_data: `bookspec:${specialty}` }]] },
  });
}

// ---- Главный обработчик одного обновления от Telegram ----
async function handleUpdate(update: any) {
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
      return sendMessage(
        chat_id,
        `Записываю вас к специалисту «${spec}». 🩺\n\nКак вас зовут? (Фамилия и имя)`,
        { reply_markup: removeKeyboard },
      );
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
    // контакт прислали вне записи — просто запоминаем телефон,
    // чтобы связать с записью с сайта и слать подтверждения/напоминания
    await saveState(chat_id, { phone });
    return sendMessage(
      chat_id,
      "✅ Готово! Уведомления подключены. Если вы записывались на сайте этим номером — пришлём подтверждение и напоминания сюда.",
      { reply_markup: await menuFor(chat_id) },
    );
  }

  // Нажата кнопка «Записаться» из главного меню
  if (text === BOOK_BTN) {
    return startBooking(chat_id, await getUser(chat_id));
  }

  // Нажата кнопка «Заполнить медкарту»
  if (text === CARD_BTN) {
    return startCard(chat_id);
  }

  // Нажата кнопка «Моя медкарта» — показываем краткую сводку
  if (text === MYCARD_BTN) {
    const p = await getPatientByChat(chat_id);
    if (!cardFilled(p)) return startCard(chat_id);
    const fio = [p.first_name, p.last_name].filter(Boolean).join(" ");
    return sendMessage(
      chat_id,
      `🪪 <b>Ваша медкарта</b>\n\n` +
        `👤 ${fio}\n📞 +7${p.phone}\n🎂 Возраст: ${p.age ?? "—"}\n` +
        (p.gender ? `⚧ Пол: ${p.gender === "м" ? "мужской" : "женский"}\n` : "") +
        (p.allergies ? `⚠️ Аллергии: ${p.allergies}\n` : "") +
        (p.diseases ? `🩺 Болезни: ${p.diseases}\n` : "") +
        (p.surgeries ? `🔪 Операции: ${p.surgeries}\n` : "") +
        (p.medications ? `💊 Лекарства: ${p.medications}\n` : "") +
        `\nИзменить данные можно в личном кабинете на сайте.`,
      { reply_markup: await menuFor(chat_id) },
    );
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
    const hello = cardFilled(patient) ? `Здравствуйте, ${patient.first_name}! 👋` : "Здравствуйте! 👋";
    const cardLine = cardFilled(patient)
      ? "Ваша медкарта уже заполнена — врач увидит её при записи. 💙"
      : "Новым пациентам советуем нажать <b>«Заполнить медкарту»</b> — врач будет готов к вашему приёму.";
    return sendMessage(
      chat_id,
      `${hello} Это бот клиники <b>«Здоровье»</b>.\n\n` +
        "Я помогу записаться на приём за минуту и пришлю напоминания.\n" +
        cardLine + "\n\n" +
        "Выберите действие на кнопках ниже 👇",
      { reply_markup: await menuFor(chat_id) },
    );
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
