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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let body: any = {};
  try { body = await req.json(); } catch { /* пустое тело */ }

  // Проверка пароля
  if (!body.password || body.password !== ADMIN_PASSWORD) {
    return json({ error: "Неверный пароль" }, 401);
  }

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
