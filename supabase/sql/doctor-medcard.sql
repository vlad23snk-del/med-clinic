-- ============================================================
--  Врачебная медицинская карточка пациента (создаёт только врач)
--  Отдельно от «карточки клиента», которую заполняет сам пациент.
--   doctor_notes        — врачебные записи (текст)
--   doctor_file_path    — путь к загруженному файлу в Storage (bucket medcards)
--   doctor_file_name    — исходное имя файла (для показа)
--  Поля закрыты RLS (таблица patients) — доступ только у doctor-api.
-- ============================================================
alter table public.patients
  add column if not exists doctor_notes        text,
  add column if not exists doctor_file_path    text,
  add column if not exists doctor_file_name    text,
  add column if not exists doctor_file_updated  timestamptz;

-- Приватный бакет для файлов медкарт (не публичный — доступ по подписанной ссылке)
insert into storage.buckets (id, name, public)
values ('medcards', 'medcards', false)
on conflict (id) do nothing;
