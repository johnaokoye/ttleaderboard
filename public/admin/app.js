const loginSection = document.getElementById('login-section');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');

let teamsCache = [];

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function flashStatus(id, msg) {
  const el = document.getElementById(id);
  el.textContent = msg;
  setTimeout(() => {
    el.textContent = '';
  }, 2000);
}

async function api(path, options) {
  const res = await fetch(`/api/admin${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 401) {
    setAuthenticated(false);
    throw new Error('Unauthorized');
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

// --- Auth ---

async function checkSession() {
  const res = await fetch('/api/admin/session');
  const data = await res.json();
  setAuthenticated(data.authenticated, data.mustChangePassword);
}

function setAuthenticated(isAuth, mustChange = false) {
  loginSection.hidden = isAuth;
  dashboard.hidden = !isAuth;
  if (!isAuth) return;

  applyPasswordLock(mustChange);
  if (!mustChange) loadAll();
}

function applyPasswordLock(mustChange) {
  dashboard.classList.toggle('password-locked', mustChange);
  document.getElementById('force-password-notice').hidden = !mustChange;
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const password = document.getElementById('password').value;
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  if (res.ok) {
    const data = await res.json();
    loginForm.reset();
    setAuthenticated(true, data.mustChangePassword);
  } else {
    loginError.textContent = 'Incorrect password';
  }
});

document.getElementById('logout-btn').addEventListener('click', async () => {
  await fetch('/api/admin/logout', { method: 'POST' });
  setAuthenticated(false);
});

document.getElementById('change-password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errorEl = document.getElementById('password-error');
  errorEl.textContent = '';

  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-password').value;
  const confirmPassword = document.getElementById('confirm-password').value;

  if (newPassword !== confirmPassword) {
    errorEl.textContent = "New password and confirmation don't match";
    return;
  }

  try {
    await api('/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) });
    e.target.reset();
    flashStatus('password-status', 'Password updated');
    const wasLocked = dashboard.classList.contains('password-locked');
    applyPasswordLock(false);
    if (wasLocked) loadAll();
  } catch (err) {
    errorEl.textContent = err.message;
  }
});

async function loadAll() {
  await Promise.all([loadSettings(), loadTeams()]);
  await loadIndividuals();
}

// --- Settings ---

const settingsForm = document.getElementById('settings-form');

async function loadSettings() {
  const s = await api('/settings');
  document.getElementById('comp-name').value = s.name || '';
  const modeInput = settingsForm.querySelector(`input[name="mode"][value="${s.mode}"]`);
  if (modeInput) modeInput.checked = true;
}

settingsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('comp-name').value;
  const modeInput = settingsForm.querySelector('input[name="mode"]:checked');
  try {
    await api('/settings', {
      method: 'PUT',
      body: JSON.stringify({ name, mode: modeInput ? modeInput.value : 'individual' }),
    });
    flashStatus('settings-status', 'Saved');
  } catch (err) {
    alert(err.message);
  }
});

// --- Teams ---

function renderTeamOptions() {
  const select = document.getElementById('indiv-team');
  const current = select.value;
  select.innerHTML =
    '<option value="">No team</option>' +
    teamsCache.map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
  select.value = current;
}

async function loadTeams() {
  teamsCache = await api('/teams');
  renderTeams();
  renderTeamOptions();
}

function renderTeams() {
  const tbody = document.getElementById('teams-body');
  tbody.innerHTML = teamsCache
    .map((t) => {
      const derived = t.member_count > 0;
      const scoreControl = derived
        ? `<span class="derived-note">Auto — ${t.member_count} member${t.member_count === 1 ? '' : 's'}</span>`
        : `<div class="award-row">
             <input type="number" class="award-input" placeholder="pts" />
             <button class="award-btn">Award</button>
           </div>`;
      return `
    <tr data-id="${t.id}">
      <td data-label="Name">${escapeHtml(t.name)}</td>
      <td data-label="Score">${t.score.toLocaleString()}</td>
      <td data-label="Award points">${scoreControl}</td>
      <td><button class="rename-btn">Rename</button></td>
      <td><button class="delete-btn danger">Delete</button></td>
    </tr>`;
    })
    .join('');
}

document.getElementById('add-team-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('team-name').value;
  const score = parseInt(document.getElementById('team-score').value, 10) || 0;
  try {
    await api('/teams', { method: 'POST', body: JSON.stringify({ name, score }) });
    e.target.reset();
    document.getElementById('team-score').value = '0';
    loadTeams();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('teams-body').addEventListener('click', async (e) => {
  const row = e.target.closest('tr');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains('award-btn')) {
    const input = row.querySelector('.award-input');
    const points = parseInt(input.value, 10);
    if (!Number.isInteger(points)) return alert('Enter a number of points');
    try {
      await api(`/teams/${id}/award`, { method: 'POST', body: JSON.stringify({ points }) });
      loadTeams();
    } catch (err) {
      alert(err.message);
    }
  }

  if (e.target.classList.contains('rename-btn')) {
    const team = teamsCache.find((t) => String(t.id) === id);
    const name = prompt('Rename team', team ? team.name : '');
    if (!name) return;
    try {
      await api(`/teams/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      loadTeams();
    } catch (err) {
      alert(err.message);
    }
  }

  if (e.target.classList.contains('delete-btn')) {
    if (!confirm('Delete this team? Its individuals will become teamless, not deleted.')) return;
    try {
      await api(`/teams/${id}`, { method: 'DELETE' });
      await loadTeams();
      await loadIndividuals();
    } catch (err) {
      alert(err.message);
    }
  }
});

// --- Individuals ---

let individualsCache = [];

async function loadIndividuals() {
  individualsCache = await api('/individuals');
  renderIndividuals();
}

// A team's score is derived from its individuals, so anything that changes
// an individual's score or team_id can change what a team should display —
// refresh both, not just individuals.
async function loadIndividualsAndTeams() {
  await loadIndividuals();
  await loadTeams();
}

function renderIndividuals() {
  const tbody = document.getElementById('individuals-body');
  tbody.innerHTML = individualsCache
    .map((p) => {
      const options =
        '<option value="">No team</option>' +
        teamsCache
          .map(
            (t) =>
              `<option value="${t.id}" ${t.id === p.team_id ? 'selected' : ''}>${escapeHtml(t.name)}</option>`
          )
          .join('');
      return `
    <tr data-id="${p.id}">
      <td data-label="Name">${escapeHtml(p.name)}</td>
      <td data-label="Team"><select class="team-select">${options}</select></td>
      <td data-label="Score">${p.score.toLocaleString()}</td>
      <td data-label="Award points">
        <div class="award-row">
          <input type="number" class="award-input" placeholder="pts" />
          <button class="award-btn">Award</button>
        </div>
      </td>
      <td><button class="rename-btn">Rename</button></td>
      <td><button class="delete-btn danger">Delete</button></td>
    </tr>`;
    })
    .join('');
}

document.getElementById('add-individual-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = document.getElementById('indiv-name').value;
  const team_id = document.getElementById('indiv-team').value || null;
  const score = parseInt(document.getElementById('indiv-score').value, 10) || 0;
  try {
    await api('/individuals', { method: 'POST', body: JSON.stringify({ name, team_id, score }) });
    e.target.reset();
    document.getElementById('indiv-score').value = '0';
    loadIndividualsAndTeams();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('individuals-body').addEventListener('click', async (e) => {
  const row = e.target.closest('tr');
  if (!row) return;
  const id = row.dataset.id;

  if (e.target.classList.contains('award-btn')) {
    const input = row.querySelector('.award-input');
    const points = parseInt(input.value, 10);
    if (!Number.isInteger(points)) return alert('Enter a number of points');
    try {
      await api(`/individuals/${id}/award`, { method: 'POST', body: JSON.stringify({ points }) });
      loadIndividualsAndTeams();
    } catch (err) {
      alert(err.message);
    }
  }

  if (e.target.classList.contains('rename-btn')) {
    const person = individualsCache.find((p) => String(p.id) === id);
    const name = prompt('Rename individual', person ? person.name : '');
    if (!name) return;
    try {
      await api(`/individuals/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      loadIndividuals();
    } catch (err) {
      alert(err.message);
    }
  }

  if (e.target.classList.contains('delete-btn')) {
    if (!confirm('Delete this individual?')) return;
    try {
      await api(`/individuals/${id}`, { method: 'DELETE' });
      loadIndividualsAndTeams();
    } catch (err) {
      alert(err.message);
    }
  }
});

document.getElementById('individuals-body').addEventListener('change', async (e) => {
  if (!e.target.classList.contains('team-select')) return;
  const row = e.target.closest('tr');
  const id = row.dataset.id;
  try {
    await api(`/individuals/${id}`, { method: 'PATCH', body: JSON.stringify({ team_id: e.target.value || null }) });
    loadIndividualsAndTeams();
  } catch (err) {
    alert(err.message);
  }
});

// --- Reset ---

document.getElementById('reset-scores-btn').addEventListener('click', async () => {
  if (!confirm('Zero out all scores? Teams and individuals stay.')) return;
  try {
    await api('/reset', { method: 'POST', body: JSON.stringify({ scope: 'scores' }) });
    loadAll();
  } catch (err) {
    alert(err.message);
  }
});

document.getElementById('reset-all-btn').addEventListener('click', async () => {
  if (!confirm('This permanently deletes ALL teams and individuals. Continue?')) return;
  try {
    await api('/reset', { method: 'POST', body: JSON.stringify({ scope: 'all' }) });
    loadAll();
  } catch (err) {
    alert(err.message);
  }
});

checkSession();
