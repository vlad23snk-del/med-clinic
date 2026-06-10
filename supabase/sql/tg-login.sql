-- ============================================================
--  Вход в личный кабинет через Telegram «Старт»
--
--  Таблица одноразовых ссылок: когда клиент на сайте жмёт
--  «Перейти в Telegram для подтверждения кода», создаётся токен,
--  с которым открывается бот (t.me/бот?start=code_<токен>).
--  Бот по токену узнаёт телефон, привязывает чат и шлёт код входа.
--
--  Закрыта RLS без политик — доступ только у серверных функций.
--  Запуск один раз: Supabase → SQL Editor → New query → вставь → Run.
-- ============================================================

create table if not exists public.tg_login (
  token       text primary key,           -- случайный токен в ссылке
  phone       text not null,              -- 10 цифр телефона клиента
  expires_at  timestamptz not null,       -- ссылка живёт 10 минут
  created_at  timestamptz default now()
);

alter table public.tg_login enable row level security;
