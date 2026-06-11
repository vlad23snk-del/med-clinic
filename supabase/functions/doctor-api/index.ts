// ============================================================
//  Edge Function: doctor-api
//  Личный кабинет врача. Вход по личному паролю (таблица doctor_auth,
//  закрыта RLS). Возвращает профиль врача и его записи (пациентов).
//  Пароли НЕ доступны публичным ключом — только через эту функцию.
//
//  Запросы (POST JSON):
//   { action:"login",  doctorId, password }            → профиль + записи
//   { action:"list",   doctorId, password }            → обновить записи
//   { action:"status", doctorId, password, id, status} → сменить статус записи
// ============================================================

import { createClient } from "npm:@supabase/supabase-js@2";

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
// Телефон → последние 10 цифр (для связи записи и медкарты пациента)
function phone10(raw: string): string {
  return (raw || "").replace(/\D/g, "").slice(-10);
}
// Троттлинг «безопасно падает» (fail-open): сбой счётчика не ломает вход.
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

// Проверка пароля → возвращает профиль врача или null
async function authDoctor(doctorId: number, password: string) {
  if (!doctorId || !password) return null;
  const { data: auth } = await db.from("doctor_auth").select("doctor_id").eq("doctor_id", doctorId).eq("password", password).maybeSingle();
  if (!auth) return null;
  const { data: doc } = await db.from("doctors").select("*").eq("id", doctorId).maybeSingle();
  return doc ?? null;
}

// Записи (пациенты) этого врача: явно назначенные ему + неназначенные по его специальности
async function appointmentsFor(doc: any) {
  const name = doc.name;
  const spec = doc.specialty;
  const [byName, bySpec] = await Promise.all([
    db.from("appointments").select("*").eq("doctor_name", name),
    db.from("appointments").select("*").eq("specialty", spec),
  ]);
  const map = new Map<number, any>();
  for (const a of [...(byName.data ?? []), ...(bySpec.data ?? [])]) {
    const mine = a.doctor_name === name || (!a.doctor_name && a.specialty === spec);
    if (mine) map.set(a.id, a);
  }
  // сортируем: будущие приёмы по времени, затем остальные
  return [...map.values()].sort((x, y) => {
    const tx = x.appointment_at ? new Date(x.appointment_at).getTime() : (x.preferred_date ? new Date(x.preferred_date).getTime() : 0);
    const ty = y.appointment_at ? new Date(y.appointment_at).getTime() : (y.preferred_date ? new Date(y.preferred_date).getTime() : 0);
    return ty - tx;
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  let body: any = {};
  try { body = await req.json(); } catch { /* пусто */ }

  // Блокируем подбор: отдельный счётчик на каждого врача + адрес
  const tkey = "doctor:" + Number(body.doctorId || 0) + ":" + clientIp(req);
  if (await isBlocked(tkey)) {
    return json({ error: "Слишком много попыток входа. Попробуйте через 15 минут." }, 429);
  }

  const doc = await authDoctor(Number(body.doctorId), body.password);
  if (!doc) {
    await recordFail(tkey);
    return json({ error: "Неверный пароль" }, 401);
  }
  await recordSuccess(tkey); // верный пароль — сбрасываем счётчик

  if (body.action === "login" || body.action === "list") {
    const items = await appointmentsFor(doc);
    const profile = {
      id: doc.id, name: doc.name, specialty: doc.specialty,
      description: doc.description, education: doc.education,
      experience_years: doc.experience_years, photo_url: doc.photo_url,
    };
    return json({ ok: true, doctor: profile, items });
  }

  if (body.action === "status") {
    if (!ALLOWED_STATUS.includes(body.status)) return json({ error: "Недопустимый статус" }, 400);
    // убеждаемся, что запись принадлежит этому врачу
    const { data: appt } = await db.from("appointments").select("id, doctor_name, specialty").eq("id", body.id).maybeSingle();
    if (!appt) return json({ error: "Запись не найдена" }, 404);
    const mine = appt.doctor_name === doc.name || (!appt.doctor_name && appt.specialty === doc.specialty);
    if (!mine) return json({ error: "Нет доступа к этой записи" }, 403);
    const { error } = await db.from("appointments").update({ status: body.status }).eq("id", body.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  // Подписанная ссылка на файл врачебной карточки (живёт 1 час)
  async function signedFileUrl(path: string | null): Promise<string | null> {
    if (!path) return null;
    const { data } = await db.storage.from("medcards").createSignedUrl(path, 3600);
    return data?.signedUrl ?? null;
  }

  // Карта пациента по записи: врач видит карту только своих пациентов
  if (body.action === "patient") {
    const target = phone10(body.phone);
    if (target.length !== 10) return json({ error: "Некорректный телефон" }, 400);
    // проверяем, что среди записей этого врача есть пациент с таким телефоном
    const mineList = await appointmentsFor(doc);
    const isMine = mineList.some((a: any) => phone10(a.phone) === target);
    if (!isMine) return json({ error: "Нет доступа к этому пациенту" }, 403);
    const { data: patient } = await db.from("patients").select("*").eq("phone", target).maybeSingle();
    // «карточка клиента» (заполняет пациент) — может отсутствовать
    const card = patient ? {
      first_name: patient.first_name, last_name: patient.last_name,
      birth_date: patient.birth_date, age: patient.age, gender: patient.gender, blood_type: patient.blood_type,
      diseases: patient.diseases, allergies: patient.allergies,
      surgeries: patient.surgeries, medications: patient.medications, comments: patient.comments,
    } : null;
    // «врачебная карточка» (создаёт врач): заметки + файл
    const doctorCard = {
      notes: patient?.doctor_notes ?? null,
      fileName: patient?.doctor_file_name ?? null,
      fileUrl: await signedFileUrl(patient?.doctor_file_path ?? null),
    };
    return json({ ok: true, patient: card, doctorCard });
  }

  // Сохранение врачебной карточки (только врач): заметки + загрузка файла
  if (body.action === "save_medcard") {
    const target = phone10(body.phone);
    if (target.length !== 10) return json({ error: "Некорректный телефон" }, 400);
    const mineList = await appointmentsFor(doc);
    if (!mineList.some((a: any) => phone10(a.phone) === target)) return json({ error: "Нет доступа к этому пациенту" }, 403);

    // гарантируем строку пациента (врач может создать карточку даже без записи пациента)
    let { data: patient } = await db.from("patients").select("phone, doctor_file_path").eq("phone", target).maybeSingle();
    if (!patient) {
      const { data: created } = await db.from("patients").insert({ phone: target }).select("phone, doctor_file_path").maybeSingle();
      patient = created;
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof body.notes === "string") patch.doctor_notes = body.notes.trim() || null;

    if (body.fileBase64 && body.fileName) {
      let bytes: Uint8Array;
      try { bytes = Uint8Array.from(atob(body.fileBase64), (c) => c.charCodeAt(0)); }
      catch { return json({ error: "Файл повреждён" }, 400); }
      if (bytes.length > 8 * 1024 * 1024) return json({ error: "Файл слишком большой (макс. 8 МБ)" }, 400);
      const safe = String(body.fileName).replace(/[^\w.\-]+/g, "_").slice(-80);
      const path = `${target}/${Date.now()}-${safe}`;
      const { error: upErr } = await db.storage.from("medcards").upload(path, bytes, {
        contentType: body.fileType || "application/octet-stream", upsert: true,
      });
      if (upErr) return json({ error: "Не удалось загрузить файл: " + upErr.message }, 500);
      if (patient?.doctor_file_path) { try { await db.storage.from("medcards").remove([patient.doctor_file_path]); } catch (_) { /* ignore */ } }
      patch.doctor_file_path = path;
      patch.doctor_file_name = body.fileName;
      patch.doctor_file_updated = new Date().toISOString();
    }

    const { error } = await db.from("patients").update(patch).eq("phone", target);
    if (error) return json({ error: error.message }, 500);

    const { data: p2 } = await db.from("patients").select("doctor_notes, doctor_file_path, doctor_file_name").eq("phone", target).maybeSingle();
    return json({ ok: true, doctorCard: {
      notes: p2?.doctor_notes ?? null,
      fileName: p2?.doctor_file_name ?? null,
      fileUrl: await signedFileUrl(p2?.doctor_file_path ?? null),
    } });
  }

  return json({ error: "Неизвестное действие" }, 400);
});
