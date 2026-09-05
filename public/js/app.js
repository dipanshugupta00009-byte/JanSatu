/* Renders the shared top navigation and reacts to auth state. Call renderNav('active-key') on each page. */
function renderNav(activeKey) {
  const mount = document.getElementById('topbar');
  if (!mount) return;
  const user = API.user();

  const linkDefs = [
    { key: 'home', href: '/index.html', label: 'Home' },
    { key: 'submit', href: '/submit.html', label: 'Report a Challenge' },
    { key: 'browse', href: '/browse.html', label: 'Browse Challenges' },
    { key: 'track', href: '/track.html', label: 'My Submissions' }
  ];
  if (user && ['admin', 'institution', 'industry'].includes(user.role)) {
    linkDefs.push({ key: 'dashboard', href: '/dashboard.html', label: 'Review Dashboard' });
  }

  const links = linkDefs.map((l) =>
    `<a href="${l.href}" class="${l.key === activeKey ? 'active' : ''}">${l.label}</a>`
  ).join('');

  const userArea = user
    ? `<div class="nav-user">
         <span class="who">${user.name} · <span class="mono">${user.role}</span></span>
         <button class="btn btn-ghost btn-sm" id="logoutBtn">Sign out</button>
       </div>`
    : `<div class="nav-user">
         <a href="/auth.html" class="btn btn-outline btn-sm">Sign in</a>
       </div>`;

  mount.innerHTML = `
    <div class="topbar-inner">
      <a href="/index.html" class="brand" style="text-decoration:none;">
        <span class="brand-mark">JS</span>
        <span>JanSatu<small>Jharkhand · Citizens · HEIs · Industry</small></span>
      </a>
      <nav class="nav-links">${links}</nav>
      ${userArea}
    </div>`;

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      API.clearSession();
      window.location.href = '/index.html';
    });
  }
}

function requireAuth(roles) {
  const user = API.user();
  if (!user) { window.location.href = '/auth.html'; return null; }
  if (roles && !roles.includes(user.role)) {
    window.location.href = '/index.html';
    return null;
  }
  return user;
}
