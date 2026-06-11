/* =====================================================================
   Переключатель светлой/тёмной темы. Общий для всех страниц.
   Запоминает выбор в localStorage, добавляет плавающую кнопку 🌙/☀️.
   Подключается в конце страницы: <script src="theme.js"></script>
   (Само применение темы происходит раньше — маленьким скриптом в <head>,
    чтобы не было «вспышки» светлой темы при загрузке.)
   ===================================================================== */
(function () {
  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try { localStorage.setItem("theme", theme); } catch (e) { /* приватный режим */ }
    var btn = document.getElementById("themeToggle");
    if (btn) {
      btn.textContent = theme === "dark" ? "☀️" : "🌙";
      btn.title = theme === "dark" ? "Включить светлую тему" : "Включить тёмную тему";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var btn = document.createElement("button");
    btn.id = "themeToggle";
    btn.className = "theme-toggle";
    btn.setAttribute("aria-label", "Переключить тему");
    btn.textContent = currentTheme() === "dark" ? "☀️" : "🌙";
    btn.title = currentTheme() === "dark" ? "Включить светлую тему" : "Включить тёмную тему";
    btn.addEventListener("click", function () {
      applyTheme(currentTheme() === "dark" ? "light" : "dark");
    });
    document.body.appendChild(btn);
  });
})();
