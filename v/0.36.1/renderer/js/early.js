// Выполняется до первой отрисовки окна: решаем, показывать ли заставку, чтобы программа не мелькнула под ней.
// Заставки нет, если её выключили в настройках или Som перезапустился сам после обновления (вас нет у экрана).
(function () {
  try {
    var launch = (window.som && window.som.launch) || {};
    if (!launch.quiet && localStorage.getItem('som.intro') !== '0') document.documentElement.setAttribute('data-intro', '1');
  } catch (e) { /* без заставки */ }
  // Оформление решаем до первой отрисовки, чтобы окно не мигнуло другим видом.
  var ui = 'rich';
  try { if (localStorage.getItem('som.ui') === 'plain') ui = 'plain'; } catch (e) { /* по умолчанию */ }
  document.documentElement.setAttribute('data-ui', ui);
  // Радио: пластинка и визуализатор (выключаются в «Внешний вид → Анимация»).
  var fx = '1';
  try { var v = localStorage.getItem('som.radio.fx'); if (v === '0' || (v === null && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) fx = '0'; } catch (e) { /* по умолчанию */ }
  document.documentElement.setAttribute('data-radio-fx', fx);
}());
