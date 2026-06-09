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

// Главное меню (показывается на /start)
const mainMenu = {
  keyboard: [
    [{ text: BOOK_BTN }],
    [{ text: "📱 Подключить уведомления", request_contact: true }],
  ],
  resize_keyboard: true,
};

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
      return askSpecialty(chat_id, st.data);
    }
    // контакт прислали вне записи — просто запоминаем телефон,
    // чтобы связать с записью с сайта и слать подтверждения/напоминания
    await saveState(chat_id, { phone });
    return sendMessage(
      chat_id,
      "✅ Готово! Уведомления подключены. Если вы записывались на сайте этим номером — пришлём подтверждение и напоминания сюда.",
      { reply_markup: mainMenu },
    );
  }

  // Нажата кнопка «Записаться» из главного меню
  if (text === BOOK_BTN) {
    return startBooking(chat_id, await getUser(chat_id));
  }

  // Команда /start (возможно с параметром, например /start book со страницы сайта)
  if (text.startsWith("/start")) {
    const param = text.split(" ")[1] || "";
    const user = await getUser(chat_id);
    // создаём запись о пользователе, если её ещё нет
    if (!user) await saveState(chat_id, { state: {} });
    if (param === "book") {
      return startBooking(chat_id, await getUser(chat_id));
    }
    return sendMessage(
      chat_id,
      "Здравствуйте! 👋 Это бот клиники <b>«Здоровье»</b>.\n\n" +
        "Я помогу записаться на приём к врачу за минуту и пришлю напоминания, чтобы вы не забыли о визите.\n\n" +
        "Нажмите <b>«Записаться на приём»</b> ниже. А если вы уже записывались на сайте — нажмите " +
        "<b>«Подключить уведомления»</b>, чтобы получать подтверждение и напоминания здесь.",
      { reply_markup: mainMenu },
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
    return askSpecialty(chat_id, st.data);
  }

  // Если человек пишет что-то вне диалога — мягко направляем к записи
  return sendMessage(
    chat_id,
    "Чтобы записаться на приём, нажмите кнопку ниже 👇 или команду /start.",
    { reply_markup: { inline_keyboard: [[{ text: "📅 Записаться на приём", callback_data: "book" }]] } },
  );
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
