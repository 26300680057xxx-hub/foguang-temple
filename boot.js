// Keep the exhibition readable even when model downloads or WebGL fail.
(() => {
  const card = document.querySelector('#loading');
  const message = document.querySelector('#loading-text');
  const retry = document.querySelector('#retry-model');
  let started = false;
  let moduleReady = false;
  const failed = () => {
    card.classList.add('failed');
    retry.hidden = false;
    message.textContent = '连接暂未完成，可先浏览页面，或点击重新连接。';
  };
  document.querySelector('#dismiss-loading').addEventListener('click', () => { card.hidden = true; });
  document.addEventListener('temple:loading', () => { started = true; retry.hidden = true; card.classList.remove('failed'); });
  document.addEventListener('temple:error', failed);
  document.addEventListener('temple:ready', () => { clearTimeout(watchdog); });
  const watchdog = setTimeout(() => {
    if (!started) failed();
  }, 25000);
  async function start() {
    retry.hidden = true;
    message.textContent = '正在连接，可先向下浏览页面。';
    try {
      await import('./app.js?v=20261112');
      moduleReady = true;
    } catch (error) { failed(); }
  }
  retry.addEventListener('click', () => {
    if (moduleReady) document.dispatchEvent(new Event('temple:retry'));
    else location.reload();
  });
  start();
})();
