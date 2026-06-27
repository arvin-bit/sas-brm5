const AUTH_CONFIG = {
  discordClientId: '1491725983131369552',
  redirectUri: window.location.origin + '/app/login.html',
  backendUrl: window.location.origin
};

const ROLE_HIERARCHY = {
  'command': 3,
  'staff': 2,
  'member': 1
};

class AuthManager {
  constructor() {
    this.user = null;
    this.processing = false;
    this.init();
  }

  init() {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    const error = urlParams.get('error');
    
    // Handle OAuth errors
    if (error) {
      console.error('OAuth error:', error);
      this.showError('Login failed. Please try again.');
      return;
    }
    
    // Handle OAuth callback
    if (code && window.location.pathname.includes('/login.html')) {
      // Remove code from URL immediately to prevent reuse on refresh
      window.history.replaceState({}, document.title, window.location.pathname);
      this.handleCallback(code);
      return;
    }
    
    // Normal session check
    this.checkSession();
  }

  async handleCallback(code) {
    if (this.processing) return;
    this.processing = true;
    
    try {
      const response = await fetch(`${AUTH_CONFIG.backendUrl}/api/discord/callback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          code: code, 
          redirectUri: AUTH_CONFIG.redirectUri
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
      }

      const data = await response.json();
      
      // Validate response data
      if (!data.id || !data.username) {
        throw new Error('Invalid response from server');
      }
      
      this.setSession(data);
      
      // Redirect to main app
      window.location.href = '/app.html';
      
    } catch (err) {
      console.error('Auth error:', err);
      this.showError('Authentication failed: ' + err.message);
      this.processing = false;
    }
  }

  setSession(data) {
    localStorage.setItem('Task Force Orion_user', JSON.stringify({
      username: data.username,
      roles: data.roles || ['member'],
      avatar: data.avatar,
      id: data.id,
      expires: Date.now() + (24 * 60 * 60 * 1000) // 24h
    }));
  }

  getSession() {
    const stored = localStorage.getItem('Task Force Orion_user');
    if (!stored) return null;
    
    try {
      const user = JSON.parse(stored);
      if (Date.now() > user.expires) {
        this.clearSession();
        return null;
      }
      return user;
    } catch (e) {
      this.clearSession();
      return null;
    }
  }

  clearSession() {
    localStorage.removeItem('Task Force Orion_user');
    this.user = null;
  }

  checkSession() {
    this.user = this.getSession();
    
    // If on login page but already logged in, go to app
    if (this.user && window.location.pathname.includes('/login.html')) {
      window.location.href = '/app.html';
      return false;
    }
    
    // If on protected page but not logged in, go to login
    if (!this.user && !this.isPublicPage()) {
      window.location.href = '/app/login.html';
      return false;
    }
    
    return true;
  }

  isPublicPage() {
    return window.location.pathname.includes('/login.html');
  }

  hasRole(minRole) {
    if (!this.user) return false;
    const userLevel = Math.max(...this.user.roles.map(r => ROLE_HIERARCHY[r] || 0));
    const requiredLevel = ROLE_HIERARCHY[minRole] || 0;
    return userLevel >= requiredLevel;
  }

  getHighestRole() {
    if (!this.user) return null;
    return this.user.roles.reduce((highest, role) => {
      return (ROLE_HIERARCHY[role] || 0) > (ROLE_HIERARCHY[highest] || 0) ? role : highest;
    }, 'member');
  }

  logout() {
    this.clearSession();
    window.location.href = '/app/login.html';
  }

  showError(msg) {
    const errorDiv = document.getElementById('authError');
    if (errorDiv) {
      errorDiv.textContent = msg;
      errorDiv.style.display = 'block';
      setTimeout(() => {
        errorDiv.style.display = 'none';
      }, 5000);
    } else {
      alert(msg);
    }
  }

  updateUI() {
    if (!this.user) return;

    // Update user menu if exists
    const userMenu = document.getElementById('userMenu');
    const roleBadge = document.getElementById('roleBadge');
    
    if (userMenu) {
      userMenu.style.display = 'flex';
      const avatar = userMenu.querySelector('.user-avatar');
      const username = userMenu.querySelector('.username');
      
      if (avatar) {
        avatar.textContent = this.user.username.slice(0, 2).toUpperCase();
        if (this.user.avatar) {
          avatar.style.backgroundImage = `url(${this.user.avatar})`;
          avatar.style.backgroundSize = 'cover';
          avatar.textContent = '';
        }
      }
      if (username) username.textContent = this.user.username;
    }

    if (roleBadge) {
      const highest = this.getHighestRole();
      roleBadge.className = `role-badge ${highest}`;
      roleBadge.textContent = highest;
    }

    this.updateNavAccess();
  }

  updateNavAccess() {
    // Lock/unlock nav items based on roles
    document.querySelectorAll('[data-require="staff"]').forEach(link => {
      if (!this.hasRole('staff')) {
        link.classList.add('nav-locked');
        link.href = '#';
        link.onclick = (e) => {
          e.preventDefault();
          alert('Staff access required');
        };
      }
    });

    document.querySelectorAll('[data-require="command"]').forEach(link => {
      if (!this.hasRole('command')) {
        link.classList.add('nav-locked');
        link.href = '#';
        link.onclick = (e) => {
          e.preventDefault();
          alert('Command access required');
        };
      }
    });
  }

  protectAdminPage() {
    if (!this.hasRole('command')) {
      document.body.innerHTML = `
        <div style="text-align: center; padding: 4rem; font-family: system-ui;">
          <div style="font-size: 4rem; margin-bottom: 1rem;">⛔</div>
          <h1>Access Denied</h1>
          <p>Command personnel only.</p>
          <a href="/app.html" style="color: #5865F2;">Return to Dashboard</a>
        </div>
      `;
      return false;
    }
    return true;
  }
}

// Initialize
const auth = new AuthManager();

// Protect pages on load
document.addEventListener('DOMContentLoaded', () => {
  if (!auth.isPublicPage()) {
    if (!auth.checkSession()) return;
    auth.updateUI();
  }
});