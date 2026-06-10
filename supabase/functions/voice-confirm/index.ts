// ============================================================
//  Edge Function: voice-confirm
//  Голосовое подтверждение приёма через Zvonobot (ИИ-голос).
//  Робот звонит клиенту и проговаривает текст напоминания/подтверждения.
//
//  Два режима:
//   1) ТЕСТ:   POST { "test": true, "phone": "89046975568", "text": "..." }
//      — разовый звонок на указанный номер (для проверки звучания).
//   2) ОБЗВОН: POST {} (обычно запускает расписание)
//      — звонит по записям, которым пора подтверждение (за ~сутки до приёма).
//
//  Секрет: ZVONOBOT_API_KEY (в Supabase → Edge Functions → Secrets).
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const API_KEY = Deno.env.get("ZVONOBOT_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TZ_OFFSET = "+03:00";
const CLINIC_PHONE = "8 800 123 45 67";

const db = createClient(SUPABASE_URL, SERVICE_KEY);
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Приводим телефон к виду 79046975568 (как ждёт Zvonobot)
function toPhone(raw: string): number | null {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length === 10) d = "7" + d;
  return d.length === 11 ? Number(d) : null;
}

// Запуск одного звонка с озвучкой текста (ИИ-голос Zvonobot)
async function placeCall(phone: number, text: string) {
  const resp = await fetch("https://lk.zvonobot.ru/apiCalls/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: API_KEY,
      phone,
      record: { text, gender: 1 }, // gender 1 — женский голос, 0 — мужской
    }),
  });
  const data = await resp.json().catch(() => ({}));
  // Zvonobot отвечает { status:"success", data:[{ status, phone, message }] }
  const item = Array.isArray(data?.data) ? data.data[0] : null;
  const ok = data?.status === "success" && (!item || item.status !== "error");
  return { ok, raw: data };
}

// Красивые дата и время приёма по часовому поясу клиники
function whenText(appt: any): string {
  if (!appt.appointment_at) return "в назначенное время";
  const d = new Date(appt.appointment_at);
  const off = (TZ_OFFSET.startsWith("-") ? -1 : 1) * (Number(TZ_OFFSET.slice(1, 3)) * 60 + Number(TZ_OFFSET.slice(4))) * 60000;
  const local = new Date(d.getTime() + off);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${local.getUTCDate()} ${MON[local.getUTCMonth()]}, в ${hh}:${mm}`;
}

// Текст, который произнесёт робот
function confirmText(appt: any): string {
  const spec = appt.specialty || "врачу";
  const doc = appt.doctor_name ? ` к врачу ${appt.doctor_name}` : "";
  return (
    `Здравствуйте! Это клиника Здоровье. ` +
    `Напоминаем, что вы записаны на приём${doc ? doc : " к специалисту " + spec}, ${whenText(appt)}. ` +
    `Если вы сможете прийти — будем рады вас видеть. ` +
    `Если планы изменились, пожалуйста, позвоните нам по номеру ${CLINIC_PHONE}. Будьте здоровы!`
  );
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));

  // --- Режим ТЕСТ: один звонок на указанный номер ---
  if (body?.test && body?.phone) {
    const phone = toPhone(String(body.phone));
    if (!phone) return json({ ok: false, error: "Неверный номер" }, 400);
    const text = body.text ||
      "Здравствуйте! Это тестовый звонок от клиники Здоровье. Голосовой помощник работает корректно. Спасибо!";
    const r = await placeCall(phone, text);
    return json(r);
  }

  // --- Режим ОБЗВОН: записи, которым пора подтверждение (в ближайшие 24 часа) ---
  const now = Date.now();
  const in24h = new Date(now + 24 * 3600 * 1000).toISOString();
  const nowIso = new Date(now).toISOString();

  const { data: appts } = await db
    .from("appointments")
    .select("*")
    .eq("call_status", "pending")
    .gt("appointment_at", nowIso)
    .lte("appointment_at", in24h);

  let called = 0, failed = 0;
  for (const appt of appts ?? []) {
    const phone = toPhone(appt.phone);
    if (!phone) continue;
    const r = await placeCall(phone, confirmText(appt));
    await db.from("appointments").update({
      call_status: r.ok ? "called" : "failed",
      call_attempts: (appt.call_attempts ?? 0) + 1,
      called_at: new Date().toISOString(),
    }).eq("id", appt.id);
    r.ok ? called++ : failed++;
  }

  return json({ ok: true, called, failed });
});
