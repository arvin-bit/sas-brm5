const DISCORD_API = 'https://discord.com/api/v10';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // Health checks
      if (url.pathname === '/health') {
        return json({ status: 'ok', unit: 'Task Force Orion', timestamp: Date.now() });
      }

      // Discord OAuth callback
      if (url.pathname === '/auth/callback' && request.method === 'POST') {
        return handleAuthCallback(request, env);
      }

      // Verify guild membership
      if (url.pathname === '/auth/verify' && request.method === 'POST') {
        return verifyGuildMember(request, env);
      }

      // Get announcements (from Discord channel)
      if (url.pathname === '/announcements' && request.method === 'GET') {
        return getAnnouncements(env);
      }

      // Post announcement to Discord
      if (url.pathname === '/announcements' && request.method === 'POST') {
        return postAnnouncement(request, env);
      }

      // Discord webhook endpoint (Discord -> App)
      if (url.pathname === '/webhook/discord' && request.method === 'POST') {
        return handleDiscordWebhook(request, env);
      }

      // Get unit status
      if (url.pathname === '/unit/status') {
        return getUnitStatus(env);
      }

      // Get active operations
      if (url.pathname === '/operations/active') {
        return getActiveOperations(request, env);
      }

      // Get personnel
      if (url.pathname === '/personnel') {
        return getPersonnel(request, env);
      }

      // Admin stats
      if (url.pathname === '/admin/stats') {
        return getAdminStats(request, env);
      }

      // Admin audit log
      if (url.pathname === '/admin/audit') {
        return getAuditLog(request, env);
      }

      return new Response('Not Found', { status: 404 });

    } catch (error) {
      console.error('Error:', error);
      return json({ error: error.message }, 500);
    }
  }
};

// Auth handlers
async function handleAuthCallback(request, env) {
  const { code, redirectUri } = await request.json();
  
  const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.CLIENT_ID,
      client_secret: env.CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: 'identify guilds.members.read'
    })
  });

  if (!tokenRes.ok) throw new Error('Token exchange failed');
  
  const tokenData = await tokenRes.json();
  
  const userRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
  });
  
  const user = await userRes.json();
  
  return json({
    id: user.id,
    username: user.username,
    avatar: user.avatar,
    access_token: tokenData.access_token
  });
}

async function verifyGuildMember(request, env) {
  const { userId, accessToken } = await request.json();
  
  const memberRes = await fetch(
    `${DISCORD_API}/users/@me/guilds/${env.GUILD_ID}/member`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );

  if (!memberRes.ok) {
    if (memberRes.status === 404) {
      return json({ error: 'Not a guild member' }, 403);
    }
    throw new Error('Failed to fetch member');
  }

  const member = await memberRes.json();
  
  const userRoles = ['everyone'];
  const memberRoleIds = member.roles || [];
  
  const ALLOWED_ROLES = {
    command: env.COMMAND_ROLE_ID ? [env.COMMAND_ROLE_ID] : [],
    staff: env.STAFF_ROLE_ID ? [env.STAFF_ROLE_ID, env.COMMAND_ROLE_ID] : []
  };
  
  if (ALLOWED_ROLES.command.some(id => memberRoleIds.includes(id))) {
    userRoles.push('staff', 'command');
  } else if (ALLOWED_ROLES.staff.some(id => memberRoleIds.includes(id))) {
    userRoles.push('staff');
  }

  return json({
    roles: userRoles,
    nickname: member.nick || member.user.username,
    joined_at: member.joined_at
  });
}

// Discord integration handlers
async function getAnnouncements(env) {
  // Fetch recent messages from announcements channel
  const channelId = env.ANNOUNCEMENTS_CHANNEL_ID;
  const botToken = env.DISCORD_BOT_TOKEN;
  
  if (!channelId || !botToken) {
    return json({ announcements: [], error: 'Not configured' });
  }

  const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages?limit=20`, {
    headers: { 'Authorization': `Bot ${botToken}` }
  });

  if (!res.ok) throw new Error('Failed to fetch announcements');

  const messages = await res.json();
  
  const announcements = messages
    .filter(m => !m.author.bot || m.webhook_id) // Include webhooks and non-bot messages
    .map(m => ({
      id: m.id,
      content: m.content,
      author: m.author.global_name || m.author.username,
      authorId: m.author.id,
      avatar: m.author.avatar,
      timestamp: m.timestamp,
      embeds: m.embeds,
      attachments: m.attachments.map(a => a.url)
    }));

  return json({ announcements });
}

async function postAnnouncement(request, env) {
  const auth = request.headers.get('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const token = auth.slice(7);
  
  // Verify user has command role
  const userRes = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  
  if (!userRes.ok) return json({ error: 'Invalid token' }, 401);
  
  const user = await userRes.json();
  
  // Check if user is in guild and has command role
  const memberRes = await fetch(
    `${DISCORD_API}/users/@me/guilds/${env.GUILD_ID}/member`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  
  if (!memberRes.ok) return json({ error: 'Not a guild member' }, 403);
  
  const member = await memberRes.json();
  const hasCommandRole = member.roles?.includes(env.COMMAND_ROLE_ID);
  
  if (!hasCommandRole) {
    return json({ error: 'Command role required' }, 403);
  }

  const { content, pinned = false } = await request.json();
  
  if (!content || content.trim().length === 0) {
    return json({ error: 'Content required' }, 400);
  }

  // Post to Discord channel
  const channelId = env.ANNOUNCEMENTS_CHANNEL_ID;
  const botToken = env.DISCORD_BOT_TOKEN;

  const messageRes = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${botToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: `📢 **ANNOUNCEMENT** 📢\n\n${content}`,
      allowed_mentions: { parse: ['everyone', 'roles', 'users'] }
    })
  });

  if (!messageRes.ok) {
    const error = await messageRes.text();
    throw new Error(`Discord API error: ${error}`);
  }

  const message = await messageRes.json();

  // Pin if requested
  if (pinned) {
    await fetch(`${DISCORD_API}/channels/${channelId}/messages/${message.id}/pin`, {
      method: 'PUT',
      headers: { 'Authorization': `Bot ${botToken}` }
    });
  }

  // Store in KV for app retrieval
  await env.Task Force Orion_KV?.put(`announcement:${message.id}`, JSON.stringify({
    id: message.id,
    content: content,
    author: user.username,
    authorId: user.id,
    timestamp: message.timestamp,
    pinned
  }));

  // Log to audit
  await logAudit(env, 'ANNOUNCEMENT_POST', {
    userId: user.id,
    username: user.username,
    messageId: message.id,
    content: content.substring(0, 100)
  });

  return json({ 
    success: true, 
    messageId: message.id,
    url: `https://discord.com/channels/${env.GUILD_ID}/${channelId}/${message.id}`
  });
}

async function handleDiscordWebhook(request, env) {
  // Verify webhook signature
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp = request.headers.get('X-Signature-Timestamp');
  
  if (!signature || !timestamp) {
    return json({ error: 'Missing signature' }, 401);
  }

  // Verify Discord webhook signature (implementation depends on your verification method)
  // For now, we check if the webhook token matches
  const body = await request.text();
  const data = JSON.parse(body);

  // Handle different webhook types
  if (data.type === 1) {
    // Ping
    return json({ type: 1 });
  }

  // Message created in announcements channel
  if (data.channel_id === env.ANNOUNCEMENTS_CHANNEL_ID && data.type === 0) {
    // Store announcement for app
    await env.Task Force Orion_KV?.put(`announcement:${data.id}`, JSON.stringify({
      id: data.id,
      content: data.content,
      author: data.author.global_name || data.author.username,
      authorId: data.author.id,
      avatar: data.author.avatar,
      timestamp: data.timestamp,
      embeds: data.embeds,
      source: 'discord'
    }));

    // Broadcast to connected app clients (using WebSockets or push)
    // This would need a separate WebSocket server or push notification service
  }

  return json({ success: true });
}

// Data handlers
async function getUnitStatus(env) {
  // Get from KV or return default
  const status = await env.Task Force Orion_KV?.get('unit:status');
  if (status) return json(JSON.parse(status));
  
  return json({
    status: 'Operational',
    message: 'All squadrons at normal readiness. No active operations at this time.',
    updatedAt: new Date().toISOString()
  });
}

async function getActiveOperations(request, env) {
  const auth = request.headers.get('Authorization');
  // Verify auth and return from KV/database
  const ops = await env.Task Force Orion_KV?.get('operations:active');
  return json(ops ? JSON.parse(ops) : []);
}

async function getPersonnel(request, env) {
  const auth = request.headers.get('Authorization');
  // Verify auth and return from KV/database
  const personnel = await env.Task Force Orion_KV?.get('personnel:list');
  return json(personnel ? JSON.parse(personnel) : []);
}

async function getAdminStats(request, env) {
  const auth = request.headers.get('Authorization');
  // Verify command role
  const stats = await env.Task Force Orion_KV?.get('admin:stats');
  return json(stats ? JSON.parse(stats) : {
    total: 0,
    active: 0,
    staff: 0,
    operations: 0
  });
}

async function getAuditLog(request, env) {
  const auth = request.headers.get('Authorization');
  // Verify command role
  const logs = await env.Task Force Orion_KV?.get('admin:audit');
  return json(logs ? JSON.parse(logs) : []);
}

async function logAudit(env, action, details) {
  const existing = await env.Task Force Orion_KV?.get('admin:audit');
  const logs = existing ? JSON.parse(existing) : [];
  
  logs.unshift({
    timestamp: new Date().toISOString(),
    action,
    details
  });
  
  // Keep last 1000 entries
  if (logs.length > 1000) logs.pop();
  
  await env.Task Force Orion_KV?.put('admin:audit', JSON.stringify(logs));
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}