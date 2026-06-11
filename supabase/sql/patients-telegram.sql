-- ============================================================
--  Медкарта в Telegram: возраст + привязка к Telegram ID
--
--  Добавляет в таблицу patients два поля:
--   age              — возраст клиента (его спрашивает бот в Telegram)
--   telegram_chat_id — ID чата Telegram, чтобы узнавать клиента не только
--                      по телефону, но и по его Telegram-аккаунту.
--
--  Запуск один раз: Supabase → SQL Editor → New query → вставь → Run.
--  Повторный запуск безопасен (add column if not exists).
-- ============================================================

alter table public.patients
  add column if not exists age              int,
  add column if not exists telegram_chat_id bigint;

-- Быстрый поиск пациента по его Telegram-аккаунту
create index if not exists patients_tg_chat_idx on public.patients (telegram_chat_id);
