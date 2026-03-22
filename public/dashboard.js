async function loadVictims() {
  const status = document.getElementById('status');
  const list = document.getElementById('victim-list');

  try {
    const health = await fetch('/api/health').then((r) => r.json());
    status.textContent = health.publicUrl
      ? `Server OK · ${health.publicUrl}`
      : 'Server OK';

    const data = await fetch('/api/victims').then((r) => r.json());
    if (!data.victims || data.victims.length === 0) {
      list.innerHTML = '<li class="muted">No victims yet.</li>';
      return;
    }
    list.innerHTML = data.victims
      .map(
        (id) =>
          `<li><a href="/victim/${encodeURIComponent(id)}">${escapeHtml(id)}</a></li>`
      )
      .join('');
  } catch (e) {
    status.textContent = 'Could not reach API';
    status.classList.add('error');
    list.innerHTML = '';
  }
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

loadVictims();
