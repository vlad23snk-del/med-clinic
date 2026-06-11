-- Язык интерфейса бота для каждого пользователя ('ru' по умолчанию)
alter table public.telegram_users
  add column if not exists lang text default 'ru';
