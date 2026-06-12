// ============================================================
//  Edge Function: voice-confirm
//  Голосовое подтверждение приёма БЕЗ договора с Zvonobot:
//   1) текст озвучивается нашей нейросетью (OpenAI TTS) — получаем mp3;
//   2) mp3 кладём в публичное хранилище Supabase (бакет "voice");
//   3) Zvonobot звонит клиенту и проигрывает файл по ссылке (remoteUrl).
//
//  Два режима:
//   - ТЕСТ:   POST { "test": true, "phone": "89046975568", "text": "..." }
//   - ОБЗВОН: POST {}  — по записям, которым пора подтверждение (за ~сутки).
//
//  Секреты: ZVONOBOT_API_KEY, OPENAI_API_KEY (общие для проекта).
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const ZVONOBOT_KEY = Deno.env.get("ZVONOBOT_API_KEY")!;
const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TZ_OFFSET = "+03:00";
const CLINIC_PHONE = "телефон клиники"; // ЗАГЛУШКА — впишите номер клиники

const db = createClient(SUPABASE_URL, SERVICE_KEY);
const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function toPhone(raw: string): number | null {
  let d = (raw || "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("8")) d = "7" + d.slice(1);
  if (d.length === 10) d = "7" + d;
  return d.length === 11 ? Number(d) : null;
}

// 1) Озвучка текста нашей нейросетью → mp3 (Uint8Array)
async function ttsOpenAI(text: string): Promise<Uint8Array> {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { "Authorization": `Bearer ${OPENAI_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "gpt-4o-mini-tts", voice: "nova", input: text, response_format: "mp3" }),
  });
  if (!r.ok) throw new Error("TTS " + r.status + " " + (await r.text()).slice(0, 200));
  return new Uint8Array(await r.arrayBuffer());
}

// 2) Загрузка mp3 в публичный бакет "voice" → публичная ссылка (через клиент Supabase)
async function uploadAudio(bytes: Uint8Array): Promise<string> {
  const name = `confirm-${Date.now()}-${Math.floor(Math.random() * 1000)}.mp3`;
  const { error } = await db.storage.from("voice").upload(name, bytes, {
    contentType: "audio/mpeg",
    upsert: true,
  });
  if (error) throw new Error("upload " + error.message);
  return db.storage.from("voice").getPublicUrl(name).data.publicUrl;
}

// 3) Запуск звонка через Zvonobot с готовой аудио-ссылкой
async function placeCall(phone: number, text: string) {
  const audio = await ttsOpenAI(text);
  const url = await uploadAudio(audio);
  const resp = await fetch("https://lk.zvonobot.ru/apiCalls/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ apiKey: ZVONOBOT_KEY, phone, remoteUrl: url }),
  });
  const data = await resp.json().catch(() => ({}));
  const item = Array.isArray(data?.data) ? data.data[0] : null;
  const ok = data?.status === "success" && (!item || item.status !== "error");
  return { ok, audioUrl: url, raw: data };
}

function whenText(appt: any): string {
  if (!appt.appointment_at) return "в назначенное время";
  const d = new Date(appt.appointment_at);
  const off = (TZ_OFFSET.startsWith("-") ? -1 : 1) * (Number(TZ_OFFSET.slice(1, 3)) * 60 + Number(TZ_OFFSET.slice(4))) * 60000;
  const local = new Date(d.getTime() + off);
  const hh = String(local.getUTCHours()).padStart(2, "0");
  const mm = String(local.getUTCMinutes()).padStart(2, "0");
  return `${local.getUTCDate()} ${MON[local.getUTCMonth()]}, в ${hh}:${mm}`;
}

function confirmText(appt: any): string {
  const spec = appt.specialty || "врачу";
  const doc = appt.doctor_name ? ` к врачу ${appt.doctor_name}` : ` к специалисту ${spec}`;
  return (
    `Здравствуйте! Это клиника Здоровье. ` +
    `Напоминаем, что вы записаны на приём${doc}, ${whenText(appt)}. ` +
    `Если вы сможете прийти — будем рады вас видеть. ` +
    `Если планы изменились, пожалуйста, позвоните нам по номеру ${CLINIC_PHONE}. Будьте здоровы!`
  );
}

Deno.serve(async (req) => {
  const body = await req.json().catch(() => ({}));

  // --- ТЕСТ: один звонок на указанный номер ---
  if (body?.test && body?.phone) {
    const phone = toPhone(String(body.phone));
    if (!phone) return json({ ok: false, error: "Неверный номер" }, 400);
    const text = body.text ||
      "Здравствуйте! Это клиника Здоровье. Напоминаем о вашей записи на приём. Будьте здоровы!";
    try {
      return json(await placeCall(phone, text));
    } catch (e) {
      return json({ ok: false, error: String(e) }, 500);
    }
  }

  // --- ОБЗВОН: записи, которым пора подтверждение (в ближайшие 24 часа) ---
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
    let ok = false;
    try { ok = (await placeCall(phone, confirmText(appt))).ok; } catch (_) { ok = false; }
    await db.from("appointments").update({
      call_status: ok ? "called" : "failed",
      call_attempts: (appt.call_attempts ?? 0) + 1,
      called_at: new Date().toISOString(),
    }).eq("id", appt.id);
    ok ? called++ : failed++;
  }

  return json({ ok: true, called, failed });
});
