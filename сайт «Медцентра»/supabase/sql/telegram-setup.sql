-- ============================================================
--  Telegram-интеграция для сайта клиники «Здоровье»
--  Что делает скрипт: добавляет нужные поля в таблицу записей
--  и создаёт таблицу для пользователей Telegram.
--
--  КАК ЗАПУСТИТЬ (один раз):
--  Supabase → раздел SQL Editor → New query → вставь весь текст → Run.
-- ============================================================

-- 1) Дополняем таблицу записей (appointments) нужными полями.
--    "add column if not exists" — добавит поле, только если его ещё нет,
--    поэтому повторный запуск скрипта безопасен.
alter table public.appointments
  add column if not exists doctor_name       text,                  -- врач (если выбран)
  add column if not exists service           text,                  -- название услуги
  add column if not exists appointment_at    timestamptz,           -- ТОЧНЫЕ дата и время приёма
  add column if not exists telegram_chat_id  bigint,                -- кому писать в Telegram
  add column if not exists source            text default 'site',   -- откуда запись: 'site' или 'telegram'
  add column if not exists status            text default 'new',    -- new / confirmed / done / cancelled
  add column if not exists confirmation_sent boolean default false, -- отправлено ли подтверждение
  add column if not exists reminded_day      boolean default false, -- отправлено ли напоминание за день
  add column if not exists reminded_hour     boolean default false; -- отправлено ли напоминание за час

-- 2) Таблица пользователей Telegram.
--    Запоминаем, кто с какого аккаунта пишет, его телефон и шаг диалога,
--    чтобы связать запись с сайта с аккаунтом Telegram и слать напоминания.
create table if not exists public.telegram_users (
  chat_id    bigint primary key,            -- ID чата (уникальный для каждого пользователя)
  full_name  text,
  phone      text,                          -- только цифры, например 79991234567
  state      jsonb default '{}'::jsonb,     -- на каком шаге записи находится человек
  updated_at timestamptz default now()
);

-- 3) Ускоряем поиск по телефону (нужно, чтобы связать запись с сайта и Telegram).
create index if not exists telegram_users_phone_idx on public.telegram_users (phone);
create index if not exists appointments_phone_idx     on public.appointments (phone);
create index if not exists appointments_at_idx         on public.appointments (appointment_at);

-- 4) Защита таблицы telegram_users: доступ только у серверных функций.
--    Включаем RLS и НЕ создаём политик — значит, обычные посетители сайта
--    (анонимный ключ) не смогут читать или менять эти данные.
--    Серверные функции работают с service_role ключом и обходят это ограничение.
alter table public.telegram_users enable row level security;

-- Готово. После этого деплой функций telegram-bot и telegram-notify
-- (см. файл НАСТРОЙКА-ТЕЛЕГРАМ.md).
