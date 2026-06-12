// ============================================================
//  Edge Function: telegram-notify
//  Эту функцию запускает расписание Supabase (pg_cron) каждые 5 минут.
//  Она делает три вещи:
//   1) шлёт ПОДТВЕРЖДЕНИЕ тем, кто записался на сайте и при этом есть
//      в Telegram (нашли по телефону);
//   2) шлёт НАПОМИНАНИЕ за 1 день до приёма;
//   3) шлёт НАПОМИНАНИЕ за 1 час до приёма.
//
//  Чтобы человек не получал одно и то же дважды, у записи есть «галочки»:
//  confirmation_sent, reminded_day, reminded_hour.
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const BOT_TOKEN = Deno.env.get("BOT_TOKEN")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TZ_OFFSET = "+03:00"; // часовой пояс клиники (как в telegram-bot)

const db = createClient(SUPABASE_URL, SERVICE_KEY);
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const MON = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

function sendMessage(chat_id: number, text: string) {
  return fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id, text, parse_mode: "HTML" }),
  });
}

// Последние 10 цифр телефона — так надёжно сравнивать «+7 (999)…» и «79990000000»
function key10(phone: string | null) {
  const d = (phone || "").replace(/\D/g, "");
  return d.slice(-10);
}

// Красивая дата/время приёма по часовому поясу клиники
function whenText(appt: any): string {
  if (appt.appointment_at) {
    const d = new Date(appt.appointment_at);
    // приводим к поясу клиники для вывода времени
    const local = new Date(d.getTime() + offsetMs());
    const hh = String(local.getUTCHours()).padStart(2, "0");
    const mm = String(local.getUTCMinutes()).padStart(2, "0");
    return `${local.getUTCDate()} ${MON[local.getUTCMonth()]} ${local.getUTCFullYear()}, ${hh}:${mm}`;
  }
  if (appt.preferred_date) {
    const d = new Date(appt.preferred_date + "T00:00:00");
    return `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}`;
  }
  return "уточняется";
}

function offsetMs() {
  const sign = TZ_OFFSET.startsWith("-") ? -1 : 1;
  const [h, m] = TZ_OFFSET.slice(1).split(":").map(Number);
  return sign * (h * 60 + m) * 60 * 1000;
}

function specLine(appt: any) {
  const doc = appt.doctor_name ? ` (${appt.doctor_name})` : "";
  return `${appt.specialty || "специалист"}${doc}`;
}

Deno.serve(async () => {
  const now = Date.now();
  const in24h = new Date(now + 24 * 3600 * 1000).toISOString();
  const in1h = new Date(now + 1 * 3600 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  // Загружаем телефоны пользователей Telegram, чтобы связать с записями с сайта
  const { data: tgUsers } = await db.from("telegram_users").select("chat_id, phone");
  const chatByPhone = new Map<string, number>();
  (tgUsers ?? []).forEach((u: any) => {
    const k = key10(u.phone);
    if (k.length === 10) chatByPhone.set(k, u.chat_id);
  });

  const resolveChat = (appt: any): number | null =>
    appt.telegram_chat_id || chatByPhone.get(key10(appt.phone)) || null;

  let confirmations = 0, dayReminders = 0, hourReminders = 0;

  // ---- 1) Подтверждения для записей с сайта ----
  const { data: toConfirm } = await db
    .from("appointments")
    .select("*")
    .eq("confirmation_sent", false)
    .limit(200);

  for (const appt of toConfirm ?? []) {
    const chat = resolveChat(appt);
    if (!chat) continue; // человека нет в Telegram — подтверждение в Telegram не шлём
    await sendMessage(
      chat,
      `✅ <b>Здравствуйте, ${appt.full_name || "пациент"}!</b>\n\n` +
        `Вы записаны в клинику «Здоровье».\n` +
        `🩺 Специалист: <b>${specLine(appt)}</b>\n` +
        `📅 Когда: <b>${whenText(appt)}</b>\n\n` +
        `Мы напомним о приёме заранее. Будьте здоровы! 💙`,
    );
    await db.from("appointments").update({ confirmation_sent: true, telegram_chat_id: chat }).eq("id", appt.id);
    confirmations++;
  }

  // ---- 2) Напоминание за 1 день ----
  const { data: dayList } = await db
    .from("appointments")
    .select("*")
    .eq("reminded_day", false)
    .gt("appointment_at", nowIso)
    .lte("appointment_at", in24h);

  for (const appt of dayList ?? []) {
    const chat = resolveChat(appt);
    if (chat) {
      await sendMessage(
        chat,
        `⏰ <b>Напоминание о приёме</b>\n\n` +
          `Завтра вас ждёт врач в клинике «Здоровье».\n` +
          `🩺 Специалист: <b>${specLine(appt)}</b>\n` +
          `📅 Когда: <b>${whenText(appt)}</b>\n\n` +
          `Если планы изменились — позвоните в клинику.`,
      );
      dayReminders++;
    }
    // ставим галочку в любом случае, чтобы не проверять эту запись снова
    await db.from("appointments").update({ reminded_day: true }).eq("id", appt.id);
  }

  // ---- 3) Напоминание за 1 час ----
  const { data: hourList } = await db
    .from("appointments")
    .select("*")
    .eq("reminded_hour", false)
    .gt("appointment_at", nowIso)
    .lte("appointment_at", in1h);

  for (const appt of hourList ?? []) {
    const chat = resolveChat(appt);
    if (chat) {
      await sendMessage(
        chat,
        `⏰ <b>Через час — ваш приём!</b>\n\n` +
          `🩺 Специалист: <b>${specLine(appt)}</b>\n` +
          `📅 Время: <b>${whenText(appt)}</b>\n` +
          `📍 Адрес клиники\n\n` +
          `Не опаздывайте, пожалуйста. До встречи! 💙`,
      );
      hourReminders++;
    }
    await db.from("appointments").update({ reminded_hour: true }).eq("id", appt.id);
  }

  return new Response(
    JSON.stringify({ ok: true, confirmations, dayReminders, hourReminders }),
    { headers: { "Content-Type": "application/json" } },
  );
});
