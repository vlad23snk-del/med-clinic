// ============================================================
//  Edge Function: patient-api
//  «Бэкенд» личного кабинета клиента. Вход по телефону + одноразовый код
//  (Telegram или WhatsApp). Хранит медкарту пациента (болезни, аллергии,
//  операции и т.д.). Данные закрыты RLS — публичный ключ их не видит.
//
//  Действия (POST JSON):
//   { action:"request_code", phone, channel }  → отправить код (telegram|whatsapp)
//   { action:"verify_code",  phone, code }      → проверить код → выдать token + профиль
//   { action:"get",          token }            → профиль по токену
//   { action:"update",       token, profile }   → сохранить медкарту
//   { action:"appointments", token }            → записи пациента (по телефону)
//
//  Секреты: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BOT_TOKEN (Telegram).
//  (WhatsApp пока не подключён — нужен WhatsApp Business API.)
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BOT_TOKEN = Deno.env.get("BOT_TOKEN") || "";
const db = createClient(SUPABASE_URL, SERVICE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// --- Телефон → 10 цифр (последние 10), как в telegram-notify (key10) ---
function phone10(raw: string): string {
  return (raw || "").replace(/\D/g, "").slice(-10);
}

// --- Хеш (SHA-256 в hex) — для кода входа ---
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
// --- Случайный токен сессии ---
function randomToken(): string {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --- Защита от спама кодами / подбора (таблица auth_throttle, fail-open) ---
const MAX_FAILS = 6, LOCK_MINUTES = 15;
function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";
}
async function isBlocked(key: string): Promise<boolean> {
  try {
    const { data } = await db.from("auth_throttle").select("blocked_until").eq("key", key).maybeSingle();
    return !!data?.blocked_until && new Date(data.blocked_until).getTime() > Date.now();
  } catch { return false; }
}
async function recordFail(key: string): Promise<void> {
  try {
    const { data } = await db.from("auth_throttle").select("fails").eq("key", key).maybeSingle();
    const fails = (data?.fails ?? 0) + 1;
    const patch: Record<string, unknown> = { key, fails, updated_at: new Date().toISOString() };
    if (fails >= MAX_FAILS) patch.blocked_until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
    await db.from("auth_throttle").upsert(patch);
  } catch { /* ignore */ }
}
async function recordSuccess(key: string): Promise<void> {
  try { await db.from("auth_throttle").delete().eq("key", key); } catch { /* ignore */ }
}

// --- Отправка кода в Telegram (если клиент писал боту с этого номера) ---
async function sendTelegramCode(phone: string, code: string): Promise<boolean> {
  if (!BOT_TOKEN) return false;
  // ищем chat_id по последним 10 цифрам телефона
  const { data: users } = await db.from("telegram_users").select("chat_id, phone");
  const chat = (users ?? []).find((u: any) => phone10(u.phone) === phone)?.chat_id;
  if (!chat) return false;
  const text =
    `🔐 <b>Код для входа в личный кабинет</b>\n\n` +
    `Ваш код: <b>${code}</b>\n\n` +
    `Он действует 5 минут. Никому не сообщайте этот код.`;
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML" }),
  });
  return r.ok;
}

// --- Проверка сессии (token → phone) ---
async function phoneByToken(token: string): Promise<string | null> {
  if (!token) return null;
  const { data } = await db.from("patient_sessions").select("phone, expires_at").eq("token", token).maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) {
    await db.from("patient_sessions").delete().eq("token", token);
    return null;
  }
  return data.phone;
}

// --- Поля медкарты, которые клиент может менять ---
const PROFILE_FIELDS = ["first_name", "last_name", "birth_date", "age", "gender", "blood_type", "email", "diseases", "allergies", "surgeries", "medications", "comments"];

function publicProfile(p: any, phone: string) {
  const out: Record<string, unknown> = { phone };
  for (const f of PROFILE_FIELDS) out[f] = p?.[f] ?? null;
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let body: any = {};
  try { body = await req.json(); } catch { /* пусто */ }
  const action = body.action;
  const ip = clientIp(req);

  // ---------- 1) Запросить код ----------
  if (action === "request_code") {
    const phone = phone10(body.phone);
    const channel = body.channel === "whatsapp" ? "whatsapp" : "telegram";
    if (phone.length !== 10) return json({ error: "Введите корректный номер телефона" }, 400);

    const tkey = "patient_code:" + phone + ":" + ip;
    if (await isBlocked(tkey)) return json({ error: "Слишком много запросов кода. Попробуйте через 15 минут." }, 429);
    await recordFail(tkey); // считаем каждый запрос кода, чтобы не спамили

    // WhatsApp пока не подключён (нужен WhatsApp Business API)
    if (channel === "whatsapp") {
      return json({ ok: false, channel, error: "Вход через WhatsApp скоро подключим. Пока выберите, пожалуйста, Telegram." });
    }

    // Генерируем 6-значный код и сохраняем его хеш на 5 минут
    const code = String(Math.floor(100000 + Math.random() * 900000));
    await db.from("patient_codes").upsert({
      phone,
      code_hash: await sha256(code),
      channel,
      attempts: 0,
      expires_at: new Date(Date.now() + 5 * 60000).toISOString(),
      created_at: new Date().toISOString(),
    });

    const sent = await sendTelegramCode(phone, code);
    if (!sent) {
      return json({
        ok: false,
        channel,
        needBot: true,
        error: "Не нашли вас в нашем Telegram-боте. Откройте бота и отправьте ему свой номер телефона тем же номером — после этого код придёт сюда.",
      });
    }
    return json({ ok: true, channel, sent: true });
  }

  // ---------- 1b) Начать вход через Telegram «Старт» ----------
  // Создаём одноразовую ссылку: t.me/бот?start=code_<token>. Сам код пришлёт
  // бот, когда клиент нажмёт «Старт» (см. функцию telegram-bot).
  if (action === "start_telegram") {
    const phone = phone10(body.phone);
    if (phone.length !== 10) return json({ error: "Введите корректный номер телефона" }, 400);

    const tkey = "patient_code:" + phone + ":" + ip;
    if (await isBlocked(tkey)) return json({ error: "Слишком много запросов. Попробуйте через 15 минут." }, 429);
    await recordFail(tkey);

    const token = randomToken().slice(0, 40); // payload Telegram ≤ 64 симв., только [A-Za-z0-9_-]
    await db.from("tg_login").insert({
      token, phone,
      expires_at: new Date(Date.now() + 10 * 60000).toISOString(),
    });
    return json({ ok: true, token });
  }

  // ---------- 2) Проверить код ----------
  if (action === "verify_code") {
    const phone = phone10(body.phone);
    const code = String(body.code || "").trim();
    if (phone.length !== 10 || !code) return json({ error: "Введите номер и код" }, 400);

    const vkey = "patient_verify:" + phone + ":" + ip;
    if (await isBlocked(vkey)) return json({ error: "Слишком много попыток. Попробуйте через 15 минут." }, 429);

    const { data: row } = await db.from("patient_codes").select("*").eq("phone", phone).maybeSingle();
    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      await recordFail(vkey);
      return json({ error: "Код устарел. Запросите новый." }, 401);
    }
    if ((row.attempts ?? 0) >= 5) {
      return json({ error: "Слишком много попыток ввода кода. Запросите новый." }, 429);
    }
    if (row.code_hash !== await sha256(code)) {
      await db.from("patient_codes").update({ attempts: (row.attempts ?? 0) + 1 }).eq("phone", phone);
      await recordFail(vkey);
      return json({ error: "Неверный код" }, 401);
    }

    // Код верный → удаляем его, создаём сессию, гарантируем карточку
    await db.from("patient_codes").delete().eq("phone", phone);
    await recordSuccess(vkey);

    let { data: patient } = await db.from("patients").select("*").eq("phone", phone).maybeSingle();
    if (!patient) {
      const { data: created } = await db.from("patients").insert({ phone }).select("*").maybeSingle();
      patient = created;
    }

    const token = randomToken();
    await db.from("patient_sessions").insert({
      token, phone,
      expires_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(), // 30 дней
    });
    return json({ ok: true, token, profile: publicProfile(patient, phone) });
  }

  // ---------- 3) Получить профиль ----------
  if (action === "get") {
    const phone = await phoneByToken(body.token);
    if (!phone) return json({ error: "Сессия истекла, войдите снова" }, 401);
    const { data: patient } = await db.from("patients").select("*").eq("phone", phone).maybeSingle();
    return json({ ok: true, profile: publicProfile(patient, phone) });
  }

  // ---------- 4) Сохранить медкарту ----------
  if (action === "update") {
    const phone = await phoneByToken(body.token);
    if (!phone) return json({ error: "Сессия истекла, войдите снова" }, 401);
    const p = body.profile || {};

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const f of PROFILE_FIELDS) {
      if (f in p) {
        let v = p[f];
        if (typeof v === "string") v = v.trim();
        if (f === "age") {
          const n = parseInt(String(v).replace(/\D/g, ""), 10); // возраст — целое число
          patch.age = n >= 1 && n <= 120 ? n : null;
        } else {
          patch[f] = v === "" ? null : v;
        }
      }
    }

    // Клиент может сменить номер телефона. Меняем «логин» и подтягиваем сессии.
    let newPhone = phone;
    if (typeof p.phone === "string") {
      const np = phone10(p.phone);
      if (np.length === 10 && np !== phone) {
        const { data: taken } = await db.from("patients").select("id").eq("phone", np).maybeSingle();
        if (taken) return json({ error: "Этот номер уже привязан к другому кабинету" }, 409);
        patch.phone = np;
        newPhone = np;
      }
    }

    const { error } = await db.from("patients").update(patch).eq("phone", phone);
    if (error) return json({ error: error.message }, 500);
    if (newPhone !== phone) await db.from("patient_sessions").update({ phone: newPhone }).eq("phone", phone);

    const { data: patient } = await db.from("patients").select("*").eq("phone", newPhone).maybeSingle();
    return json({ ok: true, profile: publicProfile(patient, newPhone) });
  }

  // ---------- 5) Записи пациента ----------
  if (action === "appointments") {
    const phone = await phoneByToken(body.token);
    if (!phone) return json({ error: "Сессия истекла, войдите снова" }, 401);
    const { data: all } = await db.from("appointments").select("*").order("id", { ascending: false }).limit(500);
    const mine = (all ?? []).filter((a: any) => phone10(a.phone) === phone);
    return json({ ok: true, items: mine });
  }

  return json({ error: "Неизвестное действие" }, 400);
});
