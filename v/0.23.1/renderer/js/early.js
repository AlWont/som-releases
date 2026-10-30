// Выполняется до первой отрисовки окна: решаем, показывать ли заставку, чтобы программа не мелькнула под ней.
// Заставки нет, если её выключили в настройках или Som перезапустился сам после обновления (вас нет у экрана).
(function () {
  try {
    var launch = (window.som && window.som.launch) || {};
    if (!launch.quiet && localStorage.getItem('som.intro') !== '0') document.documentElement.setAttribute('data-intro', '1');
  } catch (e) { /* без заставки */ }
}());
