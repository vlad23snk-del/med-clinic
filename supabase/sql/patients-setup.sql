-- ============================================================
--  Личный кабинет клиента + медицинская карта
--
--  Создаёт три таблицы:
--   1) patients          — карточка пациента (медкарта). Привязка по телефону.
--   2) patient_codes      — одноразовые коды входа (Telegram/WhatsApp).
--   3) patient_sessions   — «пропуска» после входа, чтобы не вводить код каждый раз.
--
--  Все три таблицы закрыты RLS без политик — публичный ключ сайта их НЕ видит.
--  Доступ только у серверной функции patient-api (service_role).
--
--  КАК ЗАПУСТИТЬ (один раз): Supabase → SQL Editor → New query → вставь → Run.
--  Повторный запуск безопасен.
-- ============================================================

-- 1) Медицинская карта пациента.
--    phone — это «логин»: 10 цифр без кода страны (последние 10 цифр номера),
--    так надёжно совпадает с телефоном из записей на приём.
create table if not exists public.patients (
  id           bigint generated always as identity primary key,
  phone        text unique not null,          -- 10 цифр, напр. 9991234567
  first_name   text,                          -- имя
  last_name    text,                          -- фамилия
  birth_date   date,                          -- дата рождения
  gender       text,                          -- 'м' / 'ж' / null
  blood_type   text,                          -- группа крови (необязательно)
  email        text,                          -- email (необязательно)
  diseases     text,                          -- хронические болезни / диагнозы
  allergies    text,                          -- аллергии
  surgeries    text,                          -- перенесённые операции
  medications  text,                          -- что постоянно принимает
  comments     text,                          -- любые заметки пациента
  created_at   timestamptz default now(),
  updated_at   timestamptz default now()
);

-- 2) Одноразовые коды входа. Один активный код на телефон.
create table if not exists public.patient_codes (
  phone       text primary key,               -- 10 цифр
  code_hash   text not null,                  -- хеш кода (сам код не храним)
  channel     text,                           -- 'telegram' / 'whatsapp'
  attempts    int  not null default 0,        -- сколько раз пытались ввести
  expires_at  timestamptz not null,           -- когда код «сгорает»
  created_at  timestamptz default now()
);

-- 3) Сессии (пропуска). Токен хранится у клиента в браузере.
create table if not exists public.patient_sessions (
  token       text primary key,               -- случайный токен
  phone       text not null,                  -- кому принадлежит
  expires_at  timestamptz not null,           -- срок действия пропуска
  created_at  timestamptz default now()
);
create index if not exists patient_sessions_phone_idx on public.patient_sessions (phone);

-- Защита: RLS включён, политик нет → публичный (анонимный) ключ ничего не видит.
-- Серверная функция patient-api работает с service_role и обходит RLS.
alter table public.patients         enable row level security;
alter table public.patient_codes    enable row level security;
alter table public.patient_sessions enable row level security;

-- Готово. Дальше задеплой функцию patient-api и обнови doctor-api.
