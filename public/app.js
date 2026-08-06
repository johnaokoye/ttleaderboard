const state = { settings: null, selectedTeamId: null };

const teamBoard = document.querySelector('.board[data-kind="team"]');
const indivBoard = document.querySelector('.board[data-kind="individual"]');
const indivTitle = document.querySelector('[data-individual-title]');
const indivHeader = document.querySelector('[data-individual-header]');
const teamHint = document.querySelector('[data-team-hint]');

function ordinal(n) {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

function formatDate(iso) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderRows(board, scores, { clickable = false } = {}) {
  const rowsEl = board.querySelector('[data-rows]');
  rowsEl.innerHTML = scores
    .map((s, i) => {
      const rank = i + 1;
      const isTop = rank === 1;
      const selected = clickable && s.id === state.selectedTeamId;
      return `<div class="row${isTop ? ' rank-1' : ''}${selected ? ' selected' : ''}"${
        clickable ? ` data-team-id="${s.id}" data-team-name="${escapeHtml(s.name)}" role="button" tabindex="0"` : ''
      }>
        <span class="pos">${isTop ? '🏆 ' : ''}${ordinal(rank)}</span>
        <span class="name">${escapeHtml(s.name)}</span>
        <span class="score">${s.score.toLocaleString()}</span>
      </div>`;
    })
    .join('');

  const updatedEl = board.querySelector('[data-updated]');
  if (scores.length > 0) {
    const latest = scores.reduce((max, s) => (s.updated_at > max ? s.updated_at : max), scores[0].updated_at);
    updatedEl.textContent = formatDate(latest);
  } else {
    updatedEl.textContent = '—';
  }
}

async function loadTeams() {
  const res = await fetch('/api/leaderboard?kind=team&limit=5');
  const scores = await res.json();
  renderRows(teamBoard, scores, { clickable: state.settings.mode === 'both' });

  if (state.settings.mode === 'both') {
    teamBoard.querySelectorAll('[data-team-id]').forEach((el) => {
      const select = () => selectTeam(Number(el.dataset.teamId), el.dataset.teamName);
      el.addEventListener('click', select);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          select();
        }
      });
    });
  }
}

async function loadIndividualsGlobal() {
  const res = await fetch('/api/leaderboard?kind=individual&limit=5');
  const scores = await res.json();
  renderRows(indivBoard, scores);
}

async function selectTeam(teamId, teamName) {
  state.selectedTeamId = teamId;
  teamHint.hidden = true;
  indivHeader.hidden = false;
  indivTitle.textContent = `Individuals — ${teamName}`;

  const res = await fetch(`/api/teams/${teamId}/individuals?limit=10`);
  const scores = await res.json();
  renderRows(indivBoard, scores);

  loadTeams();
}

async function init() {
  const res = await fetch('/api/settings');
  state.settings = await res.json();

  document.querySelector('[data-competition-name]').textContent = state.settings.name;

  const mode = state.settings.mode;
  teamBoard.hidden = mode === 'individual';
  indivBoard.hidden = mode === 'team';
  document.querySelector('.boards').classList.toggle('single', mode !== 'both');

  if (mode === 'both') {
    teamHint.hidden = false;
    indivHeader.hidden = true;
  }

  if (mode !== 'individual') await loadTeams();
  if (mode === 'individual') await loadIndividualsGlobal();
}

init();
