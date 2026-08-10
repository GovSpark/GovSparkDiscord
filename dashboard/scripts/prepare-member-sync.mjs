import fs from 'node:fs';

const secretDirectory = process.env.SECRET_DIRECTORY || '/secrets';
const outputPath = process.env.OUTPUT_PATH || `${secretDirectory}/member-sync.sql`;
const token = fs.readFileSync(`${secretDirectory}/DISCORD_BOT_TOKEN`, 'utf8').trim();
const guildId = fs.readFileSync(`${secretDirectory}/DISCORD_GUILD_ID`, 'utf8').trim();
const eligibleRoleIds = new Set(
  (process.env.DISCORD_ASSIGNEE_ROLE_IDS || '').split(',').map((value) => value.trim()).filter(Boolean),
);
if (eligibleRoleIds.size === 0) throw new Error('DISCORD_ASSIGNEE_ROLE_IDS is required.');

const members = [];
let after = '0';
for (;;) {
  const response = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000&after=${after}`,
    { headers: { authorization: `Bot ${token}` } },
  );
  if (!response.ok) throw new Error(`Discord member fetch failed: HTTP ${response.status} ${await response.text()}`);
  const page = await response.json();
  members.push(...page);
  if (page.length < 1000) break;
  after = page.at(-1).user.id;
}

const eligible = members.filter(
  (member) => !member.user?.bot && member.roles.some((roleId) => eligibleRoleIds.has(roleId)),
);
const now = new Date().toISOString();
let sql = `UPDATE discord_members SET eligible = 0, synced_at = ${quote(now)};\n`;
for (const member of eligible) {
  const user = member.user;
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128`
    : null;
  const displayName = member.nick || user.global_name || user.username;
  sql += `INSERT INTO discord_members
    (id, username, display_name, avatar_url, role_ids, eligible, synced_at)
    VALUES (${quote(user.id)}, ${quote(user.username)}, ${quote(displayName)}, ${quote(avatarUrl)},
      ${quote(JSON.stringify(member.roles))}, 1, ${quote(now)})
    ON CONFLICT(id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name,
      avatar_url = excluded.avatar_url, role_ids = excluded.role_ids, eligible = 1, synced_at = excluded.synced_at;\n`;
}
fs.writeFileSync(outputPath, sql, { mode: 0o600 });
console.info(`Eligible members prepared: ${eligible.length}`);

function quote(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replaceAll("'", "''")}'`;
}
