/* ============================================================
   One-off: delete background images users removed from their list
   ------------------------------------------------------------
   Before background deletion removed the file too, taking a background out
   of your list in Settings only deleted its `user_backgrounds` row — the
   image stayed in storage. This finds those leftover files under
   task-images/backgrounds/, clears any remaining references to them (saved
   themes, current desktop and phone backgrounds), and deletes them.

   Supabase blocks deleting storage files from SQL, so this goes through the
   Storage API. It needs the SERVICE ROLE key (it acts across every user):
   Dashboard → Project Settings → API → service_role. Never commit that key.

   Dry run (lists what it would do, changes nothing):
     SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-orphan-backgrounds.js
   For real:
     SUPABASE_SERVICE_ROLE_KEY=... node scripts/cleanup-orphan-backgrounds.js --delete

   The project URL is read from .env (REACT_APP_SUPABASE_URL), or set
   SUPABASE_URL to override.
   ============================================================ */
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const BUCKET = 'task-images';
const PREFIX = 'backgrounds';
const APPLY = process.argv.includes('--delete');

function envFromFile(name) {
  try {
    const text = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
    const line = text.split(/\r?\n/).find(l => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : undefined;
  } catch { return undefined; }
}

const url = process.env.SUPABASE_URL || envFromFile('REACT_APP_SUPABASE_URL');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Need the project URL (.env REACT_APP_SUPABASE_URL or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const must = ({ data, error }, what) => {
  if (error) { console.error(`${what}: ${error.message}`); process.exit(1); }
  return data;
};

// Every file under backgrounds/<user id>/…, paging through each folder.
async function listAll(prefix) {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const page = must(await supabase.storage.from(BUCKET).list(prefix, { limit: 1000, offset }), `list ${prefix}`);
    for (const entry of page) {
      const full = `${prefix}/${entry.name}`;
      if (entry.id) out.push(full);               // a file
      else out.push(...await listAll(full));      // a folder
    }
    if (page.length < 1000) return out;
  }
}

const tail = (name) => `/object/public/${BUCKET}/${name}`;
const refersTo = (value, tails) => typeof value === 'string' && tails.some(t => value.endsWith(t));

(async () => {
  const files = await listAll(PREFIX);
  const library = must(await supabase.from('user_backgrounds').select('url'), 'read user_backgrounds');
  const kept = library.map(r => r.url);
  const orphans = files.filter(name => !kept.some(u => u.endsWith(tail(name))));
  const tails = orphans.map(tail);

  console.log(`${files.length} background file(s) in storage, ${library.length} still in someone's list.`);
  console.log(`${orphans.length} left over from backgrounds users removed:`);
  orphans.forEach(n => console.log(`  ${n}`));
  if (!orphans.length) return;

  // References that would break once the files are gone.
  const themes = must(await supabase.from('user_themes').select('id, name, colors'), 'read user_themes')
    .filter(t => refersTo(t.colors?.background, tails));
  const prefs = must(await supabase.from('user_preferences').select('id, theme_colors'), 'read user_preferences')
    .filter(p => refersTo(p.theme_colors?.background, tails) || refersTo(p.theme_colors?.mobile?.background, tails));

  console.log(`\n${themes.length} saved theme(s) and ${prefs.length} user(s)' current look reference them.`);

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --delete to clean up.');
    return;
  }

  for (const t of themes) {
    const colors = { ...t.colors };
    delete colors.background;
    must(await supabase.from('user_themes').update({ colors }).eq('id', t.id), `update theme ${t.name}`);
  }
  for (const p of prefs) {
    const theme = { ...p.theme_colors };
    if (refersTo(theme.background, tails)) delete theme.background;
    if (theme.mobile && refersTo(theme.mobile.background, tails)) {
      theme.mobile = { ...theme.mobile };
      delete theme.mobile.background;
      if (!Object.keys(theme.mobile).length) delete theme.mobile;
    }
    must(await supabase.from('user_preferences').update({ theme_colors: theme }).eq('id', p.id), `update preferences ${p.id}`);
  }

  // The Storage API takes up to 1000 paths per call.
  let removed = 0;
  for (let i = 0; i < orphans.length; i += 1000) {
    const batch = orphans.slice(i, i + 1000);
    removed += must(await supabase.storage.from(BUCKET).remove(batch), 'delete files').length;
  }
  console.log(`\nCleared ${themes.length} theme(s) and ${prefs.length} user look(s); deleted ${removed} file(s).`);
})().catch(err => { console.error(err); process.exit(1); });
