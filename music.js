// Music remains independent of WebGL and only downloads after an explicit click.
const audio = document.querySelector('#temple-music');
const toggle = document.querySelector('#music-toggle');
const label = document.querySelector('#music-label');
const status = document.querySelector('#music-status');
const slider = document.querySelector('#music-volume');
const output = document.querySelector('#music-volume-value');
let desired = false;
let revision = 0;
let fadeTimer;
let volume = .28;
try {
  const saved = localStorage.getItem('temple-music-volume');
  if (saved !== null && Number.isFinite(Number(saved))) volume = Math.max(0, Math.min(1, Number(saved)));
} catch { /* Storage is optional in private browsing. */ }
slider.value = Math.round(volume * 100);
output.value = `${slider.value}%`;
audio.volume = volume;

function display(playing, message) {
  toggle.setAttribute('aria-pressed', String(playing));
  toggle.classList.toggle('playing', playing);
  label.textContent = playing ? '静听唐韵' : '听唐韵';
  const action = playing ? '暂停' : '播放';
  toggle.setAttribute('aria-label', `${action}古风配乐：唐构清韵`);
  toggle.title = `${action}古风配乐：唐构清韵`;
  status.textContent = message;
}

function fade(target, done) {
  clearInterval(fadeTimer);
  const start = audio.volume;
  const began = performance.now();
  fadeTimer = setInterval(() => {
    const progress = Math.min(1, (performance.now() - began) / 320);
    audio.volume = start + (target - start) * progress;
    if (progress === 1) { clearInterval(fadeTimer); done?.(); }
  }, 30);
}

async function setPlaying(wanted) {
  desired = wanted;
  const ticket = ++revision;
  clearInterval(fadeTimer);
  if (!wanted) {
    toggle.removeAttribute('aria-busy');
    display(false, '配乐已暂停');
    fade(0, () => { if (!desired) audio.pause(); });
    return;
  }
  status.textContent = '正在展开唐韵…';
  toggle.setAttribute('aria-busy', 'true');
  if (!audio.src || audio.error) {
    audio.src = new URL('./audio/tang-architecture.mp3', import.meta.url).href;
  }
  audio.volume = 0;
  try {
    // Call play inside the click gesture, including on mobile browsers.
    await audio.play();
    if (ticket !== revision || !desired) {
      if (!desired) audio.pause();
      return;
    }
    display(true, '正在播放 · 唐构清韵');
    fade(volume);
  } catch (error) {
    if (ticket !== revision) return;
    desired = false;
    display(false, error.name === 'NotAllowedError' ? '请再次点击「听唐韵」播放' : '配乐暂未载入，点击可重试');
  } finally {
    if (ticket === revision) toggle.removeAttribute('aria-busy');
  }
}

toggle.addEventListener('click', () => setPlaying(!desired));
slider.addEventListener('input', () => {
  volume = Number(slider.value) / 100;
  output.value = `${slider.value}%`;
  clearInterval(fadeTimer);
  audio.volume = volume;
  // A volume gesture during fade-out must still finish the pause.
  if (!desired) audio.pause();
  try { localStorage.setItem('temple-music-volume', String(volume)); } catch { /* Optional. */ }
});
audio.addEventListener('waiting', () => { if (desired) status.textContent = '配乐正在缓冲…'; });
audio.addEventListener('playing', () => { if (desired) display(true, '正在播放 · 唐构清韵'); });
audio.addEventListener('pause', () => {
  if (desired) {
    desired = false;
    ++revision;
    toggle.removeAttribute('aria-busy');
    display(false, '配乐已暂停，点击可继续');
  }
});
audio.addEventListener('error', () => {
  desired = false;
  ++revision;
  clearInterval(fadeTimer);
  toggle.removeAttribute('aria-busy');
  display(false, '配乐暂未载入，点击可重试');
});
