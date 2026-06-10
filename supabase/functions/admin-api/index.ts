// ============================================================
//  Edge Function: admin-api
//  Закрытый «бэкенд» админ-панели клиники. Работает с базой от имени
//  сервера (service role) и пускает только по паролю ADMIN_PASSWORD.
//  Данные пациентов НЕ доступны публичным ключом — только через этот пароль.
//
//  Запросы (POST JSON):
//   { action: "list",  password }                  → список всех записей
//   { action: "status", password, id, status }     → сменить статус записи
//
//  Секрет: ADMIN_PASSWORD (Supabase → Edge Functions → Secrets).
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const ADMIN_PASSWORD = Deno.env.get("ADMIN_PASSWORD")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(SUPABASE_URL, SERVICE_KEY);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

const ALLOWED_STATUS = ["new", "confirmed", "done", "cancelled"];

// ---- Защита от подбора пароля (brute-force) ----
const MAX_FAILS = 8;        // сколько неверных попыток подряд допустимо
const LOCK_MINUTES = 15;    // на сколько минут блокируем после превышения

function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") || "";
  return xff.split(",")[0].trim() || "unknown";
}

// Все функции троттлинга «безопасно падают» (fail-open): если что-то пойдёт
// не так с таблицей счётчика — вход НЕ ломается, просто не считается попытка.
async function isBlocked(key: string): Promise<boolean> {
  try {
    const { data } = await db.from("auth_throttle").select("blocked_until").eq("key", key).maybeSingle();
    if (!data?.blocked_until) return false;
    return new Date(data.blocked_until).getTime() > Date.now();
  } catch { return false; }
}
async function recordFail(key: string): Promise<void> {
  try {
    const { data } = await db.from("auth_throttle").select("fails").eq("key", key).maybeSingle();
    const fails = (data?.fails ?? 0) + 1;
    const patch: Record<string, unknown> = { key, fails, updated_at: new Date().toISOString() };
    if (fails >= MAX_FAILS) patch.blocked_until = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
    await db.from("auth_throttle").upsert(patch);
  } catch { /* игнорируем */ }
}
async function recordSuccess(key: string): Promise<void> {
  try { await db.from("auth_throttle").delete().eq("key", key); } catch { /* игнорируем */ }
}

// Сравнение паролей за постоянное время — не выдаёт подсказок по времени ответа.
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let body: any = {};
  try { body = await req.json(); } catch { /* пустое тело */ }

  // Блокируем, если с этого адреса было слишком много неверных попыток
  const tkey = "admin:" + clientIp(req);
  if (await isBlocked(tkey)) {
    return json({ error: "Слишком много попыток входа. Попробуйте через 15 минут." }, 429);
  }

  // Проверка пароля (за постоянное время)
  if (!body.password || !timingSafeEqual(String(body.password), ADMIN_PASSWORD)) {
    await recordFail(tkey);
    return json({ error: "Неверный пароль" }, 401);
  }
  await recordSuccess(tkey); // верный пароль — сбрасываем счётчик

  // Список всех записей (новые — сверху)
  if (body.action === "list") {
    const { data, error } = await db
      .from("appointments")
      .select("*")
      .order("id", { ascending: false })
      .limit(1000);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, items: data ?? [] });
  }

  // Смена статуса записи
  if (body.action === "status") {
    if (!ALLOWED_STATUS.includes(body.status)) return json({ error: "Недопустимый статус" }, 400);
    const { error } = await db.from("appointments").update({ status: body.status }).eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ error: "Неизвестное действие" }, 400);
});
