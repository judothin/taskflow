<?php
/**
 * Plugin Name: TaskFlow for WordPress
 * Description: TaskFlow as a slide-out sidebar on the dev site: per-page review comments plus TaskFlow tasks, Go Live and Review, signed in with TaskFlow accounts. Comments stay in this site's database. mu-plugin.
 * Version: 3.0
 */

if (!defined('ABSPATH')) exit;

class DevComments {

    private static $table;
    private static $users;


    public static function init() {
        global $wpdb;
        self::$table = $wpdb->prefix . 'dev_comments';
        self::$users = $wpdb->prefix . 'dev_comment_users';
        self::maybe_create_tables();

        foreach (['all','post','like','check','down','done','tasked','tasklink','pin','edit','delete','upload','poll','typing','presence','session','me','settings','gif'] as $a) {
            add_action("wp_ajax_dc_$a", [__CLASS__, "ajax_$a"]);
            add_action("wp_ajax_nopriv_dc_$a", [__CLASS__, "ajax_$a"]);
        }
        add_action('wp_footer', [__CLASS__, 'render']);
        /* the panel on wp-admin screens too, for logged-in WP users */
        add_action('admin_footer', [__CLASS__, 'maybe_render_admin']);
        add_action('admin_menu', [__CLASS__, 'admin_menu']);
        add_action('admin_head', [__CLASS__, 'admin_styles']);
        add_action('admin_post_dc_admin', [__CLASS__, 'admin_handle']);
    }

    private static function maybe_create_tables() {
        global $wpdb;
        /* v9: accounts come from TaskFlow (Supabase). sb_uid links a local row
           to its TaskFlow user; tf_role is that user's role in the site's team;
           tf_profile caches name colour / avatar. Comments can point at the
           TaskFlow task made from them. */
        if (get_option('dc_table_v3') && !get_option('dc_table_v9')) {
            if (!$wpdb->get_var("SHOW COLUMNS FROM " . self::$users . " LIKE 'sb_uid'"))
                $wpdb->query("ALTER TABLE " . self::$users . " ADD COLUMN sb_uid VARCHAR(64) NOT NULL DEFAULT '', ADD KEY sb_uid (sb_uid)");
            if (!$wpdb->get_var("SHOW COLUMNS FROM " . self::$users . " LIKE 'tf_role'"))
                $wpdb->query("ALTER TABLE " . self::$users . " ADD COLUMN tf_role VARCHAR(20) NOT NULL DEFAULT ''");
            if (!$wpdb->get_var("SHOW COLUMNS FROM " . self::$users . " LIKE 'tf_profile'"))
                $wpdb->query("ALTER TABLE " . self::$users . " ADD COLUMN tf_profile TEXT");
            if (!$wpdb->get_var("SHOW COLUMNS FROM " . self::$table . " LIKE 'task_id'"))
                $wpdb->query("ALTER TABLE " . self::$table . " ADD COLUMN task_id VARCHAR(64) NOT NULL DEFAULT ''");
            update_option('dc_table_v9', 1);
        }
        /* v4: the checks reaction column, added to existing installs */
        if (get_option('dc_table_v3') && !get_option('dc_table_v4')) {
            if (!$wpdb->get_var("SHOW COLUMNS FROM " . self::$table . " LIKE 'checks'"))
                $wpdb->query("ALTER TABLE " . self::$table . " ADD COLUMN checks TEXT AFTER likes");
            update_option('dc_table_v4', 1);
        }
        /* v8: moderator-pinned comments, kept out of the feed until revealed */
        if (get_option('dc_table_v3') && !get_option('dc_table_v8')) {
            if (!$wpdb->get_var("SHOW COLUMNS FROM " . self::$table . " LIKE 'pinned'"))
                $wpdb->query("ALTER TABLE " . self::$table . " ADD COLUMN pinned TINYINT(1) NOT NULL DEFAULT 0");
            update_option('dc_table_v8', 1);
        }
        /* v7: when each reaction happened (the arrays only say who) */
        if (get_option('dc_table_v3') && !get_option('dc_table_v7')) {
            if (!$wpdb->get_var("SHOW COLUMNS FROM " . self::$table . " LIKE 'react_log'"))
                $wpdb->query("ALTER TABLE " . self::$table . " ADD COLUMN react_log TEXT AFTER dones");
            update_option('dc_table_v7', 1);
        }
        /* v6: moderator flag on accounts */
        if (get_option('dc_table_v3') && !get_option('dc_table_v6')) {
            if (!$wpdb->get_var("SHOW COLUMNS FROM " . self::$users . " LIKE 'is_admin'"))
                $wpdb->query("ALTER TABLE " . self::$users . " ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0");
            update_option('dc_table_v6', 1);
        }
        /* v5: thumbs-down reaction + the separate done/collapse flag */
        if (get_option('dc_table_v3') && !get_option('dc_table_v5')) {
            if (!$wpdb->get_var("SHOW COLUMNS FROM " . self::$table . " LIKE 'downs'"))
                $wpdb->query("ALTER TABLE " . self::$table . " ADD COLUMN downs TEXT AFTER checks");
            if (!$wpdb->get_var("SHOW COLUMNS FROM " . self::$table . " LIKE 'dones'"))
                $wpdb->query("ALTER TABLE " . self::$table . " ADD COLUMN dones TEXT AFTER downs");
            update_option('dc_table_v5', 1);
        }
        if (get_option('dc_table_v3')) return;
        $charset = $wpdb->get_charset_collate();
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta("CREATE TABLE " . self::$table . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            context VARCHAR(191) NOT NULL,
            parent_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            author VARCHAR(60) NOT NULL,
            content TEXT NOT NULL,
            likes TEXT,
            checks TEXT,
            downs TEXT,
            dones TEXT,
            react_log TEXT,
            pinned TINYINT(1) NOT NULL DEFAULT 0,
            task_id VARCHAR(64) NOT NULL DEFAULT '',
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY context (context),
            KEY parent_id (parent_id)
        ) $charset;");
        dbDelta("CREATE TABLE " . self::$users . " (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            email VARCHAR(191) NOT NULL,
            name VARCHAR(60) NOT NULL,
            pass_hash VARCHAR(255) NOT NULL DEFAULT '',
            token_hash VARCHAR(64) NOT NULL DEFAULT '',
            settings LONGTEXT,
            is_admin TINYINT(1) NOT NULL DEFAULT 0,
            sb_uid VARCHAR(64) NOT NULL DEFAULT '',
            tf_role VARCHAR(20) NOT NULL DEFAULT '',
            tf_profile TEXT,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            UNIQUE KEY email (email),
            KEY sb_uid (sb_uid)
        ) $charset;");
        update_option('dc_table_v3', 1);
        update_option('dc_table_v4', 1);
        update_option('dc_table_v5', 1);
        update_option('dc_table_v6', 1);
        update_option('dc_table_v7', 1);
        update_option('dc_table_v8', 1);
        update_option('dc_table_v9', 1);
    }

    /* ==================== auth ==================== */

    /* legacy theme values from earlier versions are dropped on read */
    private static function normalize_settings($user_id, $raw) {
        $st = json_decode($raw ?: '{}', true) ?: [];
        if (isset($st['theme'])) {
            global $wpdb;
            unset($st['theme']);
            $wpdb->update(self::$users, ['settings' => wp_json_encode($st)], ['id' => (int) $user_id]);
        }
        return $st;
    }

    /* ---- TaskFlow connection ----
       Accounts live in TaskFlow's Supabase project. The browser signs in to
       Supabase directly (the anon key is public by design) and sends its
       access token with every request here; the server asks Supabase who the
       token belongs to and mirrors that person into the local accounts table,
       so comments, reactions and panel settings keep using local ids. Nothing
       is ever written to Supabase from PHP. */
    public static function sb_url()   { return rtrim(trim((string) get_option('dc_sb_url', '')), '/'); }
    public static function sb_anon()  { return trim((string) get_option('dc_sb_anon', '')); }
    public static function sb_ready() { return self::sb_url() !== '' && self::sb_anon() !== ''; }
    /* the TaskFlow team this site belongs to ('' = any team the person is in) */
    public static function team_lock() { return trim((string) get_option('dc_sb_team', '')); }

    private static $auth_error = '';

    private static function sb_get($path, $access) {
        $res = wp_remote_get(self::sb_url() . $path, [
            'timeout' => 8,
            'headers' => [
                'apikey'        => self::sb_anon(),
                'Authorization' => 'Bearer ' . $access,
                'Accept'        => 'application/json',
            ],
        ]);
        if (is_wp_error($res)) return [0, null];
        return [(int) wp_remote_retrieve_response_code($res), json_decode(wp_remote_retrieve_body($res), true)];
    }

    /* The token's expiry, read WITHOUT verifying the signature: it only sizes
       the verification cache. Trust comes from Supabase answering /user. */
    private static function jwt_exp($jwt) {
        $p = explode('.', (string) $jwt);
        if (count($p) !== 3) return 0;
        $b = strtr($p[1], '-_', '+/');
        $b .= str_repeat('=', (4 - strlen($b) % 4) % 4);
        $j = json_decode((string) base64_decode($b), true);
        return is_array($j) && !empty($j['exp']) ? (int) $j['exp'] : 0;
    }

    /* teams seen at sign-in, so the settings screen can offer them by name */
    private static function remember_teams($teams) {
        $seen = get_option('dc_sb_teams_seen', []);
        if (!is_array($seen)) $seen = [];
        $changed = false;
        foreach ($teams as $t) {
            if (($seen[$t['id']] ?? null) !== $t['name']) { $seen[$t['id']] = $t['name']; $changed = true; }
        }
        if ($changed) update_option('dc_sb_teams_seen', $seen, false);
    }

    /* Who is this token? Asks Supabase, reads the person's TaskFlow profile and
       teams (as them, so RLS applies), then creates or refreshes the local row.
       A pre-TaskFlow account with the same email is adopted, so its comments,
       reactions and panel settings carry straight over. */
    private static function sb_sync($access) {
        global $wpdb;
        [$code, $u] = self::sb_get('/auth/v1/user', $access);
        if ($code !== 200 || !is_array($u) || empty($u['id'])) return ['error' => 'auth'];
        $uid   = preg_replace('/[^a-f0-9\-]/i', '', (string) $u['id']);
        $email = strtolower(sanitize_email($u['email'] ?? ''));

        [, $prof] = self::sb_get('/rest/v1/profiles?select=first_name,last_name,color,avatar_url&id=eq.' . rawurlencode($uid), $access);
        $prof = (is_array($prof) && isset($prof[0]) && is_array($prof[0])) ? $prof[0] : [];
        [, $mem] = self::sb_get('/rest/v1/team_members?select=team_id,role,teams(name)&user_id=eq.' . rawurlencode($uid), $access);
        $teams = [];
        foreach ((array) $mem as $m) {
            if (!is_array($m) || empty($m['team_id'])) continue;
            $teams[] = [
                'id'   => preg_replace('/[^a-f0-9\-]/i', '', (string) $m['team_id']),
                'role' => sanitize_key($m['role'] ?? 'member'),
                'name' => sanitize_text_field($m['teams']['name'] ?? 'Team'),
            ];
        }
        self::remember_teams($teams);
        $lock = self::team_lock();
        if ($lock !== '' && !in_array($lock, array_column($teams, 'id'), true)) return ['error' => 'team'];

        /* TaskFlow owners/admins of the site's team moderate here */
        $role = '';
        foreach ($teams as $t) if ($lock !== '' && $t['id'] === $lock) $role = $t['role'];

        $name = trim(($prof['first_name'] ?? '') . ' ' . ($prof['last_name'] ?? ''));
        if ($name === '') $name = $email ? (string) strstr($email, '@', true) : 'TaskFlow user';
        $name   = mb_substr(sanitize_text_field($name), 0, 60);
        $color  = preg_match('/^#[0-9a-f]{6}$/i', (string) ($prof['color'] ?? '')) ? strtolower($prof['color']) : '';
        $avatar = !empty($prof['avatar_url']) ? esc_url_raw($prof['avatar_url']) : '';
        $email  = $email ?: ('sb-' . $uid);

        $id = (int) $wpdb->get_var($wpdb->prepare("SELECT id FROM " . self::$users . " WHERE sb_uid = %s", $uid));
        if (!$id) $id = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT id FROM " . self::$users . " WHERE email = %s AND sb_uid = ''", $email));
        /* emails are unique here: whoever else holds this address (an old
           local account TaskFlow has since replaced) steps aside */
        $wpdb->query($wpdb->prepare(
            "UPDATE " . self::$users . " SET email = CONCAT('replaced-', id, '-', email) WHERE email = %s AND id <> %d",
            $email, $id));
        $data = [
            'email' => $email, 'name' => $name, 'sb_uid' => $uid, 'tf_role' => $role,
            'tf_profile' => wp_json_encode(['color' => $color, 'avatar' => $avatar, 'teams' => $teams]),
        ];
        if ($id) {
            $old = $wpdb->get_var($wpdb->prepare("SELECT name FROM " . self::$users . " WHERE id = %d", $id));
            $wpdb->update(self::$users, $data, ['id' => $id]);
            if ($old !== $name) {
                /* the denormalized author column follows the TaskFlow name */
                $wpdb->update(self::$table, ['author' => $name], ['user_id' => $id]);
                self::bump_version();
            }
        } else {
            $wpdb->insert(self::$users, $data + [
                'pass_hash' => '', 'settings' => '{}', 'created_at' => current_time('mysql'),
            ]);
            $id = (int) $wpdb->insert_id;
            self::bump_version();
        }
        return $id;
    }

    /* $fresh skips the cache: sign-in and page boot re-read the TaskFlow
       profile so a renamed person or a changed avatar shows up straight away */
    private static function user_from_token($fresh = false) {
        global $wpdb;
        if (!self::sb_ready()) { self::$auth_error = 'setup'; return null; }
        $token = trim((string) wp_unslash($_POST['token'] ?? ''));
        if ($token === '' || strlen($token) > 8192 || !preg_match('/^[A-Za-z0-9\-_\.]+$/', $token)) return null;
        $key = 'dc_sbv_' . substr(hash('sha256', $token), 0, 40);
        $id  = $fresh ? 0 : (int) get_transient($key);
        if (!$id) {
            $r = self::sb_sync($token);
            if (is_array($r)) { self::$auth_error = $r['error']; return null; }
            $id  = (int) $r;
            $exp = self::jwt_exp($token);
            set_transient($key, $id, $exp ? max(30, min(900, $exp - time())) : 300);
        }
        return $wpdb->get_row($wpdb->prepare(
            "SELECT id, email, name, settings, is_admin, sb_uid, tf_role, tf_profile FROM " . self::$users . " WHERE id = %d",
            $id
        ), ARRAY_A);
    }

    private static function auth_fail() {
        $why = self::$auth_error;
        if ($why === 'team')  wp_send_json_error(['code' => 'team',  'msg' => 'Your TaskFlow account isn\'t in the team this site uses. Ask an owner for an invite code.']);
        if ($why === 'setup') wp_send_json_error(['code' => 'setup', 'msg' => 'TaskFlow isn\'t connected yet. An admin needs to add the Supabase keys under Dev Comments → TaskFlow.']);
        wp_send_json_error(['code' => 'auth', 'msg' => 'Please sign in with your TaskFlow account.']);
    }

    private static function require_user() {
        $u = self::user_from_token();
        if (!$u) self::auth_fail();
        return $u;
    }

    /* moderators may edit and delete anyone's comment, like the author would:
       the WP-side flag, or owner/admin of the site's TaskFlow team */
    private static function is_mod($u) {
        return !empty($u['is_admin']) || in_array($u['tf_role'] ?? '', ['owner', 'admin'], true);
    }

    /* every notifiable event; each one is opt-in per user for browser and phone */
    const NOTIF_EVENTS = ['comment', 'reply', 'mention', 'like', 'check', 'down', 'done', 'task'];

    private static function user_payload($u) {
        $tf = json_decode($u['tf_profile'] ?? '', true) ?: [];
        return [
            'id'       => (int) $u['id'],
            'name'     => $u['name'],
            'email'    => $u['email'],
            'sb_uid'   => $u['sb_uid'] ?? '',
            'is_admin' => self::is_mod($u) ? 1 : 0,
            'role'     => $u['tf_role'] ?? '',
            'color'    => $tf['color'] ?? '',
            'avatar'   => $tf['avatar'] ?? '',
            'teams'    => $tf['teams'] ?? [],
            'settings' => (object) self::normalize_settings($u['id'], $u['settings']),
        ];
    }

    /* sign-in: the browser has just signed in to TaskFlow and hands over its token */
    public static function ajax_session() {
        check_ajax_referer('dc_nonce', 'nonce');
        $u = self::user_from_token(true);
        if (!$u) self::auth_fail();
        wp_send_json_success(['user' => self::user_payload($u)]);
    }

    public static function ajax_me() {
        check_ajax_referer('dc_nonce', 'nonce');
        $u = self::user_from_token(!empty($_POST['fresh']));
        if (!$u) self::auth_fail();
        wp_send_json_success(['user' => self::user_payload($u)]);
    }

    /* merge validated settings into the account; only known keys accepted */
    public static function ajax_settings() {
        check_ajax_referer('dc_nonce', 'nonce');
        global $wpdb;
        $u = self::require_user();
        $in = json_decode(wp_unslash($_POST['settings'] ?? '{}'), true);
        if (!is_array($in)) wp_send_json_error(['msg' => 'Bad settings.']);
        $cur = json_decode($u['settings'] ?? '{}', true) ?: [];
        /* notifications: per event, b = browser popup, p = phone via ntfy */
        if (isset($in['notif']) && is_array($in['notif'])) {
            $n   = $in['notif'];
            $out = ['on' => !empty($n['on']) ? 1 : 0, 'asked' => 1];
            $out['events'] = [];
            foreach (self::NOTIF_EVENTS as $k) {
                $e = $n['events'][$k] ?? [];
                $out['events'][$k] = ['b' => !empty($e['b']) ? 1 : 0, 'p' => !empty($e['p']) ? 1 : 0];
            }
            $out['mute'] = [];
            foreach ((array) ($n['mute'] ?? []) as $m)
                if (($m = absint($m))) $out['mute'][] = $m;
            $out['mute'] = array_values(array_unique($out['mute']));
            /* the topic string is the only thing protecting the feed, so keep it
               to generated-looking characters and a sane length */
            $t = preg_replace('/[^A-Za-z0-9_\-]/', '', (string) ($n['topic'] ?? ''));
            $out['topic'] = substr($t, 0, 64);
            $srv = esc_url_raw(trim((string) ($n['server'] ?? '')));
            if ($srv === '' || strpos($srv, 'https://') !== 0) $srv = 'https://ntfy.sh';
            $out['server'] = rtrim($srv, '/');
            $cur['notif'] = $out;
        }
        if (isset($in['width'])) {
            $w = (int) $in['width'];
            if ($w < 20 || $w > 90) wp_send_json_error(['msg' => 'Width must be 20–90%.']);
            $cur['width'] = $w;
        }
        /* per-user panel background: image + blur + tint */
        if (array_key_exists('bg_img', $in)) {
            $a = trim((string) $in['bg_img']);
            if ($a !== '' && $a !== 'none') {
                $a = esc_url_raw($a);
                $base = wp_upload_dir()['baseurl'];
                if (strpos($a, $base) !== 0) wp_send_json_error(['msg' => 'Bad background URL.']);
            }
            $cur['bg_img'] = $a;
        }
        if (isset($in['bg_blur'])) {
            $b = (int) $in['bg_blur'];
            $cur['bg_blur'] = max(0, min(40, $b));
        }
        if (array_key_exists('bg_tint', $in)) {
            $t = strtolower(trim((string) $in['bg_tint']));
            if ($t !== '' && !preg_match('/^#[0-9a-f]{6}$/', $t))
                wp_send_json_error(['msg' => 'Tint must be a hex colour.']);
            $cur['bg_tint'] = $t;
        }
        if (isset($in['bg_opacity'])) {
            $o = (int) $in['bg_opacity'];
            $cur['bg_opacity'] = max(0, min(100, $o));
        }
        if (array_key_exists('avatar', $in)) {
            $a = trim((string) $in['avatar']);
            if ($a !== '') {
                $a = esc_url_raw($a);
                $base = wp_upload_dir()['baseurl'];
                if (strpos($a, $base) !== 0) wp_send_json_error(['msg' => 'Bad avatar URL.']);
            }
            $cur['avatar'] = $a;
        }
        if (isset($in['scale'])) {
            $sc = (int) $in['scale'];
            if ($sc < 70 || $sc > 160) wp_send_json_error(['msg' => 'Scale must be 70–160%.']);
            $cur['scale'] = $sc;
        }
        if (isset($in['hidepins'])) {                       /* per-user hidden page dots */
            $ids = array_values(array_unique(array_filter(array_map('absint', (array) $in['hidepins']))));
            $cur['hidepins'] = array_slice($ids, -500);
        }
        if (isset($in['side'])) {
            $sd = sanitize_key($in['side']);
            if (!in_array($sd, ['left', 'right'], true)) wp_send_json_error(['msg' => 'Bad side.']);
            $cur['side'] = $sd;
        }
        if (array_key_exists('accent', $in)) {
            $a = strtolower(trim((string) $in['accent']));
            if ($a !== '' && !preg_match('/^#[0-9a-f]{6}$/', $a))
                wp_send_json_error(['msg' => 'Accent must be a hex colour.']);
            $cur['accent'] = $a;
        }
        if (array_key_exists('namecolor2', $in)) {
            $n2 = strtolower(trim((string) $in['namecolor2']));
            if ($n2 !== '' && !preg_match('/^#[0-9a-f]{6}$/', $n2))
                wp_send_json_error(['msg' => 'Name colour must be a hex colour.']);
            $cur['namecolor2'] = $n2;
        }
        if (array_key_exists('namecolor', $in)) {
            $n = strtolower(trim((string) $in['namecolor']));
            if ($n !== '' && !preg_match('/^#[0-9a-f]{6}$/', $n))
                wp_send_json_error(['msg' => 'Name colour must be a hex colour.']);
            $cur['namecolor'] = $n;
        }
        if (isset($in['media'])) {
            $m = (int) $in['media'];
            if ($m < 120 || $m > 560) wp_send_json_error(['msg' => 'Media size must be 120–560px.']);
            $cur['media'] = $m;
        }
        if (isset($in['timefmt'])) {
            $tf = sanitize_key($in['timefmt']);
            if (!in_array($tf, ['relative', 'clock'], true)) wp_send_json_error(['msg' => 'Bad time format.']);
            $cur['timefmt'] = $tf;
        }
        if (isset($in['tabpos'])) {
            $tp = sanitize_key($in['tabpos']);
            if (!in_array($tp, ['top', 'middle', 'bottom'], true)) wp_send_json_error(['msg' => 'Bad tab position.']);
            $cur['tabpos'] = $tp;
        }
        if (isset($in['tabsize'])) {
            $ts = sanitize_key($in['tabsize']);
            if (!in_array($ts, ['s', 'm', 'l'], true)) wp_send_json_error(['msg' => 'Bad tab size.']);
            $cur['tabsize'] = $ts;
        }
        /* light / dark / follow the OS; TaskFlow keeps its own per-device */
        if (isset($in['mode'])) {
            $md = sanitize_key($in['mode']);
            if (!in_array($md, ['dark', 'light', 'system'], true)) wp_send_json_error(['msg' => 'Bad theme.']);
            $cur['mode'] = $md;
        }
        /* 1 = take colours, preset and background from the TaskFlow account */
        if (isset($in['tflook'])) $cur['tflook'] = !empty($in['tflook']) ? 1 : 0;
        if (isset($in['tfview'])) {
            $tv = sanitize_key($in['tfview']);
            if (in_array($tv, ['comments', 'tasks', 'golive', 'review'], true)) $cur['tfview'] = $tv;
        }
        /* the name itself is the TaskFlow profile name; edit it there */
        $wpdb->update(self::$users, ['settings' => wp_json_encode($cur)], ['id' => (int) $u['id']]);
        self::bump_version();
        wp_send_json_success(['settings' => $cur, 'name' => $u['name']]);
    }

    /* ==================== version + typing ==================== */

    private static function bump_version() {
        update_option('dc_version', (string) microtime(true), true);
        wp_cache_delete('dc_version', 'options');
    }

    private static function raw_version() {
        global $wpdb;
        return (string) $wpdb->get_var(
            "SELECT option_value FROM {$wpdb->options} WHERE option_name = 'dc_version' LIMIT 1"
        );
    }

    private static function set_typing($ctx, $uid, $on) {
        $map = json_decode(get_option('dc_typing', '{}'), true) ?: [];
        $now = time();
        foreach ($map as $c => $people) {
            foreach ($people as $n => $exp) { if ($exp <= $now) unset($map[$c][$n]); }
            if (empty($map[$c])) unset($map[$c]);
        }
        if ($on) { $map[$ctx][$uid] = $now + 8; }   // heartbeat refreshes; 8s = crash fallback
        else     { unset($map[$ctx][$uid]); if (empty($map[$ctx])) unset($map[$ctx]); }
        update_option('dc_typing', wp_json_encode($map), true);
        wp_cache_delete('dc_typing', 'options');
    }

    private static function typing_state($names) {
        $map = json_decode(get_option('dc_typing', '{}'), true) ?: [];
        $now = time();
        $out = [];
        foreach ($map as $ctx => $people) {
            foreach ($people as $uid => $exp) {
                if ($exp > $now && isset($names[$uid]))
                    $out[$ctx][] = ['uid' => (int) $uid, 'name' => esc_html($names[$uid]), 'ttl' => ($exp - $now) * 1000];
            }
        }
        return $out;
    }

    /* ---- presence: who has which page open right now ----
       map[uid][context] = expiry. Heartbeats only refresh the expiry, so they
       bump the shared version (and wake every long-poll) only when someone
       arrives, leaves, or times out. */
    private static function presence_map() {
        return json_decode(get_option('dc_presence', '{}'), true) ?: [];
    }

    private static function presence_state() {
        $now = time();
        $out = [];
        foreach (self::presence_map() as $uid => $ctxs) {
            foreach ((array) $ctxs as $c => $exp) {
                if ($exp > $now) $out[] = ['uid' => (int) $uid, 'ctx' => esc_html($c), 'ttl' => ($exp - $now) * 1000];
            }
        }
        return $out;
    }

    public static function ajax_presence() {
        check_ajax_referer('dc_nonce', 'nonce');
        $u   = self::require_user();
        $uid = (string) (int) $u['id'];
        $ctx = self::context_from_request();
        $now = time();
        $map = self::presence_map();
        $changed = false;
        foreach ($map as $k => $ctxs) {                       /* drop timeouts */
            foreach ((array) $ctxs as $c => $exp) {
                if ($exp <= $now) { unset($map[$k][$c]); $changed = true; }
            }
            if (empty($map[$k])) unset($map[$k]);
        }
        if (!empty($_POST['leave'])) {
            if (isset($map[$uid][$ctx])) { unset($map[$uid][$ctx]); $changed = true; }
            if (empty($map[$uid])) unset($map[$uid]);
        } else {
            if (!isset($map[$uid][$ctx])) $changed = true;
            $map[$uid][$ctx] = $now + 45;                     /* 20s heartbeat, 45s grace */
        }
        update_option('dc_presence', wp_json_encode($map), true);
        wp_cache_delete('dc_presence', 'options');
        if ($changed) self::bump_version();
        wp_send_json_success(['presence' => self::presence_state()]);
    }

    public static function ajax_typing() {
        check_ajax_referer('dc_nonce', 'nonce');
        $u = self::require_user();
        self::set_typing(self::context_from_request(), (int) $u['id'], empty($_POST['stop']));
        self::bump_version();
        wp_send_json_success();
    }

    /* ==================== data ==================== */

    private static function context_from_request() {
        $ctx = isset($_POST['context']) ? sanitize_text_field(wp_unslash($_POST['context'])) : 'general';
        return substr($ctx, 0, 191);
    }

    private static function all_payload() {
        global $wpdb;
        $rows = $wpdb->get_results("SELECT * FROM " . self::$table . " ORDER BY created_at ASC", ARRAY_A);
        foreach ($rows as &$r) {
            $r['likes'] = array_map('intval', $r['likes'] ? (json_decode($r['likes'], true) ?: []) : []);
            $r['checks'] = array_map('intval', !empty($r['checks']) ? (json_decode($r['checks'], true) ?: []) : []);
            $r['downs']  = array_map('intval', !empty($r['downs'])  ? (json_decode($r['downs'], true)  ?: []) : []);
            $r['dones']  = array_map('intval', !empty($r['dones'])  ? (json_decode($r['dones'], true)  ?: []) : []);
            $r['react_log'] = !empty($r['react_log']) ? (json_decode($r['react_log'], true) ?: []) : [];
            $r['pinned'] = !empty($r['pinned']) ? 1 : 0;
            $r['task_id'] = isset($r['task_id']) ? preg_replace('/[^a-f0-9\-]/i', '', (string) $r['task_id']) : '';
            $r['user_id'] = (int) $r['user_id'];
            $r['content'] = esc_html($r['content']);
            $r['author'] = esc_html($r['author']);
            $r['context'] = esc_html($r['context']);
        }
        $users = [];
        $names = [];
        foreach ($wpdb->get_results("SELECT id, name, settings, sb_uid, tf_profile FROM " . self::$users, ARRAY_A) as $u) {
            /* Only what other people are meant to see. The full settings hold
               private things (the ntfy topic is the only lock on someone's
               notification feed), so they never leave the owner's own session. */
            $st = json_decode($u['settings'], true) ?: [];
            $tf = json_decode($u['tf_profile'] ?? '', true) ?: [];
            $pub = [];
            foreach (['namecolor', 'namecolor2'] as $k) if (!empty($st[$k])) $pub[$k] = $st[$k];
            $av = !empty($st['avatar']) ? $st['avatar'] : ($tf['avatar'] ?? '');
            if ($av) $pub['avatar'] = esc_url_raw($av);
            $users[(int) $u['id']] = [
                'name'     => esc_html($u['name']),
                'sb_uid'   => (string) ($u['sb_uid'] ?? ''),
                'color'    => $tf['color'] ?? '',
                'settings' => $pub ?: new stdClass(),
            ];
            $names[(int) $u['id']] = $u['name'];
        }
        return ['comments' => $rows, 'users' => $users, 'typing' => self::typing_state($names), 'presence' => self::presence_state()];
    }

    public static function ajax_all() {
        check_ajax_referer('dc_nonce', 'nonce');
        wp_send_json_success(self::all_payload());
    }

    /* long-poll: hold until something changes (~13.5s max), piggyback the data */
    public static function ajax_poll() {
        check_ajax_referer('dc_nonce', 'nonce');
        $client = sanitize_text_field(wp_unslash($_POST['v'] ?? ''));
        if (function_exists('set_time_limit')) @set_time_limit(30);
        if (function_exists('session_write_close')) @session_write_close();
        $v = self::raw_version();
        if ($client !== '' && $client === $v) {
            for ($i = 0; $i < 90; $i++) {
                usleep(150000);
                if (connection_aborted()) exit;
                $v = self::raw_version();
                if ($v !== $client) break;
            }
        }
        wp_send_json_success(['v' => $v, 'data' => ($client !== $v) ? self::all_payload() : null]);
    }

    /* ==================== mutations (account required) ==================== */

    public static function ajax_post() {
        check_ajax_referer('dc_nonce', 'nonce');
        global $wpdb;
        $u = self::require_user();
        $content = sanitize_textarea_field(wp_unslash($_POST['content'] ?? ''));
        $parent  = absint($_POST['parent_id'] ?? 0);
        if ($content === '') wp_send_json_error(['msg' => 'Comment is empty.']);
        $ctx = self::context_from_request();
        $wpdb->insert(self::$table, [
            'context'    => $ctx,
            'parent_id'  => $parent,
            'user_id'    => (int) $u['id'],
            'author'     => $u['name'],
            'content'    => substr($content, 0, 8000),
            'likes'      => '[]',
            'checks'     => '[]',
            'downs'      => '[]',
            'dones'      => '[]',
            'react_log'  => '[]',
            'created_at' => current_time('mysql'),
        ]);
        self::set_typing($ctx, (int) $u['id'], false);
        self::bump_version();
        $new_id = $wpdb->insert_id;
        self::push_new_comment($u, $ctx, $content, $parent, $new_id);
        wp_send_json_success(['id' => $new_id]);
    }

    /* Phone delivery. Browser popups are handled client-side while a tab is
       open; this is the path that still reaches someone with everything shut.
       Fire-and-forget so a slow endpoint never delays the request. */
    private static function notify($actor_id, $actor_name, $target, $ev, $title, $body, $link) {
        $uid = (int) $target['id'];
        if ($uid === (int) $actor_id) return;                       /* never self */
        $st = json_decode($target['settings'] ?? '{}', true) ?: [];
        $n  = $st['notif'] ?? null;
        if (!$n || empty($n['on']) || empty($n['topic'])) return;
        if (empty($n['events'][$ev]['p'])) return;                  /* phone off for this event */
        if (in_array((int) $actor_id, array_map('intval', (array) ($n['mute'] ?? [])), true)) return;
        $server = !empty($n['server']) ? rtrim($n['server'], '/') : 'https://ntfy.sh';
        wp_remote_post($server . '/' . rawurlencode($n['topic']), [
            'timeout'  => 2,
            'blocking' => false,
            'headers'  => ['Title' => self::header_safe($title), 'Click' => $link],
            'body'     => $body === '' ? $title : $body,
        ]);
    }

    private static function all_users() {
        global $wpdb;
        return $wpdb->get_results("SELECT id, name, settings FROM " . self::$users, ARRAY_A) ?: [];
    }

    private static function user_row($id) {
        global $wpdb;
        return $wpdb->get_row($wpdb->prepare(
            "SELECT id, name, settings FROM " . self::$users . " WHERE id = %d", (int) $id), ARRAY_A);
    }

    /* human-readable location + deep link for a comment */
    private static function ctx_label($ctx) { return $ctx === 'general' ? 'General' : $ctx; }
    private static function ctx_link($ctx, $id) {
        $l = $ctx === 'general' ? home_url('/') : home_url($ctx);
        return $l . '#dc-' . (int) $id;
    }

    /* the readable part of a comment: no pin/meta tokens, images as a marker */
    private static function preview($content) {
        $b = preg_replace('/\[(pin|meta)\][^\[]*\[\/\1\]/', '', $content);
        $b = trim(preg_replace('/\[img\][^\[]*\[\/img\]/', ' [image] ', $b));
        if ($b === '') $b = '[image]';
        return function_exists('mb_substr') ? mb_substr($b, 0, 400) : substr($b, 0, 400);
    }

    /* new comment: replies notify the parent's author, @names notify the person
       named, everyone else gets the plain comment event */
    private static function push_new_comment($author, $ctx, $content, $parent, $id) {
        global $wpdb;
        $users = self::all_users();
        if (!$users) return;
        $parent_owner = $parent
            ? (int) $wpdb->get_var($wpdb->prepare("SELECT user_id FROM " . self::$table . " WHERE id = %d", $parent))
            : 0;
        $body  = self::preview($content);
        $where = self::ctx_label($ctx);
        $link  = self::ctx_link($ctx, $id);
        $lower = function_exists('mb_strtolower') ? mb_strtolower($content) : strtolower($content);

        foreach ($users as $r) {
            $uid = (int) $r['id'];
            if ($uid === (int) $author['id']) continue;
            $mentioned = strpos($lower, '@' . (function_exists('mb_strtolower') ? mb_strtolower($r['name']) : strtolower($r['name']))) !== false;
            if ($parent && $parent_owner === $uid) {
                $ev = 'reply';    $title = $author['name'] . ' replied to you';
            } elseif ($mentioned) {
                $ev = 'mention';  $title = $author['name'] . ' mentioned you on ' . $where;
            } else {
                $ev = 'comment';  $title = $author['name'] . ' commented on ' . $where;
            }
            self::notify($author['id'], $author['name'], $r, $ev, $title, $body, $link);
        }
    }

    /* a reaction or a done/task action aimed at one comment's author */
    /* $phrase uses %s where the word comment/reply belongs, so a reaction on a
       reply reads "liked your reply" */
    private static function push_reaction($actor, $comment_id, $ev, $phrase) {
        global $wpdb;
        $row = $wpdb->get_row($wpdb->prepare(
            "SELECT user_id, context, content, parent_id FROM " . self::$table . " WHERE id = %d", (int) $comment_id), ARRAY_A);
        if (!$row) return;
        $target = self::user_row($row['user_id']);
        if (!$target) return;
        $noun = ((int) $row['parent_id'] !== 0) ? 'reply' : 'comment';
        self::notify($actor['id'], $actor['name'], $target, $ev,
            $actor['name'] . ' ' . sprintf($phrase, $noun),
            self::preview($row['content']),
            self::ctx_link($row['context'], $comment_id));
    }

    /* ntfy reads titles from a header, so keep them single-line */
    private static function header_safe($v) {
        $v = preg_replace('/[\r\n]+/', ' ', $v);
        return function_exists('mb_substr') ? mb_substr($v, 0, 120) : substr($v, 0, 120);
    }

    public static function ajax_like() {
        check_ajax_referer('dc_nonce', 'nonce');
        global $wpdb;
        $u = self::require_user();
        $id = absint($_POST['id'] ?? 0);
        if (!$id) wp_send_json_error(['msg' => 'Missing id.']);
        $likes = $wpdb->get_var($wpdb->prepare("SELECT likes FROM " . self::$table . " WHERE id = %d", $id));
        if ($likes === null) wp_send_json_error(['msg' => 'Not found.']);
        $likes = array_map('intval', $likes ? (json_decode($likes, true) ?: []) : []);
        $uid = (int) $u['id'];
        $i = array_search($uid, $likes, true);
        if ($i === false) { $likes[] = $uid; } else { unset($likes[$i]); $likes = array_values($likes); }
        $wpdb->update(self::$table, ['likes' => wp_json_encode($likes)], ['id' => $id]);
        self::log_react($id, $u['id'], 'like', $i === false);
        self::bump_version();
        if ($i === false) self::push_reaction($u, $id, 'like', 'liked your %s');
        wp_send_json_success(['likes' => $likes]);
    }

    /* remember when a reaction happened, so notifications can be ordered and
       dated by the reaction rather than by the comment */
    private static function log_react($id, $uid, $ev, $added) {
        global $wpdb;
        $raw = $wpdb->get_var($wpdb->prepare("SELECT react_log FROM " . self::$table . " WHERE id = %d", $id));
        $log = $raw ? (json_decode($raw, true) ?: []) : [];
        if ($added) {
            $log[] = ['u' => (int) $uid, 'e' => $ev, 't' => current_time('mysql')];
            if (count($log) > 40) $log = array_slice($log, -40);
        } else {
            /* undo: drop that person's most recent entry of this type */
            for ($i = count($log) - 1; $i >= 0; $i--) {
                if ((int) $log[$i]['u'] === (int) $uid && $log[$i]['e'] === $ev) {
                    array_splice($log, $i, 1);
                    break;
                }
            }
        }
        $wpdb->update(self::$table, ['react_log' => wp_json_encode(array_values($log))], ['id' => $id]);
    }

    /* toggle one user id inside a json array column (reactions) */
    private static function toggle_col($col, $ev = null) {
        check_ajax_referer('dc_nonce', 'nonce');
        global $wpdb;
        $u = self::require_user();
        $id = absint($_POST['id'] ?? 0);
        if (!$id) wp_send_json_error(['msg' => 'Missing id.']);
        $exists = $wpdb->get_var($wpdb->prepare("SELECT id FROM " . self::$table . " WHERE id = %d", $id));
        if ($exists === null) wp_send_json_error(['msg' => 'Not found.']);
        $cur = $wpdb->get_var($wpdb->prepare("SELECT `$col` FROM " . self::$table . " WHERE id = %d", $id));
        $cur = array_map('intval', $cur ? (json_decode($cur, true) ?: []) : []);
        $uid = (int) $u['id'];
        $i = array_search($uid, $cur, true);
        if ($i === false) { $cur[] = $uid; } else { unset($cur[$i]); $cur = array_values($cur); }
        $wpdb->update(self::$table, [$col => wp_json_encode($cur)], ['id' => $id]);
        if ($ev) self::log_react($id, $u['id'], $ev[0], $i === false);
        self::bump_version();
        if ($i === false && $ev) self::push_reaction($u, $id, $ev[0], $ev[1]);   /* only on add */
        wp_send_json_success([$col => $cur]);
    }
    public static function ajax_check() { self::toggle_col('checks', ['check', 'checked your %s']); }
    /* pin a comment out of the feed; moderators only, visible to everyone */
    public static function ajax_pin() {
        check_ajax_referer('dc_nonce', 'nonce');
        global $wpdb;
        $u = self::require_user();
        if (!self::is_mod($u)) wp_send_json_error(['msg' => 'Only moderators can pin comments.']);
        $id = absint($_POST['id'] ?? 0);
        if (!$id) wp_send_json_error(['msg' => 'Missing id.']);
        $cur = $wpdb->get_var($wpdb->prepare("SELECT pinned FROM " . self::$table . " WHERE id = %d", $id));
        if ($cur === null) wp_send_json_error(['msg' => 'Not found.']);
        $new = $cur ? 0 : 1;
        $wpdb->update(self::$table, ['pinned' => $new], ['id' => $id]);
        self::bump_version();
        wp_send_json_success(['pinned' => $new]);
    }
    /* notify-only: the task itself is created by TaskFlow, client-side */
    public static function ajax_tasked() {
        check_ajax_referer('dc_nonce', 'nonce');
        $u  = self::require_user();
        $id = absint($_POST['id'] ?? 0);
        if ($id) { self::log_react($id, $u['id'], 'task', true); self::push_reaction($u, $id, 'task', 'turned your %s into a task'); }
        wp_send_json_success();
    }
    /* remember which TaskFlow task a comment became, so the comment can show
       the task's live status and open it. Anyone signed in may link or unlink. */
    public static function ajax_tasklink() {
        check_ajax_referer('dc_nonce', 'nonce');
        global $wpdb;
        self::require_user();
        $ids  = array_filter(array_map('absint', explode(',', (string) ($_POST['ids'] ?? $_POST['id'] ?? ''))));
        $task = preg_replace('/[^a-f0-9\-]/i', '', (string) ($_POST['task_id'] ?? ''));
        if (!$ids) wp_send_json_error(['msg' => 'Missing id.']);
        foreach (array_slice($ids, 0, 50) as $id)
            $wpdb->update(self::$table, ['task_id' => substr($task, 0, 64)], ['id' => $id]);
        self::bump_version();
        wp_send_json_success();
    }
    public static function ajax_down()  { self::toggle_col('downs',  ['down', 'disagreed with your %s']); }
    /* done is shared state, not a reaction: anyone can set or clear it and the
       thread collapses for everyone */
    public static function ajax_done() {
        check_ajax_referer('dc_nonce', 'nonce');
        global $wpdb;
        $u = self::require_user();
        $id = absint($_POST['id'] ?? 0);
        if (!$id) wp_send_json_error(['msg' => 'Missing id.']);
        $exists = $wpdb->get_var($wpdb->prepare("SELECT id FROM " . self::$table . " WHERE id = %d", $id));
        if ($exists === null) wp_send_json_error(['msg' => 'Not found.']);
        $cur = $wpdb->get_var($wpdb->prepare("SELECT dones FROM " . self::$table . " WHERE id = %d", $id));
        $cur = array_map('intval', $cur ? (json_decode($cur, true) ?: []) : []);
        $was = (bool) $cur;
        $cur = $cur ? [] : [(int) $u['id']];   /* set = who marked it, clear = empty */
        $wpdb->update(self::$table, ['dones' => wp_json_encode($cur)], ['id' => $id]);
        self::log_react($id, $u['id'], 'done', !$was);
        self::bump_version();
        if (!$was) self::push_reaction($u, $id, 'done', 'marked your %s done');
        wp_send_json_success(['dones' => $cur]);
    }

    public static function ajax_edit() {
        check_ajax_referer('dc_nonce', 'nonce');
        global $wpdb;
        $u = self::require_user();
        $id      = absint($_POST['id'] ?? 0);
        $content = sanitize_textarea_field(wp_unslash($_POST['content'] ?? ''));
        if (!$id || $content === '') wp_send_json_error(['msg' => 'Missing data.']);
        $owner = $wpdb->get_var($wpdb->prepare("SELECT user_id FROM " . self::$table . " WHERE id = %d", $id));
        if ($owner === null) wp_send_json_error(['msg' => 'Not found.']);
        if ((int) $owner !== (int) $u['id'] && !self::is_mod($u))
            wp_send_json_error(['msg' => 'You can only edit your own comments.']);
        $wpdb->update(self::$table, ['content' => substr($content, 0, 8000)], ['id' => $id]);
        self::bump_version();
        wp_send_json_success();
    }

    public static function ajax_delete() {
        check_ajax_referer('dc_nonce', 'nonce');
        global $wpdb;
        $u = self::require_user();
        $id = absint($_POST['id'] ?? 0);
        if (!$id) wp_send_json_error(['msg' => 'Missing id.']);
        $owner = $wpdb->get_var($wpdb->prepare("SELECT user_id FROM " . self::$table . " WHERE id = %d", $id));
        if ($owner === null) wp_send_json_error(['msg' => 'Not found.']);
        if ((int) $owner !== (int) $u['id'] && !self::is_mod($u))
            wp_send_json_error(['msg' => 'You can only delete your own comments.']);
        $wpdb->delete(self::$table, ['id' => $id]);
        self::bump_version();
        wp_send_json_success();
    }

    public static function ajax_upload() {
        check_ajax_referer('dc_nonce', 'nonce');
        self::require_user();
        $types = ['image/png' => 'png', 'image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/gif' => 'gif'];
        $type  = sanitize_text_field(wp_unslash($_POST['type'] ?? ''));
        if (!isset($types[$type])) wp_send_json_error(['msg' => 'Unsupported image type.']);
        $raw = base64_decode($_POST['data'] ?? '', true);
        if ($raw === false || strlen($raw) > 6 * 1024 * 1024) wp_send_json_error(['msg' => 'Image too large (6MB max).']);
        $file = wp_upload_bits('dc-' . time() . '-' . wp_generate_password(6, false) . '.' . $types[$type], null, $raw);
        if (!empty($file['error'])) wp_send_json_error(['msg' => $file['error']]);
        wp_send_json_success(['url' => $file['url']]);
    }

    /* ==================== frontend ==================== */

    /* GIF search runs through the server so the API key is never in the page.
       Provider is KLIPY: Google decommissioned the Tenor API on 2026-06-30 and
       stopped issuing keys in January 2026, so Tenor is not an option. */
    public static function ajax_gif() {
        check_ajax_referer('dc_nonce', 'nonce');
        $u   = self::require_user();
        $key = trim((string) get_option('dc_klipy_key', ''));
        if ($key === '') wp_send_json_error(['msg' => 'No GIF key configured.']);

        $q    = sanitize_text_field(wp_unslash($_POST['q'] ?? ''));
        $path = $q === '' ? 'trending' : 'search';
        $url  = add_query_arg(array_filter([
            'q'           => $q,
            'per_page'    => 24,
            'page'        => 1,
            'customer_id' => 'dc' . (int) $u['id'],
            'content_filter' => 'medium',
        ]), 'https://api.klipy.com/api/v1/' . rawurlencode($key) . '/gifs/' . $path);

        $res = wp_remote_get($url, ['timeout' => 8]);
        if (is_wp_error($res)) wp_send_json_error(['msg' => $res->get_error_message()]);
        $code = wp_remote_retrieve_response_code($res);
        $body = json_decode(wp_remote_retrieve_body($res), true);
        if ($code < 200 || $code > 299 || !is_array($body))
            wp_send_json_error(['msg' => 'GIF search failed (HTTP ' . $code . ').']);

        $out = self::collect_gifs($body);
        if (!$out) wp_send_json_error(['msg' => 'No GIFs in the response.']);
        wp_send_json_success(array_slice($out, 0, 24));
    }

    /* Finds each result item in the response, then the GIF sizes inside it.
       Written against the shape rather than a fixed path, so a provider tweak
       doesn't break the picker. */
    private static function collect_gifs($node, &$out = null, $depth = 0) {
        if ($out === null) $out = [];
        if (!is_array($node) || $depth > 8 || count($out) >= 60) return $out;

        if (self::is_gif_item($node)) {
            $sizes = [];
            self::gif_sizes($node, $sizes, 0);
            if ($sizes) {
                usort($sizes, function ($x, $y) { return $y['w'] <=> $x['w']; });
                $out[] = [
                    'url'     => esc_url_raw($sizes[0]['u']),                  // largest
                    'preview' => esc_url_raw(end($sizes)['u']),                // smallest
                    'alt'     => esc_html((string) ($node['title'] ?? $node['slug'] ?? 'GIF')),
                ];
                return $out;   // don't descend into an item we've already taken
            }
        }
        foreach ($node as $child) if (is_array($child)) self::collect_gifs($child, $out, $depth + 1);
        return $out;
    }

    /* A result item: identifiable, and holding at least one .gif url nearby. */
    private static function is_gif_item($node) {
        $named = isset($node['title']) || isset($node['slug']) || isset($node['file'])
              || isset($node['id'])    || isset($node['blank_gif']);
        if (!$named) return false;
        $sizes = [];
        self::gif_sizes($node, $sizes, 0);
        return !empty($sizes);
    }

    /* Every .gif url under a node, with its declared width when there is one. */
    private static function gif_sizes($node, &$sizes, $depth) {
        if ($depth > 4 || !is_array($node)) return;
        foreach ($node as $k => $v) {
            if (is_string($v) && preg_match('#^https?://[^\s]+\.gif(\?|$)#i', $v)) {
                $sizes[] = ['u' => $v, 'w' => isset($node['width']) ? (int) $node['width'] : 0];
            } elseif (is_array($v)) {
                self::gif_sizes($v, $sizes, $depth + 1);
            }
        }
    }

    const TASKFLOW_DEFAULT = 'https://palmer-taskflow.vercel.app/dashboard';

    public static function taskflow_url() {
        $u = get_option('dc_taskflow_url', self::TASKFLOW_DEFAULT);
        return $u === '' ? '' : esc_url_raw($u);
    }

    /* the TaskFlow app's root, for "open in TaskFlow" links (/tasks/<id> etc.) */
    public static function taskflow_app() {
        $u = self::taskflow_url() ?: self::TASKFLOW_DEFAULT;
        $p = wp_parse_url($u);
        return empty($p['host']) ? '' : ($p['scheme'] ?? 'https') . '://' . $p['host'] . (isset($p['port']) ? ':' . $p['port'] : '');
    }

    /* wp-admin is only reachable by people already signed into WordPress */
    public static function maybe_render_admin() {
        if (!is_user_logged_in()) return;
        self::render();
    }

    public static function render() {
        $nonce = wp_create_nonce('dc_nonce');
        $taskflow = self::taskflow_url();
        $has_gifs = get_option('dc_klipy_key', '') !== '';
        $ajax  = admin_url('admin-ajax.php');
        if (is_admin()) {
            /* group by screen (Posts, Plugins, a specific editor) instead of the
               full query string, so comments land somewhere findable */
            $screen = function_exists('get_current_screen') ? get_current_screen() : null;
            $id     = $screen ? $screen->id : 'admin';
            $post   = isset($_GET['post']) ? '-' . absint($_GET['post']) : '';
            $path   = esc_js('/wp-admin:' . sanitize_key($id) . $post);
        } else {
            $path = esc_js(wp_parse_url(add_query_arg([]), PHP_URL_PATH) ?: '/');
        }
        ?>
<div id="dc-root"></div>
<script>
(function(){
  const AJAX='<?php echo esc_js($ajax); ?>', NONCE='<?php echo esc_js($nonce); ?>', PAGE='<?php echo $path; ?>';
  const TASKFLOW='<?php echo esc_js($taskflow); ?>';
  const HAS_GIFS=<?php echo $has_gifs ? 'true' : 'false'; ?>;
  /* TaskFlow (Supabase). The anon key is public by design: every table is
     guarded by row-level security, so it only ever acts as the signed-in person. */
  const SB_URL=<?php echo wp_json_encode(self::sb_url()); ?>, SB_ANON=<?php echo wp_json_encode(self::sb_anon()); ?>;
  const TF_APP=<?php echo wp_json_encode(self::taskflow_app()); ?>;
  const TEAM_LOCK=<?php echo wp_json_encode(self::team_lock()); ?>;
  const TF_READY=!!(SB_URL&&SB_ANON);
  const ORIGIN=location.origin;

  /* Inter for the panel; fonts registered on the document reach shadow DOM */
  if(!document.getElementById('dc-font')){
    ['https://fonts.googleapis.com','https://fonts.gstatic.com'].forEach(h=>{
      const p=document.createElement('link');p.rel='preconnect';p.href=h;
      if(h.includes('gstatic'))p.crossOrigin='';document.head.appendChild(p);
    });
    const l=document.createElement('link');
    l.id='dc-font';l.rel='stylesheet';
    l.href='https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=block';
    document.head.appendChild(l);
  }

  /* ---- Shadow DOM: fully isolated from theme CSS ---- */
  const host=document.getElementById('dc-root');
  if(document.body.classList.contains('wp-admin'))host.dataset.admin='1';
  host.style.cssText='all:initial;position:fixed;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;';
  /* Top layer via Popover API: escapes transformed ancestors and admin-bar offsets */
  try{host.setAttribute('popover','manual');host.showPopover();}
  catch(e){document.documentElement.appendChild(host);}
  const root=host.attachShadow({mode:'open'});

  root.innerHTML=`
<style>
:host{all:initial;
  /* ============ Midnight (default) ============ */
  --font:'Inter',ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  --font-head:var(--font);
  --acc-h:207;--acc-s:46%;               /* hue/sat of the accent, set from JS */
  --bg:#141416;
  --text:#dadada;--text-strong:#f2f2f2;--text-soft:#b8b8b8;
  --dim:#878787;--faint:#6b6b6b;--fainter:#5e5e5e;--hint:#4c4c4c;
  --line:rgba(180,180,180,.13);--line-soft:rgba(180,180,180,.07);--line-strong:rgba(180,180,180,.2);
  --surface:rgba(180,180,180,.05);--surface2:rgba(180,180,180,.1);
  --compose-bg:rgba(180,180,180,.035);
  --tab-active:#252527;--tab-active-text:#f2f2f2;--tab-active-bar:inset 0 1px 0 var(--top-glint);
  --acc1:#7fb0d4;--acc2:#7fb0d4;--acc-grad:var(--acc1);
  --acc-text:#101012;--acc-soft:#9cc4e2;--glow:127,176,212;
  --heart:#c2483f;--live:#7fb0d4;--ok:#5fb573;
  --menu-bg:rgba(24,24,26,.96);--toggle-bg:rgba(20,20,22,.88);--toggle-hover:rgba(32,32,34,.94);
  --r-lg:5px;--r-md:4px;--r-sm:3px;--r-ava:4px;
  --case:none;--track:normal;--track-tab:normal;
  --panel-shadow:-28px 0 70px rgba(0,0,0,.66),-1px 0 0 rgba(180,180,180,.2);
  /* motion tokens.
     drawer: the iOS sheet curve (Ionic, used by Vaul) at iOS's 500ms; exits
       run ~20% faster on the same curve so open/close read as one gesture.
     out: entrances/popovers (fast start = instant response, soft landing).
     io: things already on screen moving to a new spot.
     pop: small feedback only (counts, toggles); never on enter/exit. */
  --ease-drawer:cubic-bezier(.32,.72,0,1);
  --slide-in:.5s var(--ease-drawer);
  --slide-out:.4s var(--ease-drawer);
  --ease-out:cubic-bezier(.23,1,.32,1);
  --ease-io:cubic-bezier(.65,0,.35,1);
  --ease-pop:var(--ease-out);
  --top-glint:rgba(180,180,180,.2);
  --texture-alpha:.035;                  /* strength of the faint background lines */
  --head-weight:650;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0;font-family:var(--font);text-transform:none;letter-spacing:normal}
:where(button){appearance:none;background:none;border:0;color:inherit;font:inherit;cursor:pointer}
/* keyboard focus is always visible; mouse focus stays quiet */
:where(button,a,[tabindex]):focus-visible{outline:2px solid rgba(var(--glow),.65);outline-offset:2px;border-radius:var(--r-sm)}
/* press: every button gives back a small, instant squeeze (the separate
   scale property never fights a button's own transform) */
:where(button):not(:disabled):active{scale:.97}
.toggle:active{scale:.96}
/* touch screens fire :hover on tap; keep hover lifts to real pointers */
@media (hover:none){
  .presence .pav:hover,.tabpin:hover,.mebtn:hover,.pinlayer .pdot:hover{transform:none}
  .pgrow:hover .pg-go{transform:none}
}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
:where(input,textarea){appearance:none;font:inherit;color:inherit;background:none;border:0;outline:none}

/* ---------- toggle ---------- */
.toggle{pointer-events:auto;position:absolute;top:50%;right:0;transform:translateY(-50%);z-index:1;
  width:44px;height:44px;padding:0;box-sizing:border-box;line-height:0;
  display:grid;place-items:center;place-content:center;
  background:var(--toggle-bg);
  color:var(--text);border:1px solid var(--line-strong);border-right:0;
  border-radius:var(--r-lg) 0 0 var(--r-lg);
  box-shadow:-12px 0 34px rgba(0,0,0,.3),inset 0 1px 0 var(--top-glint);
  transition:background-color .15s ease}
.toggle:hover{background:var(--toggle-hover)}
/* load-in: the tab slides out from its edge, then its icon settles. Uses the
   individual translate/scale properties so the position transforms
   (translateY(-50%), pos-top/bottom) are never touched. */
@keyframes dcEdgeInR{from{translate:calc(100% + 18px) 0;opacity:0}}
@keyframes dcEdgeInL{from{translate:calc(-100% - 18px) 0;opacity:0}}
@keyframes dcIconIn{from{opacity:0;scale:.8}}
.toggle{animation:dcEdgeInR .5s var(--ease-drawer) .12s backwards}
.toggle.left{animation-name:dcEdgeInL}
.toggle>svg{animation:dcIconIn .3s var(--ease-out) .36s backwards}
/* docking: while the panel (and/or the pins list) is open, the whole edge
   column rides its outer edge at the same height. --dock is that width, set
   in JS; translate keeps the position transforms untouched and moves in step
   with the panel's own .3s slide. */

.toggle .tg-shut{opacity:0;scale:.8;filter:blur(2px);transition:opacity .2s ease,scale .25s var(--ease-out),filter .2s ease,stroke .15s ease}
.toggle .tg-chat{transition:opacity .2s ease,scale .25s var(--ease-out),filter .2s ease,stroke .15s ease}
.toggle.docked .tg-chat{opacity:0;scale:.8;filter:blur(2px)}
.toggle.docked .tg-shut{opacity:1;scale:1;filter:none}
.toggle.left .tg-shut{rotate:180deg}
.toggle svg{display:block;width:17px;height:17px;stroke:var(--dim);
  stroke-width:2;grid-area:1/1;margin:0;transition:stroke .15s ease}
.toggle:hover svg{stroke:var(--text)}
.toggle .badge{display:none!important}
.toggle .badge--legacy{position:absolute;top:-6px;left:-6px;grid-area:1/1;
  min-width:18px;height:18px;border-radius:9px;
  background:var(--acc-grad);color:var(--acc-text);
  font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;
  box-shadow:0 2px 10px rgba(var(--glow),.45);
  transition:transform .3s var(--ease-pop),opacity .2s ease;
  transform:scale(1)}
.toggle .badge.zero{transform:scale(0);opacity:0}
@keyframes dcBump{50%{transform:scale(1.35)}}
.badge.bump,.tabdot.bump{animation:dcBump .3s ease}

/* panel on the left: mirror the chrome that is anchored to an edge */
.panel.left{left:auto;right:100%;border-left:0;border-right:1px solid var(--line);
  box-shadow:none}

.toggle.left{right:auto;left:0;border-radius:0 var(--r-lg) var(--r-lg) 0;
  border-right:1px solid var(--line-strong);border-left:0;
  box-shadow:12px 0 34px rgba(0,0,0,.3),inset 0 1px 0 var(--top-glint)}
.panel.left .resizer{left:auto;right:-6px}
.panel.left .pagemenu{left:0;right:0}

/* tab vertical position */
.toggle.pos-top{top:96px;transform:none}
.toggle.pos-bottom{top:auto;bottom:24px;transform:none}

/* closed-tab size */
.toggle.sz-s{width:34px;height:34px}
.toggle.sz-s svg{width:14px;height:14px}
.toggle.sz-s .badge{min-width:15px;height:15px;font-size:9.5px;top:-5px;left:-5px}
.toggle.sz-l{width:56px;height:56px}
.toggle.sz-l svg{width:23px;height:23px}
.toggle.sz-l .badge{min-width:22px;height:22px;border-radius:11px;font-size:12.5px;top:-8px;left:-8px}
.toggle.left .badge{left:auto;right:-6px}
.toggle.left.sz-s .badge{right:-5px}
.toggle.left.sz-l .badge{right:-8px}
/* pinned badge on the closed tab: top-left, mirrored when the tab is on the left */
.toggle .tglpin{top:-7px;left:-7px;right:auto}
.toggle.left .tglpin{left:auto;right:-7px}
.toggle .tglpin svg,.toggle:hover .tglpin svg{width:10px;height:10px;stroke:currentColor;stroke-width:2.4}
/* the closed-tab pinned popup, docked beside the tab */
.pinpop.pinfloat{position:absolute;top:0;left:auto;right:auto;width:380px;max-width:calc(100vw - 80px);
  z-index:2;font-family:var(--font);transform:translateX(8px)}
.pinpop.pinfloat.left{transform:translateX(-8px)}
.pinpop.pinfloat.show{transform:none}
/* presence: a rail docked to the same edge as the tab, built from the same
   surface, border and shadow, so tab, pins and people read as one column.
   Closed it sits above the tab; open it docks to the panel's edge, level with
   the composer. Sizes follow the tab size setting. */
.presence{position:absolute;left:0;top:0;z-index:4;--pa:28px;
  display:flex;flex-direction:column;align-items:center;gap:6px;padding:8px 0;box-sizing:border-box;
  background:var(--toggle-bg);border:1px solid var(--line-strong);border-right:0;
  border-radius:var(--r-lg) 0 0 var(--r-lg);
  box-shadow:-12px 0 34px rgba(0,0,0,.3),inset 0 1px 0 var(--top-glint);
  font-family:var(--font);
  transition:transform .3s var(--ease-io),opacity .2s ease;
  animation:dcEdgeInR .5s var(--ease-drawer) .04s backwards}   /* leads the tab out */
.presence.left{animation-name:dcEdgeInL}
.presence.left{border-right:1px solid var(--line-strong);border-left:0;border-radius:0 var(--r-lg) var(--r-lg) 0;
  box-shadow:12px 0 34px rgba(0,0,0,.3),inset 0 1px 0 var(--top-glint)}
.presence.empty{opacity:0;pointer-events:none}
.presence.docked{box-shadow:-8px 0 24px rgba(0,0,0,.28),inset 0 1px 0 var(--top-glint)}
.presence.left.docked{box-shadow:8px 0 24px rgba(0,0,0,.28),inset 0 1px 0 var(--top-glint)}
.presence .pav{position:relative;flex:none;width:var(--pa);height:var(--pa);border-radius:var(--r-ava);
  display:flex;align-items:center;justify-content:center;font-size:calc(var(--pa) * .42);font-weight:650;color:#101012;
  box-shadow:inset 0 0 0 1px rgba(255,255,255,.08);cursor:default;
  animation:dcPavIn .42s var(--ease-out) backwards;
  transition:transform .2s var(--ease-out)}
.presence .pav:hover{transform:scale(1.07)}
.presence .pav.out{animation:dcPavOut .22s ease forwards}
@keyframes dcPavIn{from{opacity:0;transform:scale(.85)}}
@keyframes dcPavOut{to{opacity:0;transform:scale(.85)}}
/* you: a thin accent ring, set off from the photo */
.presence .pav.me{outline:1.5px solid rgba(var(--glow),.75);outline-offset:2px}
.presence .pav i{position:absolute;right:-2px;bottom:-2px;width:8px;height:8px;border-radius:50%;
  background:#3ecf8e;box-shadow:0 0 0 2px var(--toggle-bg);animation:dcLive 2.4s ease-out infinite}
.presence .pav.me i{display:none}
@keyframes dcLive{0%{box-shadow:0 0 0 2px var(--toggle-bg),0 0 0 2px rgba(62,207,142,.5)}
  70%,100%{box-shadow:0 0 0 2px var(--toggle-bg),0 0 0 7px rgba(62,207,142,0)}}
/* name label: comes out of the rail, same surface as the pin tooltip */
.presence .pav::after{content:attr(data-name);position:absolute;right:calc(100% + 16px);top:50%;
  transform:translate(4px,-50%);white-space:nowrap;padding:5px 9px;border-radius:var(--r-sm);
  font-size:11.5px;font-weight:600;color:var(--text-strong);background:var(--menu-bg);
  border:1px solid var(--line-strong);box-shadow:0 8px 22px rgba(0,0,0,.4);
  opacity:0;pointer-events:none;transition:opacity .15s ease,transform .15s ease}
.presence .pav:hover::after{opacity:1;transform:translate(0,-50%)}
.presence.left .pav::after{right:auto;left:calc(100% + 16px);transform:translate(-4px,-50%)}
.presence.left .pav:hover::after{transform:translate(0,-50%)}
.presence .pmore{flex:none;width:var(--pa);height:18px;border-radius:9px;
  display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;
  color:var(--text-soft);background:var(--surface2)}
@media (prefers-reduced-motion:reduce){.presence,.presence .pav,.presence .pav i{animation:none;transition:none}}
.pinpop .pp-sec{padding:14px 18px 2px;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}

/* ---------- overlay + panel ---------- */
.overlay{position:absolute;inset:0;background:rgba(8,8,8,.42);opacity:0;pointer-events:none;
  transition:opacity var(--slide-out);z-index:2}
.overlay.show{opacity:1;pointer-events:auto;transition:opacity var(--slide-in)}

/* ---- the rig: full-size, click-through layers that carry everything that
   slides. Only these two ever animate, on the compositor. ---- */
.rig,.rigb{position:absolute;inset:0;pointer-events:none;will-change:transform;backface-visibility:hidden}
.rig{z-index:3;transform:translate3d(calc(-1 * var(--rx,0px)),0,0);transition:transform var(--slide-out)}
.rig.open{transition:transform var(--slide-in)}
.rig.left{transform:translate3d(var(--rx,0px),0,0)}
.rigb{transform:translate3d(calc(-1 * var(--rm,0px)),0,0);transition:transform var(--slide-out)}
.rigb.mopen{transition:transform var(--slide-in)}
.rig.left .rigb{transform:translate3d(var(--rm,0px),0,0)}
.rig.dockfast,.rig.dockfast .rigb{transition:none!important}   /* width drag: 1:1 */
.rig.kb,.rig.kb .rigb,.rig.kb .pshadow,.overlay.kb{transition-duration:.22s!important}
/* parked just past the edge; the rig brings it in */
.panel{pointer-events:auto;position:absolute;top:0;bottom:0;left:100%;right:auto;height:auto;
  width:calc(30% + var(--sbw,0px));min-width:320px;max-width:94%;z-index:3;
  padding-right:var(--sbw,0px);box-sizing:border-box;
  background:var(--bg);
  color:var(--text);border-left:1px solid var(--line);

  display:flex;flex-direction:column;font-size:14px;line-height:1.5;
  box-shadow:none}
/* the shadow fades on its own layer (opacity is compositor-cheap) instead of
   poking out past the screen edge while closed */
.panel>.pshadow{position:absolute;inset:0;pointer-events:none;box-shadow:var(--panel-shadow);
  opacity:0;transition:opacity var(--slide-out)}
.panel.open>.pshadow{opacity:1;transition:opacity var(--slide-in)}
.panel.left>.pshadow{box-shadow:28px 0 70px rgba(0,0,0,.66),1px 0 0 rgba(180,180,180,.2)}
.panel::before{content:'';position:absolute;top:0;left:0;right:0;height:1px;z-index:5;
  background:linear-gradient(90deg,transparent,var(--top-glint),transparent)}
/* faint vertical lines, tinted by the accent: the gradient lives here (not in a
   :host variable) so var(--glow) resolves against the panel's live accent */
.panel::after{content:'';position:absolute;inset:0;pointer-events:none;z-index:4;
  background:repeating-linear-gradient(90deg,rgba(var(--glow),var(--texture-alpha)) 0 1px,transparent 1px 72px)}

.panel.resizing{transition:none!important;user-select:none;will-change:width;contain:layout paint}
.panel.resizing .list{contain:layout paint style}
.panel.resizing .list,.panel.resizing .compose,.panel.resizing .spage{pointer-events:none}
/* invisible grab strip: only the ew-resize cursor signals it */
.resizer{position:absolute;top:0;left:-6px;width:13px;height:100%;z-index:30;cursor:ew-resize;
  touch-action:none}
/* while dragging it grows to cover the screen so the cursor can never leave it
   and stop delivering move events */
.resizer.dragging{position:fixed;inset:0;left:0;top:0;width:auto;height:auto;z-index:2147483647}
.resizer:focus-visible{outline:2px solid var(--acc1);outline-offset:-2px}

/* UI scale: zoom every region of the panel so type, controls, avatars and
   spacing grow together. The panel box itself is left alone — the resize
   handle measures against it and zoom would skew that maths. */
.head,.tabs,.list,.typing,.compose,.auth,.spage,.lockmsg{zoom:var(--ui-scale,1)}

/* ---------- header ---------- */
.head{display:flex;align-items:center;justify-content:space-between;padding:20px 22px 4px}
.head .sub{font-size:13px;font-weight:600;color:var(--text-strong);
  font-variant-numeric:tabular-nums;letter-spacing:.01em}
.hbtns{display:flex;align-items:center;gap:4px}
.close,.logout,.gear,.srch,.pinsbtn,.bellbtn{width:30px;height:30px;border-radius:var(--r-sm);color:var(--dim);display:flex;align-items:center;justify-content:center;transition:color .15s ease,background-color .15s ease}
.close:hover,.logout:hover,.gear:hover,.srch:hover,.pinsbtn:hover,.bellbtn:hover{background:var(--surface2);color:var(--text)}
/* thumbtack = a comment pinned out of the feed (distinct from element pins).
   A small badge on its tab; clicking it opens the pinned popup. */
/* sits above the list, so the tab popups paint over the feed */
.tabs{z-index:6}
/* one active surface that slides between tabs instead of each tab flashing its own */
.tabs .glide{position:absolute;left:0;top:3px;bottom:3px;width:0;z-index:0;pointer-events:none;
  border-radius:var(--r-md);background:var(--tab-active);
  box-shadow:0 1px 4px rgba(0,0,0,.25),var(--tab-active-bar,inset 0 1px 0 var(--top-glint));
  opacity:0;transition:transform .3s var(--ease-io),width .3s var(--ease-io),opacity .2s ease}
.tabs.glided .glide{opacity:1}
.tabs.glided .tab.active{background:transparent;box-shadow:none}
.tabs .glide.noanim{transition:none}
.tabs .tab{z-index:1}
/* segmented tabs never squeeze on press: the tab and its sliding highlight are
   separate boxes, so shrinking the tab pulled it away from the highlight and
   opened a gap. The press reads on the highlight instead, which shrinks as one
   piece, and the label dims a touch. */
.tabs .tab:active,.pgs:active,.snavb:active,.nfsubb:active,.tfseg button:active{scale:none;transform:none}
.tabs .tab:active,.pgs:active,.snavb:active,.nfsubb:active,.tfseg button:active{opacity:.78}
.tabs .glide{transition:transform .3s var(--ease-io),width .3s var(--ease-io),opacity .2s ease,scale .16s var(--ease-out)}
.tabs:has(.tab.active:active) .glide{scale:.96}
.pgsort:has(.pgs.sel:active) .pgs-glide{scale:.96}
.pgs-glide{transition:transform .26s var(--ease-io),width .26s var(--ease-io),scale .16s var(--ease-out)}
.tabs .tab{transition:color .2s ease,background-color .15s ease,opacity .12s ease}
/* badges arrive with a little spring */
.tabpin.show{animation:dcBadgeIn .3s var(--ease-out) backwards}
@keyframes dcBadgeIn{from{opacity:0;transform:scale(.7)}}
.tabpin{position:absolute;top:-7px;right:-7px;width:20px;height:20px;border-radius:50%;
  display:none;align-items:center;justify-content:center;cursor:pointer;
  background:var(--acc-grad);color:var(--acc-text);border:2px solid var(--bg);
  box-shadow:0 2px 6px rgba(0,0,0,.35);
  transition:transform .18s var(--ease-out),box-shadow .18s ease}
.tabpin.show{display:flex}
.tabpin:hover{transform:scale(1.1)}
.tabpin.on{box-shadow:0 0 0 3px rgba(var(--glow),.35),0 2px 6px rgba(0,0,0,.35)}
.tabpin svg{width:10px;height:10px;stroke:currentColor;fill:none;stroke-width:2.4;display:block}
.pinpop{position:absolute;top:calc(100% + 8px);right:0;left:0;z-index:11;
  background:linear-gradient(var(--menu-bg),var(--menu-bg)),var(--bg);border:1px solid var(--line-strong);border-radius:var(--r-lg);
  box-shadow:0 20px 50px rgba(0,0,0,.35),inset 0 1px 0 var(--top-glint);
  opacity:0;transform:translateY(-6px);pointer-events:none;
  transition:opacity .18s ease,transform .18s cubic-bezier(.32,.72,.22,1)}
.pinpop.show{opacity:1;transform:none;pointer-events:auto}
.tabs .pinpop{transform:translateY(-4px) scale(.97);transform-origin:var(--po,50%) top;
  transition:opacity .16s ease,transform .22s var(--ease-out)}
.tabs .pinpop.show{transform:none}
.pinpop .pp-item{animation:dcPgIn .34s cubic-bezier(.32,.72,.22,1) backwards}
.pinpop .pp-item:nth-child(2){animation-delay:.04s}.pinpop .pp-item:nth-child(3){animation-delay:.08s}
.pinpop .pp-item:nth-child(n+4){animation-delay:.12s}
.pinpop .pp-head{display:flex;align-items:center;gap:8px;padding:12px 12px 12px 18px;
  border-bottom:1px solid var(--line-soft);font-size:11px;letter-spacing:.04em;
  text-transform:uppercase;color:var(--faint)}
.pinpop .pp-head span{flex:1}
.pinpop .pp-x{width:26px;height:26px;border-radius:var(--r-sm);color:var(--dim);
  display:flex;align-items:center;justify-content:center}
.pinpop .pp-x:hover{background:var(--surface2);color:var(--text)}
.pinpop .pp-scroll{max-height:min(52vh,420px);overflow-y:auto;overscroll-behavior:contain;padding:0;
  scrollbar-width:thin;scrollbar-color:var(--line-strong) transparent}
.pinpop .pp-item{padding:16px 18px 18px}
.pinpop .pp-item+.pp-item{border-top:1px solid var(--line-soft)}
.pinpop .pp-row{display:flex;gap:12px;align-items:flex-start}
.pinpop .pp-reply{margin-top:14px;padding-left:44px}
.pinpop .avatar{width:32px;height:32px}
.pinpop .pp-reply .avatar{width:24px;height:24px;font-size:10.5px;border-radius:8px}
.pinpop .pp-body{flex:1;min-width:0}
.pinpop .meta{align-items:center;min-height:20px;margin-bottom:6px}
.pinpop .pp-reply .meta{min-height:0;margin-bottom:4px}
.pinpop .pp-sp{flex:1}
.pinpop .pp-unpin{font-size:11px;font-weight:550;color:var(--dim);padding:3px 9px;margin:-3px -6px -3px 0;
  border:1px solid var(--line);border-radius:999px;transition:background .15s,color .15s,border-color .15s}
.pinpop .pp-unpin:hover{background:var(--surface2);color:var(--text)}
.pinpop .content{font-size:13px;line-height:1.6;color:var(--text)}
.pinpop .content img{max-width:100%;border-radius:var(--r-sm)}
.item.pinned-c{position:relative}
.item.pinned-c .pintag{display:inline-flex;align-items:center;gap:5px;margin-bottom:4px;
  font-size:10px;font-weight:650;letter-spacing:.04em;text-transform:uppercase;color:var(--acc-soft)}
.item.pinned-c .pintag svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2}
.bellbtn.on{color:var(--acc-soft);background:var(--surface2)}
.bellbtn.off svg{opacity:.55}
.pinsbtn.on{color:var(--acc-soft);background:var(--surface2)}
.logout,.gear,.bellbtn{display:none}
.hbtns .hid,.hbtns .hid.show{display:none!important}   /* reached through the account menu */
/* account button + menu: the header keeps search, pins, you, close */
.head{position:relative}
.mebtn{display:none;width:28px;height:28px;margin:0 3px;border-radius:var(--r-ava);font-size:11.5px;font-weight:700;
  color:#101012;border:1.5px solid var(--line-strong);background-size:cover;background-position:center;
  transition:transform .18s var(--ease-out),box-shadow .18s ease,border-color .18s ease}
.mebtn.show{display:flex;align-items:center;justify-content:center}
.mebtn:hover{transform:scale(1.06);border-color:rgba(var(--glow),.55)}
.mebtn.openm{box-shadow:0 0 0 3px rgba(var(--glow),.28);border-color:rgba(var(--glow),.7)}
.memenu{position:absolute;top:58px;right:18px;z-index:12;width:236px;padding:6px;
  background:linear-gradient(var(--menu-bg),var(--menu-bg)),var(--bg);
  border:1px solid var(--line-strong);border-radius:var(--r-lg);
  box-shadow:0 22px 54px rgba(0,0,0,.45),inset 0 1px 0 var(--top-glint);
  opacity:0;transform:translateY(-6px) scale(.97);transform-origin:top right;pointer-events:none;
  transition:opacity .16s ease,transform .22s cubic-bezier(.32,.72,.22,1)}
.memenu.show{opacity:1;transform:none;pointer-events:auto}
.memenu .mm-who{display:flex;align-items:center;gap:10px;padding:8px 10px 10px;margin-bottom:4px;border-bottom:1px solid var(--line-soft)}
.memenu .mm-ava{width:32px;height:32px;flex:none;border-radius:var(--r-ava);display:flex;align-items:center;justify-content:center;
  font-size:12.5px;font-weight:700;color:#101012;background-size:cover;background-position:center}
.memenu .mm-id{display:flex;flex-direction:column;min-width:0}
.memenu .mm-name{font-size:13px;color:var(--text-strong);font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.memenu .mm-role{font-size:11px;color:var(--faint)}
.memenu .mm-item{width:100%;display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:var(--r-sm);
  font-size:12.5px;color:var(--text-soft);text-align:left;transition:background .12s ease,color .12s ease}
.memenu .mm-item span{flex:1}
.memenu .mm-item svg{width:15px;height:15px;flex:none;stroke:currentColor;fill:none;stroke-width:2;opacity:.8}
.memenu .mm-item:hover,.memenu .mm-item:focus-visible{background:var(--surface2);color:var(--text-strong);outline:none}
.memenu .mm-item.danger:hover{color:#ff8a80}
.memenu .mm-state{font-style:normal;font-size:10.5px;font-weight:650;padding:2px 7px;border-radius:9px;
  color:var(--faint);background:var(--surface2)}
.memenu .mm-state.on{color:var(--acc-text);background:var(--acc1)}
.memenu .mm-sep{height:1px;background:var(--line-soft);margin:4px 6px}
.memenu .mm-item{opacity:0;transform:translateY(-3px);transition:background .12s ease,color .12s ease,opacity .2s ease,transform .25s cubic-bezier(.32,.72,.22,1)}
.memenu.show .mm-item{opacity:1;transform:none}
.memenu.show .mm-item:nth-of-type(2){transition-delay:0s,0s,.03s,.03s}
.memenu.show .mm-item:nth-of-type(3){transition-delay:0s,0s,.06s,.06s}
.logout.show,.gear.show,.bellbtn.show{display:flex}
.gear.openm{background:var(--surface2);color:var(--text)}

/* ---------- tabs ---------- */
.tabs{display:flex;background:var(--surface);border:1px solid var(--line);
  border-radius:calc(var(--r-md) + 2px);padding:3px;margin:16px 22px;position:relative}
/* the tab row eases in the first time the panel is built */
.tabs{animation:dcTabsIn .42s cubic-bezier(.32,.72,.22,1) both}
@keyframes dcTabsIn{from{opacity:0;transform:translateY(-8px)}}
.tabs .tab{animation:dcTabIn .38s cubic-bezier(.32,.72,.22,1) backwards}
.tabs .tab:nth-child(1){animation-delay:.06s}
.tabs .tab:nth-child(2){animation-delay:.11s}
.tabs .tab:nth-child(3){animation-delay:.16s}
.tabs .tab:nth-child(4){animation-delay:.21s}
@keyframes dcTabIn{from{opacity:0;transform:translateY(-4px)}}
@media (prefers-reduced-motion:reduce){.tabs,.tabs .tab{animation:none}}
.tab{flex:1;padding:7px 0;border-radius:var(--r-md);font-size:12px;font-weight:550;color:var(--dim);
  text-transform:var(--case);letter-spacing:var(--track-tab);
  transition:color .15s ease,background-color .15s ease;text-align:center;position:relative}
.tab:hover{color:var(--text-soft)}
.tab.active{background:var(--tab-active);color:var(--tab-active-text);
  box-shadow:0 1px 4px rgba(0,0,0,.25),var(--tab-active-bar,inset 0 1px 0 var(--top-glint))}
.tabdot{display:inline-flex;align-items:center;justify-content:center;
  min-width:16px;height:16px;border-radius:8px;padding:0 4px;margin-left:6px;
  background:var(--acc-grad);color:var(--acc-text);font-size:10px;font-weight:700;vertical-align:1px;letter-spacing:normal;
  transition:transform .3s var(--ease-pop),opacity .2s ease,min-width .25s ease,margin .25s ease,padding .25s ease;
  transform-origin:center;transform:scale(1)}
.tabdot.zero{transform:scale(0);opacity:0;min-width:0;width:0;padding:0;margin-left:0;overflow:hidden}
.pages-tab{display:flex;align-items:center;justify-content:center;gap:4px}
.pages-tab .chev{width:12px;height:12px;transition:transform .2s}
.pages-tab.openm .chev{transform:rotate(180deg)}

/* ---------- pages dropdown ---------- */
.pagemenu{position:absolute;top:calc(100% + 8px);right:0;left:0;z-index:10;
  background:var(--menu-bg);
  border:1px solid var(--line-strong);border-radius:var(--r-lg);padding:6px;
  box-shadow:0 20px 50px rgba(0,0,0,.35),inset 0 1px 0 var(--top-glint);
  opacity:0;transform:translateY(-6px);pointer-events:none;
  transition:opacity .18s ease,transform .18s cubic-bezier(.32,.72,.22,1)}
.pagemenu.show{opacity:1;transform:none;pointer-events:auto}
.pagemenu a{display:flex;align-items:center;gap:8px;text-decoration:none;
  padding:9px 11px;border-radius:var(--r-sm);color:var(--text-soft);font-size:12.5px;transition:background .15s}
.pagemenu a:hover{background:var(--surface2)}
.pagemenu .opath{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
  color:var(--text-strong);font-weight:550;font-variant-numeric:tabular-nums}
.pagemenu .ocount{flex:none;min-width:16px;height:16px;border-radius:8px;padding:0 4px;
  background:var(--acc-grad);color:var(--acc-text);font-size:10px;font-weight:700;
  display:flex;align-items:center;justify-content:center}
.pagemenu .pm-empty{padding:12px;text-align:center;color:var(--faint);font-size:12px}

/* ---------- pages inbox ---------- */
.pgbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;padding:6px 0 10px;
  background:linear-gradient(var(--bg) 78%,transparent)}
.panel.has-bg .pgbar{background:none}
.pgsearch{flex:1;min-width:0;display:flex;align-items:center;gap:8px;height:34px;padding:0 11px;
  background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-md);transition:border-color .15s,box-shadow .15s}
.pgsearch:focus-within{border-color:var(--acc1);box-shadow:0 0 0 3px rgba(var(--glow),.14)}
.pgsearch svg{width:14px;height:14px;flex:none;stroke:var(--faint);fill:none;stroke-width:2}
.pgsearch input{flex:1;min-width:0;font-size:12.5px;color:var(--text)}
.pgsearch input::placeholder{color:var(--fainter)}
.pgsort{position:relative;display:flex;padding:3px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line)}
.pgs{position:relative;z-index:1;padding:5px 10px;border-radius:calc(var(--r-md) - 3px);font-size:11.5px;font-weight:600;color:var(--dim);transition:color .2s ease}
.pgs:hover{color:var(--text-soft)}
.pgs.sel{color:var(--text-strong)}
.pgs-glide{position:absolute;left:3px;top:3px;bottom:3px;border-radius:calc(var(--r-md) - 3px);background:var(--tab-active);
  box-shadow:0 1px 4px rgba(0,0,0,.25),inset 0 1px 0 var(--top-glint);transition:transform .26s var(--ease-io),width .26s var(--ease-io)}
.pgsum{font-size:11px;color:var(--faint);padding:2px 2px 8px}
.pgrow{display:flex;align-items:center;gap:12px;padding:13px 12px;margin:0 -12px;border-radius:var(--r-md);
  text-decoration:none;color:inherit;position:relative;
  animation:dcPgIn .38s cubic-bezier(.32,.72,.22,1) backwards;transition:background .15s ease}
.pgrow+.pgrow::before{content:"";position:absolute;left:12px;right:12px;top:0;height:1px;background:var(--line-soft)}
.pgrow:hover{background:var(--surface2)}
.pgrow:hover::before,.pgrow:hover+.pgrow::before{opacity:0}
@keyframes dcPgIn{from{opacity:0;transform:translateY(6px)}}
.pg-main{flex:1;min-width:0}
.pg-top{display:flex;align-items:center;gap:7px;min-width:0}
.pg-path{font-size:13px;font-weight:600;color:var(--text-strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pg-here,.pg-new{flex:none;font-size:10px;font-weight:700;padding:2px 7px;border-radius:9px}
.pg-here{color:var(--text-soft);background:var(--surface2);border:1px solid var(--line)}
.pg-new{color:var(--acc-text);background:var(--acc-grad)}
.pg-last{margin-top:3px;font-size:12px;color:var(--dim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pg-last b{color:var(--text-soft);font-weight:600}
.pgrow.unread .pg-last{color:var(--text-soft)}
.pg-quiet{color:var(--fainter)}
.pg-meta{display:flex;gap:10px;margin-top:6px;font-size:11px;color:var(--faint)}
.pg-open{display:inline-flex;align-items:center;gap:5px;color:var(--text-soft);font-weight:600}
.pg-open i{width:6px;height:6px;border-radius:50%;background:var(--acc1)}
.pg-clear{color:#3ecf8e;font-weight:600}
.pg-side{flex:none;display:flex;flex-direction:column;align-items:flex-end;gap:7px}
.pg-people{display:flex}
.pg-ava,.pg-lava{width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;
  font-size:9.5px;font-weight:700;color:#101012;border:2px solid var(--bg);margin-left:-7px}
.pg-people .pg-ava:first-child,.pg-live .pg-lava:first-child{margin-left:0}
.pg-live{display:flex;align-items:center}
.pg-live .pg-lava{box-shadow:0 0 0 1.5px #3ecf8e}
.pg-live em{font-style:normal;font-size:10.5px;font-weight:650;color:#3ecf8e;margin-left:6px}
.pg-go{width:14px;height:14px;flex:none;stroke:var(--fainter);fill:none;stroke-width:2;transition:transform .2s ease,stroke .2s ease}
.pgrow:hover .pg-go{transform:translateX(2px);stroke:var(--text-soft)}
.pgrow:hover .pg-go.ext{transform:translate(1px,-1px)}
.pg-empty svg{width:34px;height:34px;stroke:var(--fainter)}
@media (prefers-reduced-motion:reduce){.pgrow{animation:none}.pgs-glide{transition:none}}

/* ---------- list ---------- */
.list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:6px 22px 14px;
  scrollbar-width:thin;scrollbar-color:var(--line-strong) transparent}
.list::-webkit-scrollbar{width:6px}
.list::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:3px}
.empty{display:flex;flex-direction:column;align-items:center;gap:14px;color:var(--faint);text-align:center;padding:72px 20px;font-size:13px;line-height:1.7}
.empty svg{width:44px;height:44px;stroke:var(--fainter);background:var(--surface);
  border:1px solid var(--line);border-radius:var(--r-lg);padding:11px}

/* signed out: the conversation is visible as shape only */
.panel.locked .list{filter:blur(7px) saturate(.7);opacity:.5;pointer-events:none;user-select:none;
  transition:filter .35s ease,opacity .35s ease}
.panel.locked .typing{display:none}
.lockmsg{display:none;position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);
  z-index:8;text-align:center;padding:0 32px;pointer-events:none}
.panel.locked .lockmsg{display:block}
.lockmsg svg{width:26px;height:26px;stroke:var(--dim);margin-bottom:10px}
.lockmsg b{display:block;font-size:13px;font-weight:600;color:var(--text-strong);margin-bottom:3px}
.lockmsg span{font-size:11.5px;color:var(--faint)}

.author{position:relative;--nc:var(--text-strong);--nc2:var(--nc)}
/* two-colour name */
.author.grad{background:linear-gradient(95deg,var(--nc),var(--nc2));
  -webkit-background-clip:text;background-clip:text;
  color:transparent;-webkit-text-fill-color:transparent}

/* ---------- comments ---------- */
.item{display:flex;gap:11px;padding:13px 0;border-bottom:1px solid var(--line-soft)}
.item:last-child{border-bottom:0}
/* threaded replies: nested under their root with a rail, not flat in the feed */
.thread{margin:0 0 2px 42px;padding-left:13px;border-left:2px solid var(--line-soft)}
.thread .item{padding:10px 0}
.thread .item .avatar{width:24px;height:24px;font-size:10.5px;border-radius:8px}
.thread .item:last-child{border-bottom:0}
.item.reply{margin-left:0}
.item.root-with-replies{border-bottom:0;padding-bottom:6px}
.avatar{flex:none;width:31px;height:31px;border-radius:var(--r-ava);display:flex;align-items:center;justify-content:center;
  font-size:12.5px;font-weight:650;color:#101012;border:1px solid var(--line-soft)}
.itembody{flex:1;min-width:0}
.meta{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.author{font-weight:600;font-size:13px;color:var(--text-strong);letter-spacing:-.005em}
.time{color:var(--fainter);font-size:10.5px;font-variant-numeric:tabular-nums}
.content{white-space:pre-wrap;word-break:break-word;font-size:13.5px;color:var(--text-soft);line-height:1.55}
.content img{display:block;max-width:100%;max-height:var(--media-max,160px);
  width:auto;height:auto;
  border-radius:var(--r-md);margin-top:8px;cursor:zoom-in;
  border:1px solid var(--line-strong);box-shadow:0 4px 16px rgba(0,0,0,.2)}
/* ---------- image / gif lightbox (inside the panel) ---------- */
.lightbox{position:absolute;inset:0;z-index:40;display:none;align-items:center;justify-content:center;
  padding:26px;background:rgba(8,8,8,.82);backdrop-filter:blur(3px);cursor:zoom-out}
.lightbox.show{display:flex;animation:dcLbFade .2s ease}
.lightbox img{max-width:100%;max-height:100%;width:auto;height:auto;border-radius:var(--r-md);
  border:1px solid var(--line-strong);box-shadow:0 12px 50px rgba(0,0,0,.6);cursor:default;
  animation:dcLbIn .22s var(--ease-out)}
/* closing: play everything in reverse, JS hides it on animationend */
.lightbox.closing{animation:dcLbFade .16s ease reverse forwards}
.lightbox.closing img{animation:dcLbOut .16s ease forwards}
@keyframes dcLbFade{from{opacity:0}}
@keyframes dcLbIn{from{transform:scale(.9);opacity:0}}
@keyframes dcLbOut{to{transform:scale(.92);opacity:0}}
@media (prefers-reduced-motion:reduce){.lightbox.show,.lightbox img,.lightbox.closing,.lightbox.closing img,
  .annot.show,.annot.show .anwrap,.annot.closing,.annot.closing .anwrap,.pickveil.show,.pickveil.show .picklabel,
  .sres,.snone,.chip,.pinlayer .pdot,.pindot.show{animation:none}
  .searchrow,.pindot,.pineye,.pickhl{transition:none}}
.lightbox .lbclose{position:absolute;top:12px;right:12px;width:32px;height:32px;
  display:flex;align-items:center;justify-content:center;border-radius:var(--r-md);
  color:var(--text);font-size:15px;background:var(--surface2);border:1px solid var(--line-strong)}
.lightbox .lbclose:hover{background:var(--tab-active)}
.gifwrap{position:relative;display:inline-block;margin-top:8px}
.gifwrap img{margin-top:0}
.gifwrap::after{content:'GIF';position:absolute;left:8px;bottom:8px;
  padding:2px 6px;border-radius:var(--r-sm);background:rgba(0,0,0,.6);
  color:#fff;font-size:9.5px;font-weight:700;letter-spacing:.08em;
  opacity:0;transition:opacity .15s ease;pointer-events:none}
.gifwrap.paused::after{opacity:1}
/* pin controls inside edit mode */
.editpinrow{display:flex;align-items:center;gap:6px;margin-top:7px;animation:dcSres .2s ease}
.editpinrow .epin{display:inline-flex;align-items:center;gap:5px;padding:4px 10px 4px 8px;
  font-size:11px;color:var(--text-soft);background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md)}
.editpinrow .epin svg{width:11px;height:11px;stroke:var(--acc-soft);fill:none;stroke-width:2}
.editpinrow button{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;font-size:11px;
  color:var(--dim);border:1px solid var(--line);border-radius:var(--r-md);background:transparent;
  transition:color .15s ease,background-color .15s ease,border-color .15s ease}
.editpinrow button:hover{color:var(--text);background:var(--surface2)}
.editpinrow .eunpin:hover{color:var(--heart);border-color:var(--heart)}
.editpinrow .ecap{color:var(--acc-soft);border-color:rgba(var(--glow),.4)}
.editpinrow .ecap:hover{color:var(--acc-soft);background:rgba(var(--glow),.12);border-color:var(--acc1)}
.editpinrow .eaddpin svg{width:11px;height:11px;stroke:var(--acc-soft);fill:none;stroke-width:2}
.editbox{width:100%;background:var(--surface);border:1px solid var(--acc1);border-radius:var(--r-md);color:var(--text);
  font:inherit;font-size:13.5px;padding:9px 11px;resize:vertical;min-height:60px;outline:none;margin-top:2px;
  box-shadow:0 0 0 3px rgba(var(--glow),.12)}
.editrow{display:flex;gap:8px;margin-top:8px}
.editrow button{font-size:12px;padding:5px 13px;border-radius:var(--r-sm);transition:filter .15s ease,color .15s ease,background-color .15s ease}
.esave{background:var(--acc-grad);color:var(--acc-text);font-weight:600}
.esave:hover{filter:brightness(1.1)}
.ecancel{color:var(--dim);background:var(--surface2)}
.ecancel:hover{color:var(--text)}

/* actions: quiet until the comment is hovered */
.acts{display:flex;gap:4px;margin-top:7px;margin-left:-7px;opacity:.55;transition:opacity .15s}
.item:hover .acts,.acts:focus-within{opacity:1}
.acts button{display:flex;align-items:center;gap:5px;color:var(--faint);font-size:12px;padding:3px 8px;border-radius:var(--r-sm);transition:color .12s ease,background-color .12s ease}
.acts button:hover{color:var(--text);background:var(--surface2)}
.acts svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2}
.acts .liked{color:var(--heart)}
.acts .liked svg{fill:var(--heart);stroke:var(--heart)}
/* who-liked popover, shown when hovering a like count */
.likepop{position:absolute;z-index:45;max-width:230px;padding:7px 4px;
  background:var(--menu-bg);border:1px solid var(--line-strong);border-radius:var(--r-md);
  box-shadow:0 10px 34px rgba(0,0,0,.5),inset 0 1px 0 var(--top-glint);
  opacity:0;pointer-events:none;transform:translateY(3px);
  transition:opacity .12s ease,transform .12s ease}
.likepop.show{opacity:1;transform:none}
.likepop .lp-row{display:flex;align-items:center;gap:8px;padding:3px 9px;font-size:12px;color:var(--text-soft);white-space:nowrap}
.likepop .lp-ava{flex:none;width:18px;height:18px;border-radius:var(--r-ava);display:flex;align-items:center;justify-content:center;
  font-size:9px;font-weight:650;color:#101012;border:1px solid var(--line-soft)}
.acts .task:hover{color:var(--acc-soft)}
.acts .task.sent{color:var(--live)}
.acts .del:hover{color:var(--heart)}
.acts .del.arm{color:var(--heart);background:rgba(255,107,138,.12)}

/* replies quote the comment they answer, Teams style */
.quote{display:block;width:100%;margin-bottom:6px;padding:7px 10px 7px 11px;
  text-align:left;                        /* buttons centre their text */
  border-left:2px solid rgba(var(--glow),.45);border-radius:0 var(--r-sm) var(--r-sm) 0;
  background:transparent;cursor:pointer;   /* dulled accent bar at rest, full on hover */
  transition:background-color .15s ease,border-color .15s ease}
.quote:hover{background:var(--surface);border-left-color:var(--acc1)}
.quote .qmeta{display:flex;align-items:baseline;gap:7px;margin-bottom:1px}
.quote .qname{font-size:11.5px;font-weight:600;color:var(--text-soft)}
.quote .qtime{font-size:10px;color:var(--fainter);font-variant-numeric:tabular-nums}
.quote .qtext{font-size:12px;color:var(--faint);line-height:1.45;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.quote .qtext i{font-style:normal;color:var(--fainter)}
@keyframes dcFlash{0%,100%{background:transparent}30%{background:rgba(var(--glow),.14)}}
.item.flash{animation:dcFlash 1.1s ease}

/* ---------- multi-select for TaskFlow ---------- */
.item{position:relative}
.pick{position:absolute;left:-16px;top:15px;width:15px;height:15px;border-radius:4px;
  border:1.5px solid var(--line-strong);background:var(--surface);
  display:none;align-items:center;justify-content:center;padding:0;
  transition:border-color .12s ease,background-color .12s ease}
.panel.picking .pick{display:flex}
.pick svg{width:10px;height:10px;stroke:var(--acc-text);stroke-width:3;fill:none;opacity:0}
.pick.on{background:var(--acc1);border-color:var(--acc1)}
.pick.on svg{opacity:1}
.panel.picking .item{padding-left:6px}
.panel.picking .list{padding-left:38px}
.item.picked{background:rgba(var(--glow),.06);border-radius:var(--r-sm)}

.pickbar{display:none;align-items:center;gap:8px;margin-bottom:10px;padding:8px 10px;
  border:1px solid var(--acc1);border-radius:var(--r-md);background:rgba(var(--glow),.08);
  font-size:12px;color:var(--text)}
.panel.picking .pickbar{display:flex}
.pickbar .pcount{flex:1;color:var(--dim)}
.pickbar .pcount b{color:var(--text-strong);font-weight:600}
.pickbar button{padding:6px 12px;border-radius:var(--r-sm);font-size:12px;
  transition:filter .15s ease,color .15s ease,background-color .15s ease}
.pickbar .pgo{background:var(--acc-grad);color:var(--acc-text);font-weight:600}
.pickbar .pgo:hover{filter:brightness(1.1)}
.pickbar .pgo:disabled{opacity:.4;cursor:default}
.pickbar .pcancel{color:var(--dim);background:var(--surface2)}
.pickbar .pcancel:hover{color:var(--text)}
.acts .pickstart:hover{color:var(--acc-soft)}

/* ---------- NEW divider ---------- */
.newline{display:flex;align-items:center;gap:10px;margin:12px 0 4px;color:var(--acc-soft);font-size:10px;font-weight:700;letter-spacing:.14em}
.newline::before,.newline::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,transparent,rgba(var(--glow),.45))}
.newline::after{background:linear-gradient(90deg,rgba(var(--glow),.45),transparent)}

/* ---------- attach chips ---------- */
.chips{display:none;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.chips.show{display:flex}
.chip{position:relative;width:56px;height:56px;border-radius:var(--r-md);overflow:hidden;
  animation:dcChip .22s var(--ease-out) backwards;
  border:1px solid var(--line-strong);box-shadow:0 3px 10px rgba(0,0,0,.25)}
.chip img{width:100%;height:100%;object-fit:cover}
.chip.loading{display:flex;align-items:center;justify-content:center;color:var(--dim);font-size:10px;background:var(--surface)}
.chip .x{position:absolute;top:3px;right:3px;width:16px;height:16px;border-radius:8px;background:rgba(0,0,0,.72);
  color:#fff;font-size:10px;line-height:1;display:flex;align-items:center;justify-content:center}
@keyframes dcChip{from{opacity:0;transform:scale(.8)}}
.chip .x:hover{background:var(--heart)}
.chip .an{position:absolute;bottom:3px;right:3px;width:16px;height:16px;border-radius:8px;background:rgba(0,0,0,.72);
  color:#fff;font-size:9px;line-height:1;display:flex;align-items:center;justify-content:center}
.chip .an:hover{background:var(--acc1);color:var(--acc-text)}
.chip.pinned .x{position:absolute;top:50%;right:5px;transform:translateY(-50%)}

/* ---------- check reaction + done state ---------- */
.acts .like.bump svg,.acts .ckb.bump svg,.acts .dwn.bump svg{animation:dcBump .3s ease}
/* this glyph is filled rather than stroked, and already points down */
.acts .dwn svg{fill:currentColor;stroke:none}
.acts .dwn.downed{color:var(--heart)}
.acts .dwn.downed svg{fill:var(--heart);stroke:none}
.acts .donebtn.on{color:var(--ok)}
.acts .donebtn:hover{color:var(--ok)}
.acts .ckb.checked{color:var(--ok)}
.acts .ckb.checked svg{stroke:var(--ok)}
/* done = collapsed for everyone; anyone can expand to peek or un-done it */
.item.done .content{opacity:.55}
.item.done .content img{opacity:.75}

/* a done thread keeps the feed's geometry \u2014 same padding, same divider, the
   check sitting in the avatar column \u2014 it is just quieter */
.collapsed{display:flex;align-items:center;gap:11px;box-sizing:border-box;
  width:calc(100% + 44px);margin:0 -22px;padding:11px 22px;text-align:left;
  border-bottom:1px solid var(--line-soft);cursor:pointer;
  transition:opacity .15s ease,background-color .15s ease;opacity:.72}
.collapsed:hover{opacity:1;background:var(--surface)}
.collapsed .cv{flex:none;width:31px;height:31px;display:flex;align-items:center;justify-content:center}
.collapsed .cv svg{width:14px;height:14px;stroke:var(--faint);fill:none;stroke-width:2.2}
.collapsed:hover .cv svg{stroke:var(--dim)}
.collapsed .cname{flex:none;font-size:12.5px;font-weight:600;color:var(--faint)}
.collapsed .ctxt{flex:1;min-width:0;font-size:12.5px;color:var(--fainter);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.collapsed .ccount{flex:none;font-size:10.5px;color:var(--fainter)}
.collapsed .cundo{flex:none;font-size:11px;color:var(--fainter);padding:2px 0 2px 10px;
  transition:color .12s ease}
.collapsed .cundo:hover{color:var(--text-soft)}
.collapsed .cchev{display:none}

/* two or more done threads in a row fold into one "N marked done" row */
.dgrp{border-bottom:1px solid var(--line-soft);width:calc(100% + 44px);margin:0 -22px;box-sizing:border-box}
.dgrp-h{display:flex;align-items:center;gap:11px;width:100%;box-sizing:border-box;padding:11px 22px;text-align:left;
  cursor:pointer;opacity:.72;transition:opacity .15s ease}
.dgrp-h:hover{opacity:1}
.dgrp-h .cv{flex:none;width:31px;height:31px;display:flex;align-items:center;justify-content:center}
.dgrp-h .cv svg{width:14px;height:14px;stroke:var(--faint);fill:none;stroke-width:2.2}
.dgrp-h .dg-t{flex:none;font-size:12.5px;font-weight:600;color:var(--faint)}
.dgrp-h .dg-who{flex:1;min-width:0;font-size:12.5px;color:var(--fainter);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dgrp-h .dg-chev{flex:none;width:14px;height:14px;stroke:var(--fainter);fill:none;stroke-width:2.2;transition:transform .2s var(--ease-out)}
.dgrp.open .dgrp-h .dg-chev{transform:rotate(90deg)}
.dgrp-b{display:none}
.dgrp.open .dgrp-b{display:block}
.dgrp .collapsed{width:100%;margin:0;border-bottom:0;border-top:1px solid var(--line-soft);padding-left:34px}
.panel.has-bg .dgrp-h{opacity:1}
.panel.has-bg .dgrp-h .dg-t{color:var(--text-soft)}
.panel.has-bg .dgrp-h .dg-who{color:var(--dim)}

/* peeked open: no card, just a small label above the thread */
.dbar{display:flex;align-items:center;gap:12px;padding:10px 0 0;
  font-size:11px;color:var(--fainter)}
.dbar .db-sp{flex:1}
.dbar button{font-size:11px;color:var(--fainter);transition:color .12s ease}
.dbar button:hover{color:var(--text-soft)}
.dwrap .item{opacity:.8}
.dwrap .item:hover{opacity:1}

/* height collapse used when Done / Undone is clicked */

/* ---------- pinning ---------- */
.pinbtn{flex:none;align-self:center;margin:0 2px 0 0;padding:5px 7px;border-radius:var(--r-sm);
  color:var(--faint);border:1px solid transparent;display:flex;align-items:center;transition:color .15s ease,border-color .15s ease,background-color .15s ease}
.pinbtn:hover,.pinbtn.on{color:var(--acc-soft);border-color:var(--acc1);background:var(--surface2)}
.chip.pinned{width:auto;display:flex;align-items:center;gap:6px;padding:0 26px 0 10px;
  font-size:11.5px;color:var(--text-soft);background:var(--surface);overflow:visible}
.chip.pinned svg{width:12px;height:12px;stroke:var(--acc-soft);fill:none;stroke-width:2}
/* pinned-element chip: quiet, on its own line under the text, accent only
   on the icon so a loud accent colour doesn't shout */
.pinchip{display:flex;width:max-content;max-width:100%;align-items:center;gap:6px;
  margin-top:8px;padding:4px 10px 4px 8px;
  font-size:11px;font-weight:500;color:var(--text-soft);
  background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-md);transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.pinchip:hover{background:var(--surface2);border-color:rgba(var(--glow),.4);color:var(--text)}
.pinchip svg{width:11px;height:11px;stroke:var(--acc-soft);fill:none;stroke-width:2;flex:none}
.pickveil{position:fixed;inset:0;z-index:60;display:none;cursor:crosshair;pointer-events:auto;
  background:rgba(8,8,8,.12)}
.pickveil.show{display:block;animation:dcLbFade .2s ease}
.pickveil.show .picklabel{animation:dcDrop .25s var(--ease-out)}
@keyframes dcDrop{from{opacity:0;transform:translate(-50%,-10px)}to{opacity:1;transform:translate(-50%,0)}}
.picklabel{position:fixed;top:14px;left:50%;transform:translateX(-50%);padding:7px 14px;
  font-family:var(--font);font-size:12.5px;color:var(--text);background:var(--menu-bg);
  border:1px solid var(--line-strong);border-radius:var(--r-md);box-shadow:0 8px 30px rgba(0,0,0,.5)}
.pickhl{position:fixed;z-index:59;display:none;pointer-events:none;
  transition:left .05s linear,top .05s linear,width .05s linear,height .05s linear;
  border:2px solid var(--acc1);border-radius:3px;background:rgba(var(--glow),.12);
  box-shadow:0 0 0 4px rgba(var(--glow),.18)}
.pickhl.show{display:block}
.pindot{position:fixed;z-index:1;width:14px;height:14px;margin:-7px 0 0 -7px;
  border-radius:50%;background:var(--acc1);pointer-events:none;
  box-shadow:0 0 0 3px rgba(var(--glow),.35);
  opacity:0;transform:scale(.8);visibility:hidden;
  transition:opacity .3s ease,transform .3s var(--ease-out),visibility 0s .3s}
.pindot.show{opacity:1;transform:scale(1);visibility:visible;transition-delay:0s;
  animation:dcPing 1.1s ease-out infinite}
@keyframes dcPing{0%{box-shadow:0 0 0 3px rgba(var(--glow),.45)}70%{box-shadow:0 0 0 16px rgba(var(--glow),0)}100%{box-shadow:0 0 0 3px rgba(var(--glow),0)}}
/* see this page's pins without opening the panel */
.pineye{pointer-events:auto;position:absolute;z-index:1;display:none;align-items:center;gap:5px;
  padding:6px 10px;border-radius:var(--r-lg) 0 0 var(--r-lg);
  background:var(--toggle-bg);color:var(--dim);border:1px solid var(--line-strong);border-right:0;
  font-size:11px;font-weight:650;box-shadow:-12px 0 34px rgba(0,0,0,.3),inset 0 1px 0 var(--top-glint);
  opacity:0;transform:translateX(8px);transition:opacity .2s ease,transform .2s ease,color .15s ease,background-color .15s ease}
.pineye.show{display:flex;opacity:1;transform:none;
  animation:dcEdgeInR .5s var(--ease-drawer) .2s backwards}   /* follows the tab out */
.pineye.left.show{animation-name:dcEdgeInL}
.pineye.show svg,.pineye.show .pecount{animation:dcIconIn .3s var(--ease-out) .44s backwards}
.pineye:hover,.pineye.on{color:var(--acc-soft);background:var(--toggle-hover)}
.pineye svg{stroke:currentColor;fill:none}
.pineye.left{border-radius:0 var(--r-lg) var(--r-lg) 0;border-right:1px solid var(--line-strong);border-left:0;
  box-shadow:12px 0 34px rgba(0,0,0,.3),inset 0 1px 0 var(--top-glint)}
/* below the panel (3) and its dim overlay (2): dots belong to the page */
.pinlayer{position:fixed;inset:0;pointer-events:none;z-index:1}
.pinlayer .pdot{position:fixed;pointer-events:auto;width:22px;height:22px;margin:-11px 0 0 -11px;
  border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;
  background:var(--acc1);color:var(--acc-text);font-family:var(--font);font-size:11px;font-weight:700;
  box-shadow:0 0 0 3px rgba(var(--glow),.3),0 4px 14px rgba(0,0,0,.35);
  animation:dcPdot .28s var(--ease-out) backwards}
.pinlayer .pdot{transition:opacity .25s ease,transform .25s var(--ease-out),box-shadow .2s ease,background .25s ease}
.pinlayer .pdot:hover,.pinlayer .pdot.hl{box-shadow:0 0 0 5px rgba(var(--glow),.4),0 4px 14px rgba(0,0,0,.35);transform:scale(1.15)}
.pinlayer .pdot svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2.8}
/* done: still findable, clearly settled */
.pinlayer .pdot.done{opacity:.45;box-shadow:0 0 0 2px rgba(var(--glow),.18),0 4px 14px rgba(0,0,0,.25)}
.pinlayer .pdot.done:hover,.pinlayer .pdot.done.hl{opacity:1}
@keyframes dcPdot{from{opacity:0;transform:scale(.7)}}
.pinlayer.hiding .pdot{animation:dcPdotOut .18s ease forwards}
.pinlayer .pdot.gone{animation:dcPdotOut .2s var(--ease-out) forwards;pointer-events:none}
/* hover a dot: a small eye-off chip appears on the side away from the card */
.pinlayer .pdhide{position:fixed;pointer-events:auto;width:22px;height:22px;margin-top:-11px;border-radius:50%;
  display:flex;align-items:center;justify-content:center;color:var(--text-soft);
  background:linear-gradient(var(--menu-bg),var(--menu-bg)),var(--bg);border:1px solid var(--line-strong);
  box-shadow:0 4px 14px rgba(0,0,0,.35);
  opacity:0;transform:scale(.8);transition:opacity .14s ease,transform .18s var(--ease-out),color .12s ease,background .12s ease}
.pinlayer .pdhide.show{opacity:1;transform:none}
.pinlayer .pdhide:hover{color:var(--text-strong);border-color:rgba(var(--glow),.55)}
.pinlayer .pdhide svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2.2}
.pinlayer .pdhide::after{content:"Hide for me";position:absolute;top:calc(100% + 6px);left:50%;transform:translateX(-50%);
  white-space:nowrap;padding:3px 7px;border-radius:6px;font:600 10.5px/1.4 var(--font);color:var(--text-strong);
  background:linear-gradient(var(--menu-bg),var(--menu-bg)),var(--bg);border:1px solid var(--line-strong);
  opacity:0;transition:opacity .12s ease;pointer-events:none}
.pinlayer .pdhide:hover::after{opacity:1}
@keyframes dcPdotOut{to{opacity:0;transform:scale(.7)}}
/* dropdown listing this page's pins, anchored to the pin tab */
/* full-height popout: the list of pins can be long, so it scrolls in place
   instead of running off the bottom of the screen */
/* z 3: under the panel (later in the DOM), over the dim overlay, so it pulls
   out from behind the panel's edge like a drawer */
.pinmenu{position:absolute;top:0;bottom:0;left:100%;right:auto;width:300px;max-width:86vw;
  display:flex;flex-direction:column;padding:0;
  font-family:var(--font);background:var(--menu-bg);border-left:1px solid var(--line-strong);
  box-shadow:-18px 0 50px rgba(0,0,0,.5),inset 1px 0 0 var(--top-glint);
  opacity:0;pointer-events:none;transition:opacity var(--slide-out)}
.pinmenu.show{transition:opacity var(--slide-in)}
.pinmenu.show{opacity:1;pointer-events:auto;transform:none}
.pinmenu.left{left:auto;right:100%;border-left:0;border-right:1px solid var(--line-strong);
  box-shadow:18px 0 50px rgba(0,0,0,.5)}
.pinmenu .pm-head{flex:none;display:flex;align-items:center;gap:8px;padding:16px 16px 12px;
  border-bottom:1px solid var(--line-soft)}
.pinmenu .pm-title{flex:1;font-size:12.5px;font-weight:650;color:var(--text-strong)}
.pinmenu .pm-close{width:26px;height:26px;border-radius:var(--r-sm);color:var(--dim);
  display:flex;align-items:center;justify-content:center;border:1px solid var(--line-soft)}
.pinmenu .pm-close:hover{color:var(--text);background:var(--surface2)}
.pinmenu .pm-scroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:8px 8px 10px;
  scrollbar-width:thin;scrollbar-color:var(--line-strong) transparent}
.pinmenu .pm-scroll::-webkit-scrollbar{width:6px}
.pinmenu .pm-scroll::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:3px}
.pinmenu .pm-foot{flex:none;padding:10px;border-top:1px solid var(--line-soft)}
.pinmenu .pm-item{display:flex;align-items:center;gap:9px;width:100%;text-align:left;
  padding:9px 9px;border-radius:var(--r-sm);cursor:pointer;transition:background-color .12s ease}
.pinmenu .pm-item:hover{background:var(--surface2)}
.pinmenu .pm-n{flex:none;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;background:var(--acc1);color:var(--acc-text)}
.pinmenu .pm-txt{min-width:0;flex:1;font-size:11.5px;color:var(--text-soft);line-height:1.4;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pinmenu .pm-txt b{display:block;font-size:10.5px;font-weight:650;color:var(--text-strong)}
.pinmenu .pm-all{width:100%;justify-content:center;font-size:11.5px;color:var(--dim);
  border:1px solid var(--line);border-radius:var(--r-sm)}
.pinmenu .pm-all:hover{color:var(--acc-soft)}
/* per-pin visibility check: ticked = its dot shows on the page for you */
.pinmenu .pm-row{display:flex;align-items:center;gap:2px}
.pinmenu .pm-row .pm-item{flex:1;min-width:0}
.pinmenu .pm-vis{flex:none;width:30px;height:30px;border-radius:var(--r-sm);display:flex;align-items:center;justify-content:center}
.pinmenu .pm-vis:hover{background:var(--surface2)}
.pinmenu .pm-vis i{width:16px;height:16px;border-radius:5px;display:flex;align-items:center;justify-content:center;
  border:1.5px solid var(--line-strong);transition:background .15s ease,border-color .15s ease}
.pinmenu .pm-vis svg{width:11px;height:11px;stroke:var(--acc-text);fill:none;stroke-width:3;opacity:0;scale:.6;
  transition:opacity .15s ease,scale .2s var(--ease-out)}
.pinmenu .pm-vis[aria-checked="true"] i{background:var(--acc1);border-color:var(--acc1)}
.pinmenu .pm-vis[aria-checked="true"] svg{opacity:1;scale:1}
.pinmenu .pm-row.off .pm-txt{opacity:.45}
.pinmenu .pm-row.off .pm-n{background:transparent;color:var(--faint);box-shadow:inset 0 0 0 1.5px var(--line-strong)}
.pinmenu .pm-n,.pinmenu .pm-txt{transition:opacity .15s ease,background .15s ease,color .15s ease}
.pinmenu .pm-sub{padding:2px 10px 8px;font-size:10.5px;color:var(--faint)}
/* hover card next to an overlay dot: the pinned comment */
.pintip{position:fixed;z-index:1;max-width:270px;padding:9px 12px;pointer-events:none;
  font-family:var(--font);font-size:12px;line-height:1.5;color:var(--text-soft);
  background:var(--menu-bg);border:1px solid var(--line-strong);border-radius:var(--r-md);
  box-shadow:0 12px 40px rgba(0,0,0,.5),inset 0 1px 0 var(--top-glint);
  opacity:0;transform:translateY(3px);transition:opacity .14s ease,transform .14s ease}
.pintip.show{opacity:1;transform:none}
.pintip{max-width:290px;padding:11px 13px 10px}
.pintip .pt-head{display:flex;align-items:center;gap:8px;margin-bottom:6px}
.pintip .pt-ava{width:22px;height:22px;flex:none;border-radius:7px;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;color:#101012}
.pintip b{font-size:12px;font-weight:650;color:var(--text-strong)}
.pintip .pt-time{font-size:11px;color:var(--faint)}
.pintip .pt-done{margin-left:auto;display:inline-flex;align-items:center;gap:4px;padding:2px 8px 2px 6px;border-radius:9px;
  font-size:10.5px;font-weight:650;color:#3ecf8e;background:rgba(62,207,142,.12);border:1px solid rgba(62,207,142,.28)}
.pintip .pt-done svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2.6}
.pintip.done .pt-txt{opacity:.6;text-decoration:line-through;text-decoration-color:rgba(255,255,255,.25)}
.pintip i{display:block;margin-top:7px;font-size:10.5px;font-style:normal;color:var(--fainter)}
.dctoast{position:fixed;top:18px;left:50%;transform:translate(-50%,-10px) scale(.97);z-index:70;
  padding:9px 16px;font-family:var(--font);font-size:12.5px;color:var(--text);background:var(--menu-bg);
  border:1px solid var(--line-strong);border-radius:var(--r-md);box-shadow:0 10px 34px rgba(0,0,0,.5);
  opacity:0;pointer-events:none;transition:opacity .2s ease,transform .32s var(--ease-out)}
.dctoast.show{opacity:1;transform:translate(-50%,0)}
/* a notebook scan logged on your phone: shown even with the panel shut */
.scannote{position:fixed;top:16px;left:50%;z-index:71;width:min(400px,calc(100vw - 24px));
  display:flex;align-items:center;gap:11px;padding:10px 8px 10px 12px;font-family:var(--font);color:var(--text);
  background:linear-gradient(var(--menu-bg),var(--menu-bg)),var(--bg);border:1px solid var(--line-strong);border-radius:var(--r-lg);
  box-shadow:0 18px 50px rgba(0,0,0,.4),inset 0 1px 0 var(--top-glint);
  opacity:0;pointer-events:none;transform:translate(-50%,-12px) scale(.97);
  transition:opacity .2s ease,transform .34s var(--ease-out)}
.scannote.show{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
.scannote .sn-ico{flex:none;width:34px;height:34px;border-radius:var(--r-md);display:flex;align-items:center;justify-content:center;
  color:var(--acc1);background:color-mix(in srgb,var(--acc1) 14%,transparent)}
.scannote .sn-ico svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:2}
.scannote .sn-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.scannote b{font-size:13px;font-weight:650;color:var(--text-strong)}
.scannote .sn-sub{font-size:11.5px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.scannote .sn-view{flex:none;height:28px;padding:0 11px;border-radius:var(--r-md);font-size:12px;font-weight:600;
  color:var(--acc-text);background:var(--acc1);transition:filter .15s ease}
.scannote .sn-view:hover{filter:brightness(1.08)}
.scannote .sn-x{flex:none;width:28px;height:28px;border-radius:var(--r-md);color:var(--faint);display:flex;align-items:center;justify-content:center}
.scannote .sn-x:hover{background:var(--surface2);color:var(--text)}
.scannote .sn-x svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2.4}
/* undo: every reversible action offers five seconds to take it back */
.undotoast{position:absolute;left:50%;bottom:24px;z-index:60;display:flex;align-items:center;gap:4px;
  padding:5px 5px 5px 14px;font-family:var(--font);font-size:12.5px;color:var(--text);overflow:hidden;
  background:linear-gradient(var(--menu-bg),var(--menu-bg)),var(--bg);
  border:1px solid var(--line-strong);border-radius:12px;box-shadow:0 18px 44px rgba(0,0,0,.5),inset 0 1px 0 var(--top-glint);
  opacity:0;pointer-events:none;transform:translate(-50%,14px) scale(.96);
  transition:opacity .2s ease,transform .32s var(--ease-out)}
.undotoast.show{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
.undotoast .ut-ico{width:16px;height:16px;flex:none;margin-right:4px;stroke:var(--acc-soft);fill:none;stroke-width:2.2}
.undotoast .ut-msg{padding-right:8px;white-space:nowrap}
.undotoast .ut-undo{padding:6px 12px;border-radius:8px;font-weight:650;font-size:12px;color:var(--acc-soft);
  transition:background .15s ease,color .15s ease}
.undotoast .ut-undo:hover{background:var(--surface2);color:var(--text-strong)}
.undotoast .ut-undo kbd{font:inherit;font-size:10px;font-weight:600;margin-left:6px;color:var(--faint)}
.undotoast .ut-x{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--faint)}
.undotoast .ut-x:hover{background:var(--surface2);color:var(--text)}
.undotoast .ut-bar{position:absolute;left:0;bottom:0;height:2px;width:100%;background:var(--acc1);opacity:.7;
  transform-origin:left;animation:dcUndoBar 5s linear forwards}
@keyframes dcUndoBar{to{transform:scaleX(0)}}

/* ---------- posted-from metadata ---------- */
.meta .minfo{display:inline-flex;align-items:center;justify-content:center;align-self:center;
  width:16px;height:16px;color:var(--hint);border-radius:var(--r-sm)}
.meta .minfo:hover{color:var(--text-soft)}
.meta .minfo svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2}

/* ---------- search ---------- */
/* jump back to the top of a long thread; sits above the compose bar */
/* jump notch: sits ON the composer's top divider, half above and half below,
   so it lives in the seam instead of floating over comments. The list keeps
   extra bottom room so the last comment always clears it. */
.totop,.tobot{position:absolute;left:50%;z-index:5;height:22px;padding:0 10px 0 8px;border-radius:11px;
  display:flex;align-items:center;gap:5px;white-space:nowrap;
  font-family:var(--font);font-size:10.5px;font-weight:600;letter-spacing:.01em;
  color:var(--dim);background:var(--compose-bg,var(--bg));
  border:1px solid var(--line);
  box-shadow:0 2px 8px rgba(0,0,0,.25);
  opacity:0;pointer-events:none;transform:translate(-50%,8px) scale(.94);
  transition:opacity .18s ease,transform .26s var(--ease-out),bottom .26s cubic-bezier(.32,.72,.22,1),
    background-color .15s ease,color .15s ease,border-color .15s ease}
.totop.show,.tobot.show{opacity:1;pointer-events:auto;transform:translate(-50%,0)}
.totop:hover,.tobot:hover{color:var(--text-strong);background:var(--surface2);border-color:rgba(var(--glow),.45)}
.totop:active,.tobot:active{transform:translate(-50%,0) scale(.96)}
.totop svg,.tobot svg{width:11px;height:11px;flex:none}
.list{padding-bottom:26px}   /* room for the notch half that sits over the feed */
.tobot:hover svg{animation:dcNudgeDn .5s ease}
.totop:hover svg{animation:dcNudgeUp .5s ease}
@keyframes dcNudgeDn{50%{transform:translateY(2px)}}
@keyframes dcNudgeUp{50%{transform:translateY(-2px)}}
@media (prefers-reduced-motion:reduce){.totop,.tobot{transition:opacity .18s ease}}
.searchrow{display:flex;align-items:center;gap:8px;margin:0 22px;padding:0 4px 0 12px;
  background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-lg);color:var(--faint);
  max-height:0;opacity:0;margin-top:0;overflow:hidden;border-width:0;pointer-events:none;
  transform:translateY(-4px);
  transition:max-height .22s ease,opacity .18s ease,margin-top .22s ease,transform .22s ease,border-width 0s .22s}
.searchrow.show{max-height:44px;opacity:1;margin-top:10px;border-width:1px;pointer-events:auto;transform:none;
  transition:max-height .22s ease,opacity .18s .04s ease,margin-top .22s ease,transform .22s ease}
.searchrow .sq{flex:1;min-width:0;padding:8px 0;font-size:13px;color:var(--text)}
.searchrow .sq::placeholder{color:var(--fainter)}
.searchrow .sx{flex:none;width:26px;height:26px;border-radius:var(--r-sm);color:var(--dim);font-size:11px;
  display:flex;align-items:center;justify-content:center}
.searchrow .sx:hover{color:var(--text);background:var(--surface2)}
.sres{display:block;box-sizing:border-box;width:calc(100% + 20px);margin:0 -10px;
  text-align:left;padding:11px 10px;cursor:pointer;
  border-radius:var(--r-md);animation:dcSres .22s ease backwards}
.sres+.sres{border-top:1px solid var(--line-soft)}
@keyframes dcSres{from{opacity:0;transform:translateY(7px)}}
.snone{animation:dcSres .22s ease}
/* notification centre */
.nfsub{display:flex;gap:2px;margin:10px 0 2px;padding:3px;background:var(--surface);
  border:1px solid var(--line-soft);border-radius:var(--r-md)}
.nfsubb{flex:1;padding:6px 0;border-radius:calc(var(--r-md) - 3px);font-size:11.5px;font-weight:600;
  color:var(--faint);transition:color .15s ease,background-color .15s ease}
.nfsubb:hover{color:var(--text-soft)}
.nfsubb.sel{color:var(--text-strong);background:var(--tab-active);
  box-shadow:0 1px 3px rgba(0,0,0,.28),inset 0 1px 0 var(--top-glint)}
.nfsubb i{display:inline-block;margin-left:5px;padding:0 6px;font-style:normal;font-size:10px;
  border-radius:8px;background:var(--surface2);color:var(--dim)}
.nfsubb.sel i{background:var(--acc1);color:var(--acc-text)}
.nfnone{padding:18px 0;font-size:12.5px;color:var(--faint);animation:dcSres .22s ease}
.nfrow.old{opacity:.6}
.nfrow.old:hover{opacity:1}
.nfhead{display:flex;align-items:center;gap:10px;padding:11px 0 9px;margin-bottom:2px;border-bottom:1px solid var(--line-soft)}
.nfhead .nfcount{flex:1;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--faint)}
.nfhead button{font-size:11px;color:var(--dim);padding:3px 9px;border-radius:var(--r-sm);
  border:1px solid var(--line);transition:color .12s ease,border-color .12s ease,background-color .12s ease}
.nfhead button:hover{color:var(--text);background:var(--surface2);border-color:var(--line-strong)}
/* the fill bleeds 10px past the text on both sides, so it reads as a hovered
   row rather than a band running into the panel edges */
.nfrow{display:flex;gap:11px;box-sizing:border-box;
  width:calc(100% + 20px);margin:0 -10px;padding:11px 10px;
  text-align:left;cursor:pointer;border-radius:var(--r-md);
  animation:dcSres .22s ease backwards;transition:background-color .12s ease}
.nfrow+.nfrow{border-top:1px solid var(--line-soft)}
.nfrow:hover{background:var(--surface)}
.nfico{flex:none;width:26px;height:26px;border-radius:9px;display:flex;align-items:center;justify-content:center;
  background:var(--surface2);border:1px solid var(--line-soft)}
.nfico svg{width:13px;height:13px;stroke:var(--dim);fill:none;stroke-width:2}
.nfico.like svg{stroke:var(--heart);fill:var(--heart)}
.nfico.down svg{stroke:none;fill:var(--heart)}
.nfico.check svg{stroke:var(--ok)}
.nfico.done svg{stroke:var(--ok)}
.nfico.reply svg,.nfico.comment svg,.nfico.mention svg{stroke:var(--acc-soft)}
.nfbody{flex:1;min-width:0}
.nftop{display:flex;align-items:baseline;gap:8px}
.nfwho{font-size:12.5px;font-weight:600;color:var(--text-strong)}
.nfwhen{margin-left:auto;font-size:10.5px;color:var(--fainter);white-space:nowrap}
.nfwhat{font-size:12px;color:var(--text-soft)}
.nftxt{margin-top:3px;font-size:11.5px;color:var(--fainter);line-height:1.45;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.nfctx{display:inline-block;margin-top:4px;font-size:10px;color:var(--acc-soft);background:var(--surface2);
  padding:1px 7px;border-radius:8px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
/* all-pins view */
.pfilter{display:flex;gap:6px;padding:10px 2px 8px;border-bottom:1px solid var(--line-soft);animation:dcSres .22s ease}
.pfilter .seg{flex:none;padding:5px 13px}
.sres .sr-pin{flex:none;width:15px;height:15px;display:inline-flex;margin-right:2px}
.sres .sr-pin svg{width:100%;height:100%;stroke:var(--acc-soft);fill:none;stroke-width:2}
.sres:hover{background:var(--surface)}
.sres .sr-top{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.sres .sr-name{font-size:12.5px;font-weight:600;color:var(--text-strong)}
.sres .sr-ctx{font-size:10.5px;color:var(--acc-soft);background:var(--surface2);padding:1px 7px;border-radius:8px;
  max-width:45%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sres .sr-time{font-size:10.5px;color:var(--fainter);margin-left:auto}
.sres .sr-txt{font-size:12.5px;color:var(--text-soft);line-height:1.5;word-break:break-word}
.sres .sr-txt b{color:var(--acc-soft);font-weight:650}
.snone{padding:26px 0;text-align:center;font-size:12.5px;color:var(--faint)}

/* ---------- notifications: setup wizard ---------- */
.notifask{position:absolute;inset:0;z-index:49;display:none;align-items:center;justify-content:center;
  padding:22px;background:rgba(8,8,8,.74);backdrop-filter:blur(3px)}
.notifask.show{display:flex;animation:dcLbFade .2s ease}
.nacard{width:100%;max-width:340px;max-height:100%;display:flex;flex-direction:column;
  padding:22px 22px 16px;background:var(--menu-bg);
  border:1px solid var(--line-strong);border-radius:var(--r-lg);
  box-shadow:0 18px 60px rgba(0,0,0,.55),inset 0 1px 0 var(--top-glint);
  animation:dcLbIn .24s var(--ease-out)}
.nasteps{display:flex;justify-content:center;gap:5px;margin-bottom:16px}
.nasteps i{width:5px;height:5px;border-radius:3px;background:var(--line-strong);transition:width .2s ease,background-color .2s ease}
.nasteps i.on{width:14px;background:var(--acc1)}
.nabody{flex:1;min-height:0;overflow-y:auto;text-align:center}
.naicon{width:46px;height:46px;margin:0 auto 12px;border-radius:13px;display:flex;align-items:center;justify-content:center;
  background:rgba(var(--glow),.12);border:1px solid rgba(var(--glow),.28)}
.naicon svg{width:22px;height:22px;stroke:var(--acc-soft);fill:none;stroke-width:1.8}
.natitle{font-size:15px;font-weight:650;color:var(--text-strong);margin-bottom:6px}
.natext{font-size:12.5px;line-height:1.6;color:var(--text-soft)}
.natext b{color:var(--text-strong);font-weight:600}
/* the four-way choice */
.nachoice{display:flex;flex-direction:column;gap:8px;margin-top:16px;text-align:left}
.nachoice button{display:flex;align-items:center;gap:11px;padding:12px 13px;border-radius:var(--r-md);
  border:1px solid var(--line-strong);background:var(--surface);
  transition:background-color .15s ease,border-color .15s ease,transform .15s ease}
.nachoice button:hover{background:var(--surface2);border-color:rgba(var(--glow),.5);transform:translateY(-1px)}
.nachoice svg{flex:none;width:18px;height:18px;stroke:var(--acc-soft);fill:none;stroke-width:1.7}
.nachoice span{display:flex;flex-direction:column;font-size:10.5px;color:var(--fainter);line-height:1.35}
.nachoice b{font-size:12.5px;font-weight:600;color:var(--text-soft)}
.nachoice .nanone svg{stroke:var(--faint)}
/* numbered walkthrough steps */
.nalist{margin-top:14px;text-align:left}
.naitem{display:flex;gap:10px;padding:7px 0;font-size:12.5px;line-height:1.55;color:var(--text-soft)}
.naitem i{flex:none;width:19px;height:19px;margin-top:1px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:10.5px;font-weight:700;font-style:normal;color:var(--acc-text);background:var(--acc-grad)}
.naitem b{color:var(--text-strong);font-weight:600}
.naopen{display:block;width:100%;margin-top:14px;padding:9px 0;border-radius:var(--r-md);
  font-size:12.5px;font-weight:600;color:var(--acc-text);background:var(--acc-grad)}
.naqr{width:140px;height:140px;margin:14px auto 6px;padding:8px;background:#fff;border-radius:var(--r-md)}
.naqr svg{display:block;width:100%;height:100%}
.naqrcap{font-size:11px;color:var(--fainter)}
.natopic{display:flex;gap:7px;margin-top:12px}
.natopic input{flex:1;min-width:0;padding:9px 11px;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  color:var(--text);background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-md);text-align:center}
.natopic button{padding:9px 12px;font-size:11.5px;border-radius:var(--r-md);color:var(--text-soft);
  border:1px solid var(--line-strong);background:var(--surface)}
.natopic button:hover{background:var(--surface2);color:var(--text)}
.nawarn{margin-top:12px;padding:9px 11px;font-size:11.5px;line-height:1.5;color:var(--text-soft);
  background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-md);text-align:left}
.narow{display:flex;align-items:center;gap:8px;margin-top:16px}
.narow .nasp{flex:1}
.narow button{padding:8px 15px;border-radius:var(--r-md);font-size:12.5px;transition:background-color .15s ease,color .15s ease}
.naback,.naskip{color:var(--faint)}
.naback:hover,.naskip:hover{color:var(--text-soft)}
.naback.hide,.naskip.hide,.nanext.hide{display:none}
.nanext{color:var(--acc-text);background:var(--acc-grad);font-weight:600}
.nanext:hover{filter:brightness(1.08)}

/* ---------- notifications: config sheet ---------- */
.notifcfg{position:absolute;inset:0;z-index:50;display:none;background:var(--bg)}
.notifcfg.show{display:flex;flex-direction:column;animation:dcLbFade .18s ease}
.nchead{display:flex;align-items:center;gap:12px;padding:16px 22px;border-bottom:1px solid var(--line-soft)}
.nctitle{flex:1;font-size:14px;font-weight:650;color:var(--text-strong)}
.ncclose{width:28px;height:28px;border-radius:var(--r-sm);color:var(--dim);display:flex;align-items:center;justify-content:center}
.ncclose:hover{background:var(--surface2);color:var(--text)}
.ncbody{flex:1;min-height:0;overflow-y:auto;padding:4px 22px 26px}
.ncsec{margin:20px 0 8px;font-size:10.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.ncdesc{font-size:11.5px;line-height:1.55;color:var(--faint);margin-bottom:10px}
.ncperm{font-size:11.5px;line-height:1.5}
.ncperm.warn{margin-top:14px;padding:9px 11px;color:var(--text-soft);background:var(--surface);
  border:1px solid var(--line-strong);border-radius:var(--r-md)}
.ncperm button{margin-top:7px;padding:5px 11px;font-size:11.5px;border-radius:var(--r-sm);
  color:var(--acc-text);background:var(--acc-grad);font-weight:600}
/* master switch */
.ncmaster{position:relative;display:inline-flex;align-items:center;cursor:pointer}
.ncmaster input{position:absolute;opacity:0;width:0;height:0}
.ncmaster span{width:36px;height:20px;border-radius:10px;background:var(--surface2);border:1px solid var(--line-strong);
  transition:background-color .18s ease,border-color .18s ease}
.ncmaster span::after{content:'';position:absolute;top:4px;left:4px;width:12px;height:12px;border-radius:50%;
  background:var(--faint);transition:transform .18s var(--ease-pop),background-color .18s ease}
.ncmaster input:checked+span{background:rgba(var(--glow),.25);border-color:var(--acc1)}
.ncmaster input:checked+span::after{transform:translateX(16px);background:var(--acc1)}
/* event grid */
.nclegend,.ncrow{display:grid;grid-template-columns:1fr 62px 62px;align-items:center;gap:6px}
.nclegend{padding:0 0 7px;font-size:10px;letter-spacing:.04em;text-transform:uppercase;color:var(--fainter);text-align:center}
.nclegend .nclabel{text-align:left}
.ncrow{padding:9px 0;border-top:1px solid var(--line-soft)}
.ncrow .nclabel{font-size:12.5px;color:var(--text-soft)}
.ncrow .ncsub{display:block;font-size:10.5px;color:var(--fainter)}
.ncbox{justify-self:center;width:22px;height:22px;border-radius:6px;display:flex;align-items:center;justify-content:center;
  border:1px solid var(--line-strong);background:var(--surface);color:transparent;
  transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.ncbox svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2.6}
.ncbox:hover{border-color:var(--dim)}
.ncbox.on{background:var(--acc-grad);border-color:transparent;color:var(--acc-text)}
.notifcfg.off .ncevents,.notifcfg.off .nctopicrow,.notifcfg.off .ncbtns,.notifcfg.off .ncapps,
.notifcfg.off .ncsearch,.notifcfg.off .ncmuted{opacity:.4;pointer-events:none}
/* topic */
.nctopicrow{display:flex;gap:8px}
.nctopic{flex:1;min-width:0;padding:9px 11px;font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;
  color:var(--text-soft);background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-md)}
.nccopy,.ncregen,.nctest{padding:9px 13px;font-size:11.5px;border-radius:var(--r-md);color:var(--text-soft);
  border:1px solid var(--line-strong);background:var(--surface);transition:background-color .15s ease,color .15s ease}
.nccopy:hover,.ncregen:hover,.nctest:hover{background:var(--surface2);color:var(--text)}
.ncbtns{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.ncapps{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.ncapps .ncappweb{grid-column:1 / -1}
@media (max-width:420px){.ncapps{grid-template-columns:1fr}}
.ncapp{display:flex;align-items:center;gap:10px;padding:10px 11px;text-decoration:none;
  background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-md);
  transition:background-color .15s ease,border-color .15s ease,transform .15s ease}
.ncapp:hover{background:var(--surface2);border-color:rgba(var(--glow),.45);transform:translateY(-1px)}
.ncapp svg{flex:none;width:17px;height:17px;stroke:var(--acc-soft);fill:none;stroke-width:1.7}
.ncapp span{display:flex;flex-direction:column;min-width:0;font-size:10.5px;color:var(--fainter);line-height:1.35}
.ncapp b{font-size:12px;font-weight:600;color:var(--text-soft)}
.ncregen:hover{color:var(--heart);border-color:var(--heart)}
/* mute list */
.ncsearch{width:100%;padding:9px 11px;font-size:12.5px;color:var(--text);background:var(--surface);
  border:1px solid var(--line-strong);border-radius:var(--r-md)}
.ncsearch::placeholder{color:var(--fainter)}
.ncresults:not(:empty){margin-top:6px;border:1px solid var(--line-soft);border-radius:var(--r-md);overflow:hidden}
.ncresults button,.ncmuted .ncm{display:flex;align-items:center;gap:9px;width:100%;text-align:left;
  padding:8px 11px;font-size:12.5px;color:var(--text-soft);transition:background-color .12s ease}
.ncresults button:hover{background:var(--surface2);color:var(--text)}
.ncmuted{margin-top:8px}
.ncmuted .ncm{border-top:1px solid var(--line-soft)}
.ncmuted .ncm .ncx{margin-left:auto;font-size:11px;color:var(--fainter)}
.ncmuted .ncm .ncx:hover{color:var(--heart)}
.ncava{flex:none;width:22px;height:22px;border-radius:7px;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:650;color:#101012;border:1px solid var(--line-soft)}
.ncempty{padding:10px 0;font-size:11.5px;color:var(--fainter)}
@media (prefers-reduced-motion:reduce){.notifask.show,.nacard,.notifcfg.show{animation:none}}

/* ---------- moderator confirmation ---------- */
.modconfirm{position:absolute;inset:0;z-index:48;display:none;align-items:center;justify-content:center;
  padding:24px;background:rgba(8,8,8,.72);backdrop-filter:blur(3px)}
.modconfirm.show{display:flex;animation:dcLbFade .18s ease}
.mccard{width:100%;max-width:320px;padding:20px;background:var(--menu-bg);
  border:1px solid var(--line-strong);border-radius:var(--r-lg);
  box-shadow:0 18px 60px rgba(0,0,0,.55),inset 0 1px 0 var(--top-glint);
  animation:dcLbIn .2s var(--ease-out)}
.mctitle{font-size:14px;font-weight:650;color:var(--text-strong);margin-bottom:6px}
.mctext{font-size:12.5px;line-height:1.55;color:var(--text-soft)}
.mcquote{margin-top:10px;padding:8px 10px;font-size:12px;line-height:1.5;color:var(--faint);
  background:var(--surface);border-left:2px solid var(--line-strong);border-radius:0 var(--r-sm) var(--r-sm) 0;
  max-height:66px;overflow:hidden}
.mcrow{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}
.mcrow button{padding:7px 14px;border-radius:var(--r-md);font-size:12px;transition:background-color .15s ease,color .15s ease}
.mccancel{color:var(--text-soft);border:1px solid var(--line-strong);background:var(--surface)}
.mccancel:hover{background:var(--surface2)}
.mcok{color:#fff;background:var(--heart);font-weight:600}
.mcok:hover{filter:brightness(1.1)}
.mcok.edit{color:var(--acc-text);background:var(--acc-grad)}
@media (prefers-reduced-motion:reduce){.modconfirm.show,.mccard{animation:none}}

/* ---------- onboarding tour ---------- */
.onboard{position:absolute;inset:0;z-index:47;display:none;align-items:center;justify-content:center;
  padding:24px;background:rgba(8,8,8,.72);backdrop-filter:blur(4px)}
.onboard.show{display:flex;animation:dcLbFade .25s ease}
.onboard.closing{animation:dcLbFade .18s ease reverse forwards}
.onboard.closing .obcard{animation:dcLbOut .18s ease forwards}
.obcard{width:100%;max-width:330px;padding:26px 24px 18px;text-align:center;
  background:var(--menu-bg);border:1px solid var(--line-strong);border-radius:var(--r-lg);
  box-shadow:0 20px 70px rgba(0,0,0,.55),inset 0 1px 0 var(--top-glint);
  animation:dcLbIn .3s var(--ease-out)}
.obicon{width:52px;height:52px;margin:0 auto 14px;border-radius:14px;
  display:flex;align-items:center;justify-content:center;
  background:rgba(var(--glow),.12);border:1px solid rgba(var(--glow),.28);
  box-shadow:0 6px 22px rgba(var(--glow),.18)}
.obicon svg{width:24px;height:24px;stroke:var(--acc-soft);fill:none;stroke-width:1.8}
.obtitle{font-size:15px;font-weight:650;color:var(--text-strong);margin-bottom:6px}
.obtext{font-size:12.5px;line-height:1.6;color:var(--text-soft);min-height:60px}
/* step change: slide the words, keep the card still */
.obswap{animation:dcObSwap .24s ease}
@keyframes dcObSwap{from{opacity:0;transform:translateX(10px)}}
.obswap.back{animation:dcObSwapB .24s ease}
@keyframes dcObSwapB{from{opacity:0;transform:translateX(-10px)}}
.obdots{display:flex;justify-content:center;gap:6px;margin:16px 0 14px}
.obdots i{width:6px;height:6px;border-radius:3px;background:var(--line-strong);transition:background-color .2s ease,width .2s ease}
.obdots i.on{width:16px;background:var(--acc1)}
.obrow{display:flex;align-items:center;gap:8px}
.obrow .obsp{flex:1}
.obrow button{padding:7px 14px;border-radius:var(--r-md);font-size:12px;transition:background-color .15s ease,color .15s ease,transform .12s ease}
.obrow button:active{transform:scale(.96)}
.obskip{color:var(--faint)}
.obskip:hover{color:var(--text-soft)}
.obback{color:var(--text-soft);border:1px solid var(--line-strong);background:var(--surface)}
.obback:hover{background:var(--surface2)}
.obback.hide{visibility:hidden}
.obnext{color:var(--acc-text);background:var(--acc-grad);font-weight:600;
  box-shadow:0 3px 12px rgba(var(--glow),.3)}
.obnext:hover{filter:brightness(1.08)}
@media (prefers-reduced-motion:reduce){.onboard.show,.onboard.closing,.onboard.closing .obcard,.obcard,.obswap{animation:none}}

/* ---------- screenshot annotator ---------- */
.annot{position:absolute;inset:0;z-index:46;display:none;flex-direction:column;background:rgba(8,8,8,.9);backdrop-filter:blur(3px)}
.annot.show{display:flex;animation:dcLbFade .2s ease}
.annot.show .anwrap{animation:dcLbIn .22s var(--ease-out)}
.annot.closing{animation:dcLbFade .16s ease reverse forwards}
.annot.closing .anwrap{animation:dcLbOut .16s ease forwards}
.anhead{display:flex;align-items:center;gap:7px;padding:12px 14px;border-bottom:1px solid var(--line-soft)}
.antitle{font-size:12.5px;font-weight:650;color:var(--text-strong);margin-right:6px}
.anhead button{display:flex;align-items:center;gap:6px;padding:7px 13px;border-radius:var(--r-md);font-size:12px;
  color:var(--text-soft);border:1px solid var(--line-strong);background:var(--surface);
  transition:background-color .15s ease,color .15s ease,transform .12s ease}
.anhead button svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2}
.anhead button:hover:not(:disabled){background:var(--surface2);color:var(--text)}
.anhead button:active:not(:disabled){transform:scale(.96)}
.anhead button:disabled{opacity:.4;cursor:default}
.anhead .antool.on{color:var(--acc-text);background:var(--acc-grad);border-color:transparent;
  box-shadow:0 2px 10px rgba(var(--glow),.35)}
.anhead .ansp{flex:1}
.anhead .ansave{color:var(--acc-text);background:var(--acc-grad);border-color:transparent;font-weight:600}
.anwrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:18px}
.ancv{max-width:100%;max-height:100%;border-radius:var(--r-md);border:1px solid var(--line-strong);
  box-shadow:0 12px 50px rgba(0,0,0,.6);cursor:crosshair;touch-action:none}
.anhint{padding:0 14px 12px;text-align:center;font-size:11.5px;color:var(--faint)}

/* ---------- motion (unchanged) ---------- */
@keyframes dcIn{from{opacity:0;transform:translateY(16px) scale(.97)}to{opacity:1;transform:none}}
.item.anim{animation:dcIn .32s cubic-bezier(.32,.72,.22,1)}
@keyframes dcOut{to{opacity:0;transform:translateX(24px);max-height:0;padding-top:0;padding-bottom:0}}
.item.gone{overflow:hidden;max-height:200px;animation:dcOut .28s ease forwards}
@keyframes dcPop{50%{transform:scale(.86)}}
.send.pop{animation:dcPop .25s ease}
@media (prefers-reduced-motion:reduce){.item.anim,.item.gone,.send.pop{animation:none}}

/* ---------- typing ---------- */
.typing{display:flex;align-items:center;gap:8px;padding:0 22px;color:var(--dim);font-size:12px;
  max-height:0;opacity:0;overflow:hidden;transition:max-height .25s ease,opacity .2s ease,padding .25s ease}
.typing.show{max-height:32px;opacity:1;padding:4px 22px 8px}
.tdots{display:inline-flex;gap:3px}
.tdots i{width:5px;height:5px;border-radius:50%;background:var(--acc-soft);animation:dcDot 1.2s infinite ease-in-out}
.tdots i:nth-child(2){animation-delay:.15s}
.tdots i:nth-child(3){animation-delay:.3s}
@keyframes dcDot{0%,60%,100%{transform:translateY(0);opacity:.4}30%{transform:translateY(-4px);opacity:1}}

/* ---------- GIF picker ---------- */
.gifbtn{flex:none;align-self:center;margin:0 2px 0 0;padding:3px 7px;border-radius:var(--r-sm);
  font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--faint);
  border:1px solid var(--line-strong);
  transition:color .15s ease,border-color .15s ease,background-color .15s ease}
.gifbtn:hover,.gifbtn.on{color:var(--acc-soft);border-color:var(--acc1);background:var(--surface2)}
.gifpicker{display:grid;grid-template-rows:0fr;margin-bottom:0;
  border:0 solid transparent;border-radius:var(--r-md);background:transparent;
  overflow:hidden;opacity:0;transform:translateY(6px) scale(.99);
  transition:grid-template-rows .26s cubic-bezier(.32,.72,.22,1),
             opacity .18s ease,transform .26s cubic-bezier(.32,.72,.22,1),
             margin-bottom .26s cubic-bezier(.32,.72,.22,1),
             border-width .26s cubic-bezier(.32,.72,.22,1),
             border-color .2s ease;
  pointer-events:none}
.gifpicker>.gifinner{min-height:0;overflow:hidden}
.gifpicker.show{grid-template-rows:1fr;margin-bottom:12px;opacity:1;transform:none;
  border-width:1px;border-color:var(--line-strong);background:var(--surface);
  pointer-events:auto}
/* thumbnails settle in a beat after the panel has opened */
@keyframes dcGifIn{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:none}}
.gifpicker.show .gifgrid img{animation:dcGifIn .22s ease backwards}
@media (prefers-reduced-motion:reduce){
  .gifpicker{transition:none}
  .gifpicker.show .gifgrid img{animation:none}
}
.gifhead{display:flex;align-items:center;border-bottom:1px solid var(--line-soft)}
.gifq{flex:1;min-width:0;padding:9px 12px;font-size:13px;color:var(--text);background:none}
.gifclose{flex:none;width:28px;height:28px;margin-right:5px;border-radius:var(--r-sm);
  color:var(--dim);display:flex;align-items:center;justify-content:center;
  transition:color .15s ease,background-color .15s ease}
.gifclose:hover{color:var(--text);background:var(--surface2)}
.gifq::placeholder{color:var(--fainter)}
.gifgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:5px;padding:7px;
  max-height:300px;overflow-y:auto;scrollbar-width:thin;scrollbar-color:var(--line-strong) transparent}
.gifgrid::-webkit-scrollbar{width:6px}
.gifgrid::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:3px}
.gifgrid img{width:100%;aspect-ratio:1;height:auto;object-fit:cover;border-radius:var(--r-sm);cursor:pointer;
  background:var(--surface2);transition:outline-color .12s ease;outline:2px solid transparent}
.gifgrid img:hover{outline-color:var(--acc1)}
.gifnote{grid-column:1/-1;padding:18px 6px;text-align:center;font-size:12px;color:var(--faint)}

/* ---------- compose ---------- */
.compose{border-top:1px solid var(--line);padding:14px 22px 16px;background:var(--compose-bg)}
.replyto{display:none;align-items:center;gap:6px;font-size:12px;color:var(--dim);margin-bottom:10px;
  background:rgba(var(--glow),.08);border-left:2px solid var(--acc1);border-radius:0 var(--r-sm) var(--r-sm) 0;padding:7px 11px}
.replyto b{color:var(--text);font-weight:600}
.replyto button{color:var(--acc-soft);font-size:12px;margin-left:auto;padding:2px 7px;border-radius:var(--r-sm)}
.replyto button:hover{background:var(--surface2)}
.composebar{display:flex;align-items:flex-end;gap:8px}
.meava{flex:none;width:46px;height:46px;align-self:flex-end;
  border-radius:var(--r-ava);display:flex;align-items:center;justify-content:center;
  font-size:14px;font-weight:650;color:#101012;border:1px solid var(--line-soft)}
.inputrow{flex:1;display:flex;align-items:flex-end;gap:8px;min-height:46px;background:var(--surface);
  border:1px solid var(--line-strong);border-radius:var(--r-lg);padding:6px 6px 6px 14px;
  transition:border-color .15s,box-shadow .15s}
.inputrow:focus-within{border-color:var(--acc1);box-shadow:0 0 0 3px rgba(var(--glow),.14)}
.text{flex:1;resize:none;font-size:13.5px;color:var(--text);line-height:1.45;padding:6px 0;
  overflow-y:hidden}
.text::placeholder{color:var(--fainter)}
.send{flex:none;width:32px;height:32px;border-radius:var(--r-md);
  background:var(--acc-grad);
  box-shadow:0 2px 10px rgba(var(--glow),.22);
  display:flex;align-items:center;justify-content:center;transition:filter .15s ease,box-shadow .15s ease,transform .1s ease}
.send:hover{filter:brightness(1.1);box-shadow:0 3px 14px rgba(var(--glow),.35)}
.send:active{transform:scale(.94)}
.send svg{width:15px;height:15px;stroke:var(--acc-text);stroke-width:2.4;fill:none}
.hint{font-size:10.5px;color:var(--hint);margin-top:9px;text-align:center;letter-spacing:.01em}
.hint kbd{font:inherit;font-size:10px;font-weight:600;color:var(--faint);padding:0 4px;border-radius:4px;
  background:var(--surface);border:1px solid var(--line);box-shadow:0 1px 0 var(--line)}
.hint span{margin:0 3px;color:var(--fainter)}
/* image attach */
.imgbtn{flex:none;align-self:center;margin:0 2px 0 0;padding:5px 7px;border-radius:var(--r-sm);
  color:var(--faint);border:1px solid transparent;display:flex;align-items:center;transition:color .15s ease,border-color .15s ease,background-color .15s ease}
.imgbtn:hover{color:var(--acc-soft);border-color:var(--acc1);background:var(--surface2)}
/* formatting bar: slides open while you write */
.compose{position:relative}
.fmtbar{display:flex;align-items:center;gap:2px;margin:0 0 0 54px;height:0;opacity:0;overflow:hidden;
  transform:translateY(4px);transition:height .24s cubic-bezier(.32,.72,.22,1),opacity .18s ease,transform .24s cubic-bezier(.32,.72,.22,1),margin .24s ease}
.compose.writing .fmtbar{height:30px;opacity:1;transform:none;margin-bottom:6px}
.fmtbar button{height:26px;min-width:28px;padding:0 7px;border-radius:7px;display:flex;align-items:center;justify-content:center;
  font-size:12.5px;color:var(--faint);transition:background .12s ease,color .12s ease,transform .12s ease}
.fmtbar button:hover{background:var(--surface2);color:var(--text-strong)}
.fmtbar button:active{transform:scale(.92)}
.fmtbar button b{font-weight:800}
.fmtbar button i{font-family:Georgia,serif;font-style:italic;font-size:13.5px}
.fmtbar svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2}
.fmtbar svg circle{fill:currentColor;stroke:none}
.fmt-sep{width:1px;height:14px;background:var(--line-strong);margin:0 5px}
/* @mention picker */
.mentionpop{position:absolute;left:76px;right:22px;bottom:calc(100% - 6px);z-index:8;padding:5px;
  background:linear-gradient(var(--menu-bg),var(--menu-bg)),var(--bg);
  border:1px solid var(--line-strong);border-radius:var(--r-lg);box-shadow:0 18px 44px rgba(0,0,0,.45),inset 0 1px 0 var(--top-glint);
  opacity:0;transform:translateY(6px) scale(.98);transform-origin:bottom left;pointer-events:none;
  transition:opacity .15s ease,transform .22s cubic-bezier(.32,.72,.22,1)}
.mentionpop.show{opacity:1;transform:none;pointer-events:auto}
.mentionpop .mp-h{padding:6px 9px 5px;font-size:10.5px;color:var(--faint)}
.mentionpop .mp-it{width:100%;display:flex;align-items:center;gap:9px;padding:6px 9px;border-radius:var(--r-sm);text-align:left;
  font-size:12.5px;color:var(--text-soft);transition:background .1s ease}
.mentionpop .mp-it.sel{background:var(--surface2);color:var(--text-strong)}
.mentionpop .mp-av{width:24px;height:24px;flex:none;border-radius:7px;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;color:#101012}
.mentionpop .mp-nm{flex:1}
.mentionpop .mp-it em{font-style:normal;font-size:10.5px;font-weight:650;color:#3ecf8e}
.mentionpop mark{background:none;color:var(--acc-soft);font-weight:700}
/* drop an image anywhere on the panel */
.dropzone{position:absolute;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;pointer-events:none;
  background:rgba(var(--glow),.06);border:2px dashed rgba(var(--glow),.45);border-radius:var(--r-lg);opacity:0;transition:opacity .15s ease}
.dropzone .dz-card{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:var(--r-lg);font-size:13px;font-weight:600;
  color:var(--text-strong);background:var(--menu-bg);border:1px solid var(--line-strong);box-shadow:0 18px 44px rgba(0,0,0,.45);
  transform:scale(.96);transition:transform .25s var(--ease-out)}
.dropzone svg{width:18px;height:18px;stroke:var(--acc-soft);fill:none;stroke-width:2}
.panel.dragging .dropzone{opacity:1}
.panel.dragging .dropzone .dz-card{transform:none}
/* rich text in comments */
.content code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em;padding:1px 5px;border-radius:5px;
  color:var(--text-strong);background:var(--surface2);border:1px solid var(--line)}
.content b,.content strong{color:var(--text-strong);font-weight:650}
.content .li{display:inline-block;position:relative;padding-left:14px}
.content .li::before{content:"";position:absolute;left:3px;top:.62em;width:4px;height:4px;border-radius:50%;background:var(--acc-soft)}
.content .mention{color:var(--acc-soft);background:rgba(var(--glow),.12);padding:0 4px;border-radius:5px;font-weight:600}
.content .mention.me{color:var(--acc-text);background:var(--acc1)}
.content a.lnk{color:var(--acc-soft);text-decoration:underline;text-decoration-color:rgba(var(--glow),.4);text-underline-offset:2px;word-break:break-all}
.content a.lnk:hover{text-decoration-color:currentColor}

/* ---------- settings page ---------- */
/* title, tabs and close sit in one sticky bar so the header never scrolls off */
.stitle{font-size:14px;font-weight:650;color:var(--text-strong);letter-spacing:-.01em}
.sclose{flex:none;width:26px;height:26px;border-radius:var(--r-sm);color:var(--dim);
  display:flex;align-items:center;justify-content:center;border:1px solid var(--line-soft);
  transition:color .15s ease,background-color .15s ease,border-color .15s ease}
.sclose:hover{color:var(--text);background:var(--surface2);border-color:var(--line-strong)}
.sheadtop{display:flex;align-items:center;justify-content:space-between;padding:2px 0 12px}
.snav{display:flex;gap:2px;padding:3px;background:var(--surface);
  border:1px solid var(--line-soft);border-radius:var(--r-md)}
.snavb{flex:1;padding:7px 0;border-radius:calc(var(--r-md) - 3px);font-size:11.5px;font-weight:600;
  color:var(--faint);white-space:nowrap;
  transition:color .15s ease,background-color .15s ease}
.snavb:hover{color:var(--text-soft)}
.snavb.sel{color:var(--text-strong);background:var(--tab-active);
  box-shadow:0 1px 3px rgba(0,0,0,.28),inset 0 1px 0 var(--top-glint)}
.sgroup[hidden]{display:none}
.spage{display:none;flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;
  padding:4px 22px 28px;scrollbar-width:thin;scrollbar-color:var(--line-strong) transparent}
.spage::-webkit-scrollbar{width:6px}
.spage::-webkit-scrollbar-thumb{background:var(--line-strong);border-radius:3px}
.panel.settings-open .spage{display:block;animation:spIn .28s cubic-bezier(.32,.72,.22,1)}
.panel.settings-open .list,.panel.settings-open .typing,
.panel.settings-open .compose,.panel.settings-open .auth{display:none}
@keyframes spIn{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
@keyframes spBack{from{opacity:0;transform:translateX(-28px)}to{opacity:1;transform:none}}
.panel.returning .list{animation:spBack .28s cubic-bezier(.32,.72,.22,1)}
.panel.returning .compose,.panel.returning .auth{animation:spBack .28s cubic-bezier(.32,.72,.22,1)}
@media (prefers-reduced-motion:reduce){.panel.settings-open .spage,.panel.returning .list,.panel.returning .compose,.panel.returning .auth{animation:none}}
.shead{position:sticky;top:0;z-index:3;padding:12px 0 14px;background:var(--bg);
  box-shadow:0 10px 12px -10px rgba(0,0,0,.5)}
.sgroup{padding:22px 0;border-bottom:1px solid var(--line-soft)}
.sgroup:last-child{border-bottom:0}
.sname{font-size:13px;font-weight:600;color:var(--text-strong);display:flex;justify-content:space-between;align-items:baseline}
.sname b{color:var(--acc-soft);font-weight:600;font-variant-numeric:tabular-nums;font-size:12px}
.sdesc{font-size:11.5px;color:var(--faint);margin:4px 0 14px;line-height:1.5}
.snamerow{display:flex;gap:10px}
.dname{flex:1;background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-md);
  padding:8px 12px;font-size:13px;color:var(--text);transition:border-color .15s,box-shadow .15s}
.dname:focus{border-color:var(--acc1);box-shadow:0 0 0 3px rgba(var(--glow),.14)}
.dsave{flex:none;height:38px;padding:0 18px;border-radius:var(--r-md);font-size:12.5px;font-weight:600;color:var(--acc-text);
  background:var(--acc-grad);
  box-shadow:0 3px 12px rgba(var(--glow),.35),inset 0 1px 0 rgba(255,255,255,.25);
  transition:filter .15s ease,background-color .2s ease,transform .1s ease}
.dsave:hover{filter:brightness(1.1)}
.dsave:active{transform:scale(.97)}
.dsave.ok{background:var(--live);box-shadow:0 3px 12px rgba(93,211,158,.35)}
.serr{display:none;font-size:11.5px;color:var(--heart);margin-top:8px}
.serr.show{display:block}
/* profile picture */
.pfprow{display:flex;align-items:center;gap:10px}
.pfpprev{flex:none;width:44px;height:44px;border-radius:var(--r-ava);display:flex;align-items:center;justify-content:center;
  font-size:16px;font-weight:650;color:#101012;background:var(--surface2);
  background-size:cover;background-position:center;border:1px solid var(--line-soft)}
.pfpup{padding:7px 14px;border-radius:var(--r-md);font-size:12.5px;font-weight:600;color:var(--acc-text);
  background:var(--acc-grad);box-shadow:0 3px 12px rgba(var(--glow),.35),inset 0 1px 0 rgba(255,255,255,.25);
  transition:filter .15s ease,transform .1s ease}
.pfpup:hover{filter:brightness(1.1)}
.pfpup:active{transform:scale(.97)}
.pfprm{display:none;padding:7px 12px;border-radius:var(--r-md);font-size:12.5px;color:var(--dim);background:var(--surface2);transition:color .15s ease}
.pfprm.show{display:block}
.pfprm:hover{color:var(--heart)}

/* panel background controls */
.bgrow{display:flex;align-items:center;gap:12px}
.bgprev{flex:none;width:76px;height:48px;border-radius:var(--r-md);overflow:hidden;
  display:flex;align-items:center;justify-content:center;
  background:var(--surface);border:1px solid var(--line-strong);background-size:cover;background-position:center}
.bgprev span{font-size:10.5px;color:var(--fainter)}
.bgprev.has span{display:none}
.bgbtns{display:flex;gap:8px;flex-wrap:wrap}
.bgctl{margin-top:14px}
.bgctl.off{opacity:.45;pointer-events:none}
.bglabel{display:flex;justify-content:space-between;align-items:baseline;
  font-size:11.5px;color:var(--faint);margin:12px 0 6px}
.bglabel b{color:var(--acc-soft);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.bgtintrow{display:flex;align-items:center;gap:10px}
/* the panel has no native slider style, so give range inputs the dark one */
.rng{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:3px;
  background:var(--surface2);border:1px solid var(--line-soft);outline:none;cursor:pointer}
.rng::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:15px;height:15px;
  border-radius:50%;background:var(--acc1);border:2px solid var(--bg);cursor:pointer;
  box-shadow:0 1px 5px rgba(0,0,0,.45);transition:transform .12s ease}
.rng::-webkit-slider-thumb:hover{transform:scale(1.12)}
.rng::-moz-range-thumb{width:13px;height:13px;border-radius:50%;background:var(--acc1);
  border:2px solid var(--bg);cursor:pointer;box-shadow:0 1px 5px rgba(0,0,0,.45)}
.rng:focus-visible{box-shadow:0 0 0 3px rgba(var(--glow),.18)}
.bgtint{width:46px;height:30px;padding:0;border:1px solid var(--line-strong);border-radius:var(--r-sm);
  background:var(--surface);cursor:pointer}
.bgtintclear{padding:6px 11px;border-radius:var(--r-sm);font-size:11.5px;color:var(--dim);
  border:1px solid var(--line);transition:color .12s ease,border-color .12s ease}
.bgtintclear:hover{color:var(--text);border-color:var(--line-strong)}
/* Image and tint are their own layers at the very back. ::after is already
   taken by the texture lines, and the layers must be excluded from the
   stacking rule below or they end up on top of the comments. */
/* the wrapper clips the scaled-up image: without it the blur overscan spills
   out past the panel and shows beside it */
.bgwrap{position:absolute;inset:0;z-index:0;overflow:hidden;pointer-events:none;display:none;
  border-radius:inherit}
.panel.has-bg .bgwrap{display:block}
.bgimglayer,.bgtintlayer,.bgglass{position:absolute;inset:0;pointer-events:none}
/* One frosted sheet for the whole panel, on a layer that never animates.
   Glass used to live on each region (list, settings, views); fading or
   sliding a region in also faded its glass, so every view switch flashed
   the raw image. Now regions are transparent and only fade their content. */
.bgglass{background:var(--glass)}
.bgimglayer{background-image:var(--bg-img,none);background-size:cover;background-position:center;
  filter:blur(var(--bg-blur,0px));transform:scale(1.08)}   /* overscan for the blur */
.bgtintlayer{background:var(--bg-tint,transparent);opacity:var(--bg-op,0)}
/* Name the content elements explicitly. A blanket child selector also caught
   .resizer, which is absolutely positioned \u2014 forcing it relative dropped it
   into the flex column and pushed the whole panel down. */
.panel.has-bg>.head,.panel.has-bg>.tabs,.panel.has-bg>.searchrow,.panel.has-bg>.list,
.panel.has-bg>.typing,.panel.has-bg>.compose,.panel.has-bg>.auth{position:relative;z-index:1}
.panel.has-bg>.spage{position:relative;z-index:1}   /* the only child without its own */
/* Glass: every surface becomes a frosted sheet over the image rather than
   either hiding it or leaving text on bare photo. --glass is the panel colour
   at partial opacity, so it follows the theme. */
.panel.has-bg{--glass:color-mix(in srgb,var(--bg) 74%,transparent);
  --glass-soft:color-mix(in srgb,var(--bg) 52%,transparent);
  --glass-solid:color-mix(in srgb,var(--bg) 80%,transparent)}
.panel.has-bg .head,.panel.has-bg .typing,.panel.has-bg .list,.panel.has-bg .spage{background:transparent}
/* the composer and sign-in box sit a shade firmer, still without a filter of
   their own, so a fade only ever reveals the sheet underneath */
.panel.has-bg .compose,.panel.has-bg .auth{background:color-mix(in srgb,var(--bg) 35%,transparent)}
.panel.has-bg .searchrow{background:color-mix(in srgb,var(--bg) 45%,transparent)}
.panel.has-bg .tabs{background:color-mix(in srgb,var(--bg) 40%,transparent);
  border-color:color-mix(in srgb,var(--line) 70%,transparent)}
.panel.has-bg .tabs.glided .tab.active{background:transparent;box-shadow:none}
.panel.has-bg .tabs .glide{background:color-mix(in srgb,var(--tab-active) 85%,transparent)}
.panel.has-bg .tab.active,.panel.has-bg .snavb.sel,.panel.has-bg .nfsubb.sel{
  background:color-mix(in srgb,var(--tab-active) 85%,transparent)}
/* The settings page already carries a sheet, so its header adds nothing but a
   divider \u2014 tinting it again turned the whole block into a dark box. */
.panel.has-bg .shead{background:color-mix(in srgb,var(--bg) 55%,transparent);backdrop-filter:blur(12px);
  border-bottom:1px solid var(--line-soft)}
.panel.has-bg .snav,.panel.has-bg .nfsub{background:color-mix(in srgb,var(--bg) 34%,transparent)}
/* raise contrast a touch so small grey text survives a busy photo */
.panel.has-bg .content,.panel.has-bg .nftxt{text-shadow:0 1px 2px rgba(0,0,0,.55)}
.panel.has-bg .author,.panel.has-bg .stitle,.panel.has-bg .sub{text-shadow:0 1px 3px rgba(0,0,0,.6)}
/* One frosted sheet for the whole thread \u2014 individual rows stay transparent.
   Giving rows their own glass made every collapsed row read as a floating card
   and boxed the replies off from their parent. */
.panel.has-bg .collapsed{opacity:1}
.panel.has-bg .collapsed .cname{color:var(--text-soft)}
.panel.has-bg .collapsed .ctxt{color:var(--dim)}
.panel.has-bg .collapsed .cundo{color:var(--dim)}
.panel.has-bg .collapsed:hover{background:color-mix(in srgb,var(--bg) 42%,transparent)}
.panel.has-bg .dwrap .item{opacity:1}
.panel.has-bg .dbar{color:var(--text-soft)}

/* account rows */
.acctrow{display:flex;gap:10px;margin-bottom:10px;align-items:center}
.acctrow input{flex:1;min-width:0;background:var(--surface);border:1px solid var(--line-strong);
  border-radius:var(--r-md);padding:10px 12px;font-size:13px;color:var(--text);
  transition:border-color .15s ease,box-shadow .15s ease}
.acctrow input:focus{border-color:var(--acc1);box-shadow:0 0 0 3px rgba(var(--glow),.14)}
.acctlabel{font-size:11px;color:var(--faint);margin:14px 0 6px}
.acctbtn{flex:none;height:38px;padding:0 16px;border-radius:var(--r-md);font-size:12.5px;font-weight:600;
  color:var(--acc-text);background:var(--acc-grad);transition:filter .15s ease}
.acctbtn:hover{filter:brightness(1.1)}
.acctbtn.ok{background:var(--live)}
.dangerbtn{width:100%;padding:11px 0;margin-top:16px;border-radius:var(--r-md);font-size:12.5px;
  color:var(--heart);border:1px solid var(--line-strong);background:none;
  transition:background-color .15s ease,color .15s ease,border-color .15s ease}
.dangerbtn:hover{background:var(--heart);color:#fff;border-color:var(--heart)}
.acctnote{font-size:11.5px;margin-top:6px;display:none}
.acctnote.show{display:block}
.acctnote.err{color:var(--heart)}
.acctnote.good{color:var(--live)}

/* segmented choices */
.segrow{display:flex;gap:6px}
.seg{flex:1;padding:8px 0;border:1px solid var(--line-strong);border-radius:var(--r-md);
  font-size:12px;font-weight:550;color:var(--dim);
  transition:color .15s ease,background-color .15s ease,border-color .15s ease}
.seg:hover{color:var(--text-soft);background:var(--surface2)}
.seg.sel{color:var(--text-strong);background:var(--surface2);border-color:var(--acc1)}

/* colour pickers */
.colorrow{display:flex;align-items:center;gap:10px}
.swatchwrap{position:relative;flex:none;width:38px;height:38px;border-radius:var(--r-md);
  overflow:hidden;border:1px solid var(--line-strong)}
.swatchwrap input{position:absolute;inset:-6px;width:calc(100% + 12px);height:calc(100% + 12px);
  padding:0;border:0;cursor:pointer;background:none}
.hexin{flex:1;min-width:0;background:var(--surface);border:1px solid var(--line-strong);
  border-radius:var(--r-md);padding:10px 12px;font-size:13px;color:var(--text);
  font-variant-numeric:tabular-nums;text-transform:lowercase;
  transition:border-color .15s ease,box-shadow .15s ease}
.hexin:focus{border-color:var(--acc1);box-shadow:0 0 0 3px rgba(var(--glow),.14)}
.resetcol{flex:none;font-size:11px;color:var(--dim);padding:8px 10px;border-radius:var(--r-sm);
  transition:color .15s ease,background-color .15s ease}
.resetcol:hover{color:var(--text);background:var(--surface2)}

/* text size stepper */
.scalerow{display:flex;align-items:center;gap:10px}
.scdown,.scup,.mddown,.mdup{flex:none;width:30px;height:30px;border:1px solid var(--line-strong);
  border-radius:var(--r-md);color:var(--text);font-size:15px;line-height:1;
  display:flex;align-items:center;justify-content:center;
  transition:background-color .15s ease,border-color .15s ease}
.scdown:hover,.scup:hover,.mddown:hover,.mdup:hover{background:var(--surface2);border-color:var(--acc1)}
.scdown:disabled,.scup:disabled,.mddown:disabled,.mdup:disabled{opacity:.35;cursor:default}
.scbar{flex:1;height:3px;background:var(--line-strong);position:relative;overflow:hidden}
.scbar span{position:absolute;left:0;top:0;bottom:0;background:var(--acc1);
  width:50%;transition:width .18s cubic-bezier(.4,0,.2,1)}
.screset{flex:none;font-size:11px;color:var(--dim);padding:4px 8px;border-radius:var(--r-sm);
  transition:color .15s ease,background-color .15s ease}
.screset:hover{color:var(--text);background:var(--surface2)}

/* ---------- auth ---------- */
.auth{display:none;border-top:1px solid var(--line);padding:18px 22px 20px;background:var(--compose-bg)}
.auth.show{display:block}
.auth h4{font-size:13.5px;font-weight:var(--head-weight);font-family:var(--font-head);
  text-transform:var(--case);letter-spacing:var(--track);color:var(--text-strong);margin-bottom:2px}
.auth .asub{font-size:11.5px;color:var(--faint);margin-bottom:12px}
.auth input{width:100%;background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-md);
  padding:9px 12px;font-size:13px;color:var(--text);margin-bottom:8px;transition:border-color .15s,box-shadow .15s}
.auth input::placeholder{color:var(--fainter)}
.auth input:focus{border-color:var(--acc1);box-shadow:0 0 0 3px rgba(var(--glow),.14)}
.auth .aerr{display:none;font-size:11.5px;color:var(--heart);margin:-2px 0 8px 2px}
.auth .aerr.show{display:block}
.abtn{width:100%;padding:9px 0;border-radius:var(--r-md);font-size:13px;font-weight:600;color:var(--acc-text);
  background:var(--acc-grad);
  box-shadow:0 3px 12px rgba(var(--glow),.35),inset 0 1px 0 rgba(255,255,255,.25);
  transition:filter .15s ease,transform .1s ease}
.abtn:hover{filter:brightness(1.1)}
.abtn:active{transform:scale(.98)}
.aswap{display:block;width:100%;text-align:center;margin-top:10px;font-size:12px;color:var(--acc-soft);padding:4px;border-radius:var(--r-sm)}
.aswap:hover{background:var(--surface)}

@media (prefers-reduced-motion:reduce){.panel,.overlay,.rig,.rigb{transition:none}}
/* any panel width: rows wrap and the composer shrinks instead of overflowing */
.inputrow,.text{min-width:0}
.acts{flex-wrap:wrap;row-gap:2px}
.item,.content,.body{min-width:0}
/* ================= mobile & touch =================
   phones: the panel becomes a full-screen sheet that follows the visible
   viewport (so the on-screen keyboard never covers the composer), respects
   notches and home bars, and swipes away. Touch screens get finger-sized
   targets, always-visible actions and 16px inputs (no iOS focus zoom). */
.panel{top:var(--vvt,0px);bottom:var(--kb,0px)}
@media (max-width:640px){
  .panel{width:100%!important;min-width:0!important;max-width:none;padding-right:0;border-left:0;
    overscroll-behavior:contain}
  .panel.left{border-right:0}
  .panel>.pshadow{display:none}
  .resizer{display:none}
  .head{padding:calc(12px + env(safe-area-inset-top,0px)) calc(14px + env(safe-area-inset-right,0px)) 4px calc(16px + env(safe-area-inset-left,0px))}
  .tabs{margin-left:calc(12px + env(safe-area-inset-left,0px));margin-right:calc(12px + env(safe-area-inset-right,0px))}
  .tab{font-size:12.5px;padding:9px 0}
  .list{padding-left:calc(14px + env(safe-area-inset-left,0px));padding-right:calc(14px + env(safe-area-inset-right,0px))}
  .compose{padding:12px calc(14px + env(safe-area-inset-right,0px)) calc(12px + env(safe-area-inset-bottom,0px)) calc(14px + env(safe-area-inset-left,0px))}
  .searchrow{margin:0 14px}
  .pinmenu{width:min(340px,88vw)}
  .memenu{right:12px;width:min(260px,calc(100vw - 24px))}
  .undotoast{max-width:calc(100vw - 24px);bottom:calc(16px + env(safe-area-inset-bottom,0px))}
  .undotoast .ut-msg{white-space:normal}
  .undotoast .ut-undo kbd{display:none}
  .pinpop.pinfloat{width:auto;left:12px!important;right:12px!important;max-width:none}
  .pintip{max-width:calc(100vw - 24px)}
  .collapsed{width:calc(100% + 28px + env(safe-area-inset-left,0px) + env(safe-area-inset-right,0px));
    margin:0 calc(-14px - env(safe-area-inset-right,0px)) 0 calc(-14px - env(safe-area-inset-left,0px));
    padding:11px calc(14px + env(safe-area-inset-right,0px)) 11px calc(14px + env(safe-area-inset-left,0px))}
  .dgrp{width:calc(100% + 28px + env(safe-area-inset-left,0px) + env(safe-area-inset-right,0px));
    margin:0 calc(-14px - env(safe-area-inset-right,0px)) 0 calc(-14px - env(safe-area-inset-left,0px))}
  .dgrp-h{padding:11px calc(14px + env(safe-area-inset-right,0px)) 11px calc(14px + env(safe-area-inset-left,0px))}
  .dgrp .collapsed{width:100%;margin:0;padding-left:calc(26px + env(safe-area-inset-left,0px))}
  .meava{width:38px;height:38px}
  .inputrow{min-height:44px;gap:4px}
  .fmtbar{margin-left:46px}
}
/* tablets: a 30% panel is too thin to read, so it gets a comfortable floor */
@media (min-width:641px) and (max-width:1024px){.panel{min-width:min(420px,72vw)!important}}
@media (max-width:640px) and (pointer:coarse){.acts button{padding:7px 8px}}
@media (pointer:coarse){
  .hint{display:none}                                   /* keyboard shortcuts */
  .text,.pgsearch input,.searchrow input,.auth input,.spage input,.spage textarea,.edit textarea{font-size:16px}
  .close,.srch,.pinsbtn,.mebtn{width:38px;height:38px}
  .mebtn{width:32px;height:32px}
  .acts{opacity:.9}                                     /* no hover to reveal them */
  .acts button{padding:7px 10px;min-height:34px}
  .send{width:40px;height:40px}
  .pinbtn,.imgbtn,.gifbtn{min-height:34px;min-width:34px;justify-content:center}
  .fmtbar button{height:32px;min-width:34px}
  .mentionpop .mp-it{padding:10px 10px}
  .memenu .mm-item{padding:12px 10px}
  .pinmenu .pm-item{min-height:44px}
  .pinmenu .pm-vis{width:44px;height:44px}
  .pgrow{padding:15px 12px}
  .pgs{padding:8px 12px}
  .pinlayer .pdot{width:26px;height:26px;margin:-13px 0 0 -13px}
  .totop,.tobot{height:28px;padding:0 13px 0 11px}
}


/* ================= TaskFlow =================
   The palette above is only the boot default. Once the person's TaskFlow
   look is known, applyLook() writes every token onto the host element (the
   preset or classic colours, light or dark, fonts, radii, status colours),
   so the whole panel, rail and page chrome repaint as TaskFlow. */
:host{--rail-w:56px;
  --st-critical:#f2555f;--st-open:#5b9bf5;--st-inprogress:#f0b43c;--st-onhold:#a48bf2;--st-completed:#3cc47c;
  --warn:#f0a83a;--info:#5b9bf5;--rail-bg:var(--bg)}
.panel{padding-left:var(--rail-w)}
.panel.left{padding-left:0;padding-right:calc(var(--sbw,0px) + var(--rail-w))}
@media (max-width:640px){:host{--rail-w:50px}}

/* ---------- nav rail: TaskFlow's sidebar, folded to icons ---------- */
.rail{position:absolute;top:0;bottom:0;left:0;width:var(--rail-w);z-index:7;
  display:flex;flex-direction:column;align-items:center;gap:4px;
  padding:calc(14px + env(safe-area-inset-top,0px)) 0 calc(14px + env(safe-area-inset-bottom,0px));
  background:var(--rail-bg);border-right:1px solid var(--line)}
.panel.left .rail{left:auto;right:var(--sbw,0px);border-right:0;border-left:1px solid var(--line)}
.panel.has-bg .rail{background:color-mix(in srgb,var(--bg) 35%,transparent)}
.rail .tfmark{width:32px;height:32px;margin-bottom:10px;border-radius:var(--r-md);flex:none;
  display:flex;align-items:center;justify-content:center;background:var(--acc1);color:var(--acc-text);
  box-shadow:0 4px 14px rgba(var(--glow),.3)}
.rail .tfmark svg{width:17px;height:17px;stroke:currentColor;fill:none;stroke-width:2.4}
.rbtn{position:relative;width:38px;height:38px;flex:none;border-radius:var(--r-md);
  display:flex;align-items:center;justify-content:center;color:var(--dim);
  transition:color .15s ease,background-color .15s ease}
.rbtn svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:1.9}
.rbtn:hover{color:var(--text-strong);background:var(--surface2)}
.rbtn.on{color:var(--acc1);background:color-mix(in srgb,var(--acc1) 13%,transparent)}
.rbtn.on::before{content:'';position:absolute;left:-9px;top:9px;bottom:9px;width:3px;border-radius:0 3px 3px 0;background:var(--acc1)}
.panel.left .rbtn.on::before{left:auto;right:-9px;border-radius:3px 0 0 3px}
.rbtn .rdot{position:absolute;top:1px;right:1px;min-width:16px;height:16px;padding:0 4px;border-radius:8px;
  display:flex;align-items:center;justify-content:center;font-size:9.5px;font-weight:700;font-style:normal;
  background:var(--acc1);color:var(--acc-text);box-shadow:0 0 0 2px var(--rail-bg);
  transition:transform .25s var(--ease-pop),opacity .2s ease}
.rbtn .rdot.warn{background:var(--st-critical);color:#fff}
.rbtn .rdot.zero{transform:scale(0);opacity:0}
.rbtn[data-tip]::after{content:attr(data-tip);position:absolute;left:calc(100% + 10px);top:50%;z-index:20;
  transform:translate(-4px,-50%);white-space:nowrap;padding:5px 9px;border-radius:var(--r-sm);
  font-size:11.5px;font-weight:600;color:var(--text-strong);background:var(--menu-bg);
  border:1px solid var(--line-strong);box-shadow:0 8px 22px rgba(0,0,0,.25);
  opacity:0;pointer-events:none;transition:opacity .12s ease,transform .12s ease}
.rbtn[data-tip]:hover::after{opacity:1;transform:translate(0,-50%)}
.panel.left .rbtn[data-tip]::after{left:auto;right:calc(100% + 10px);transform:translate(4px,-50%)}
.panel.left .rbtn[data-tip]:hover::after{transform:translate(0,-50%)}
@media (hover:none){.rbtn[data-tip]::after{display:none}}
.rail .rsp{flex:1}
.rail .rsep{width:22px;height:1px;background:var(--line);margin:4px 0}
.rail.out .rtf{display:none}
.rail [hidden]{display:none!important}
@media (pointer:coarse){.rbtn{width:42px;height:42px}}
/* signed in, the logo makes way for the universal add button */
.rail:not(.out) .tfmark{display:none}
.radd{position:relative;width:34px;height:34px;flex:none;margin-bottom:10px;border-radius:var(--r-md);
  display:flex;align-items:center;justify-content:center;background:var(--acc1);color:var(--acc-text);
  box-shadow:0 4px 14px rgba(var(--glow),.3);transition:filter .15s ease,transform .25s var(--ease-out),box-shadow .15s ease}
.radd svg{width:18px;height:18px;stroke:currentColor;fill:none;stroke-width:2.6;stroke-linecap:round;
  transition:transform .25s var(--ease-out)}
.radd:hover{filter:brightness(1.08);box-shadow:0 6px 18px rgba(var(--glow),.42)}
.radd.openm svg{transform:rotate(45deg)}
.radd[data-tip]::after{content:attr(data-tip);position:absolute;left:calc(100% + 10px);top:50%;z-index:20;
  transform:translate(-4px,-50%);white-space:nowrap;padding:5px 9px;border-radius:var(--r-sm);
  font-size:11.5px;font-weight:600;color:var(--text-strong);background:var(--menu-bg);
  border:1px solid var(--line-strong);box-shadow:0 8px 22px rgba(0,0,0,.25);
  opacity:0;pointer-events:none;transition:opacity .12s ease,transform .12s ease}
.radd[data-tip]:hover::after{opacity:1;transform:translate(0,-50%)}
.radd.openm::after{display:none}
.panel.left .radd[data-tip]::after{left:auto;right:calc(100% + 10px)}
.addmenu{position:absolute;top:12px;left:calc(var(--rail-w) + 8px);z-index:30;width:248px;padding:6px;
  background:linear-gradient(var(--menu-bg),var(--menu-bg)),var(--bg);
  border:1px solid var(--line-strong);border-radius:var(--r-lg);
  box-shadow:0 22px 54px rgba(0,0,0,.35),inset 0 1px 0 var(--top-glint);
  opacity:0;transform:translateX(-6px) scale(.97);transform-origin:top left;pointer-events:none;
  transition:opacity .16s ease,transform .22s var(--ease-out)}
.panel.left .addmenu{left:auto;right:calc(var(--sbw,0px) + var(--rail-w) + 8px);transform-origin:top right;transform:translateX(6px) scale(.97)}
.addmenu.show{opacity:1;transform:none;pointer-events:auto}
.addmenu .am-h{padding:7px 10px 6px;font-size:10.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.addmenu .am-it{width:100%;display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:var(--r-md);text-align:left;
  transition:background-color .12s ease}
.addmenu .am-it:hover,.addmenu .am-it:focus-visible{background:var(--surface2);outline:none}
.addmenu .am-it svg{flex:none;width:30px;height:30px;padding:7px;border-radius:var(--r-md);stroke:var(--acc1);fill:none;stroke-width:2;
  background:color-mix(in srgb,var(--acc1) 13%,transparent)}
.addmenu .am-it span{display:flex;flex-direction:column;min-width:0;font-size:11px;color:var(--faint);line-height:1.35}
.addmenu .am-it b{font-size:12.5px;font-weight:600;color:var(--text-strong)}
/* level ring + earned ranks, at the foot of the rail like TaskFlow's sidebar */
.rlvl{width:38px;height:38px}
.rlvl svg{position:absolute;inset:2px;width:34px;height:34px;transform:rotate(-90deg);stroke-width:3}
.rlvl .rl-track{fill:none;stroke:var(--line-strong)}
.rlvl .rl-fill{fill:none;stroke:var(--acc1);stroke-linecap:round;stroke-dasharray:91.1;stroke-dashoffset:91.1;
  transition:stroke-dashoffset .6s var(--ease-out)}
.rlvl .rl-num{position:relative;font-size:12px;font-weight:700;color:var(--text-strong);font-variant-numeric:tabular-nums}
.rlvl.pulse{animation:dcBump .5s ease}
.rlvl .xppop{position:absolute;left:50%;bottom:100%;font-style:normal;white-space:nowrap;pointer-events:none;
  font-size:11px;font-weight:700;color:var(--acc1);opacity:0;transform:translate(-50%,0)}
.rlvl .xppop.go{animation:dcXp 1.4s var(--ease-out)}
@keyframes dcXp{0%{opacity:0;transform:translate(-50%,6px)}15%{opacity:1}70%{opacity:1}100%{opacity:0;transform:translate(-50%,-16px)}}
.rranks{display:flex;flex-direction:column;align-items:center;gap:3px;margin-bottom:4px}
.rrank{width:34px;height:34px;padding:2px}
.rrank img,.tfrk img{width:100%;height:100%;object-fit:contain;display:block;pointer-events:none}
.rlvl[data-tip]::after,.rrank[data-tip]::after{white-space:nowrap}
/* settings: every rank, earned and locked */
.tfrk-bar{display:flex;align-items:center;gap:10px;margin-bottom:14px;font-size:11.5px;color:var(--faint)}
.tfrk-bar b{font-size:13px;color:var(--text-strong)}
.tfrk-bar .tfrk-track{flex:1;height:6px;border-radius:3px;background:var(--surface2);overflow:hidden}
.tfrk-bar .tfrk-track i{display:block;height:100%;background:var(--acc1);border-radius:3px}
.tfrk-sec{margin:14px 0 8px;font-size:10.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.tfrk-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(68px,1fr));gap:8px}
.tfrk{display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 4px;border-radius:var(--r-md);
  background:var(--surface);border:1px solid var(--line-soft);text-align:center}
.tfrk .tfrk-art{width:44px;height:44px}
.tfrk.locked .tfrk-art{filter:grayscale(1);opacity:.35}
.tfrk b{font-size:10.5px;font-weight:600;color:var(--text-soft);line-height:1.2}
.tfrk span{font-size:9.5px;color:var(--faint)}
.tfrk.earned{border-color:color-mix(in srgb,var(--acc1) 35%,transparent)}
/* focus: what you're on now and the queue, above the page's comments */
.focusbar{position:relative;z-index:5;margin:14px 22px 0;border:1px solid var(--line);border-radius:var(--r-lg);
  background:var(--surface);zoom:var(--ui-scale,1)}
.focusbar+.tabs{margin-top:12px}
.panel.locked .focusbar,.panel.tf-open .focusbar,.panel.settings-open .focusbar{display:none!important}
.panel.has-bg .focusbar{background:color-mix(in srgb,var(--bg) 45%,transparent)}
.fc-head{width:100%;display:flex;align-items:center;gap:8px;padding:9px 12px;text-align:left;border-radius:var(--r-lg)}
.fc-head>svg{width:15px;height:15px;flex:none;stroke:var(--acc1);fill:none;stroke-width:2}
.fc-title{font-size:12px;font-weight:650;color:var(--text-strong)}
.fc-count{font-style:normal;font-size:10.5px;font-weight:700;min-width:18px;height:18px;padding:0 5px;border-radius:9px;
  display:inline-flex;align-items:center;justify-content:center;background:var(--surface2);color:var(--dim)}
.fc-count:empty{display:none}
.fc-sp{flex:1}
.fc-head{transition:background-color .15s ease}
.fc-head:hover{background:color-mix(in srgb,var(--surface2) 60%,transparent)}
.fc-head .fc-chev{width:14px;height:14px;stroke:var(--faint);fill:none;stroke-width:2;
  transition:transform .42s cubic-bezier(.34,1.56,.64,1),stroke .15s ease}
.fc-head:hover .fc-chev{stroke:var(--text-soft)}
.focusbar.shut .fc-chev{transform:rotate(-90deg)}
/* open/shut: the row track animates between 0fr and 1fr, so the height follows
   the real content (no guessed max-height); the content itself fades and
   drifts a little, and the comments below glide up or down with it */
.fc-wrap{display:grid;grid-template-rows:1fr;transition:grid-template-rows .42s var(--ease-drawer)}
.focusbar.shut .fc-wrap{grid-template-rows:0fr;transition-duration:.32s}
.fc-inner{min-height:0;overflow:hidden}
.fc-inner>.fc-body{opacity:1;transform:none;filter:none;
  transition:opacity .28s ease .06s,transform .42s var(--ease-drawer),filter .28s ease .06s}
.focusbar.shut .fc-inner>.fc-body{opacity:0;transform:translateY(-6px) scale(.985);filter:blur(2px);
  transition:opacity .16s ease,transform .3s var(--ease-drawer),filter .16s ease}
/* rows cascade in each time it opens */
.focusbar.opening .fcrow,.focusbar.opening .fc-lbl,.focusbar.opening .fc-empty{animation:dcFcIn .38s var(--ease-out) backwards}
@keyframes dcFcIn{from{opacity:0;transform:translateY(-4px)}}
.fc-count{transition:transform .3s var(--ease-pop),background-color .2s ease,color .2s ease}
.focusbar.shut .fc-count{background:color-mix(in srgb,var(--acc1) 16%,transparent);color:var(--acc1)}
@media (prefers-reduced-motion:reduce){.fc-wrap,.fc-inner>.fc-body,.fc-head .fc-chev{transition:none}
  .focusbar.opening .fcrow,.focusbar.opening .fc-lbl,.focusbar.opening .fc-empty{animation:none}}
.fc-body{max-height:min(38vh,320px);overflow-y:auto;overscroll-behavior:contain;padding:0 8px 8px;
  scrollbar-width:thin;scrollbar-color:var(--line-strong) transparent}
.fc-lbl{padding:6px 6px 4px;font-size:10px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.fcrow{display:flex;align-items:flex-start;gap:9px;padding:7px 6px;border-radius:var(--r-md);cursor:pointer;
  transition:background-color .12s ease}
.fcrow:hover{background:var(--surface2)}
.fcrow .tfchk{width:18px;height:18px}
.fcrow .fc-n{flex:none;width:18px;height:18px;margin-top:1px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:10px;font-weight:700;color:var(--dim);background:var(--surface2)}
.fc-main{flex:1;min-width:0}
.fc-txt{font-size:12.5px;line-height:1.4;color:var(--text);overflow:hidden;text-overflow:ellipsis;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word}
.fc-meta{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;margin-top:3px;font-size:10.5px;color:var(--faint)}
.fc-meta .tfpage{max-width:150px}
.fcrow .fc-x{flex:none;width:22px;height:22px;border-radius:6px;color:var(--faint);display:flex;align-items:center;justify-content:center;
  font-size:11px;opacity:0;transition:opacity .12s ease}
.fcrow:hover .fc-x,.fcrow .fc-x:focus-visible{opacity:1}
.fcrow .fc-x:hover{color:var(--st-critical);background:var(--surface)}
@media (hover:none){.fcrow .fc-x{opacity:.7}}
.fc-empty{padding:4px 8px 6px;font-size:11.5px;color:var(--faint);line-height:1.5}
.fc-empty button{color:var(--acc-soft);font-weight:600}
@media (max-width:640px){.focusbar{margin-left:calc(12px + env(safe-area-inset-left,0px));margin-right:calc(12px + env(safe-area-inset-right,0px))}}
/* save context sheet */
.ctxsheet{position:absolute;inset:0;z-index:48;display:none;align-items:center;justify-content:center;
  padding:24px;background:rgba(8,8,8,.72);backdrop-filter:blur(3px)}
.ctxsheet.show{display:flex;animation:dcLbFade .18s ease}
.ctxcard{max-width:360px}
.ctxcard .mctext{margin-bottom:2px}
.ctxcard .tferr{margin-bottom:0}
.sgroup.gameoff{display:none}

/* ---------- views: Tasks / Go Live / Review replace the comment feed ---------- */
.tfview{display:none;flex:1;min-height:0;flex-direction:column;zoom:var(--ui-scale,1)}
.panel.tf-open .tfview{display:flex}
.panel.tf-open .tabs,.panel.tf-open .searchrow,.panel.tf-open .list,.panel.tf-open .typing,
.panel.tf-open .compose,.panel.tf-open .auth,.panel.tf-open .totop,.panel.tf-open .tobot,
.panel.tf-open .srch,.panel.tf-open .pinsbtn{display:none!important}
.panel.settings-open .tfview{display:none!important}
.panel.has-bg .tfview{position:relative;z-index:1;background:transparent}
.tfhere{color:var(--acc-soft);font-weight:650}
.tfbar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px 22px 10px;border-bottom:1px solid var(--line-soft)}
.tfbar .tfgrow{flex:1}
.tfscroll{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;padding:12px 22px 28px;
  scrollbar-width:thin;scrollbar-color:var(--line-strong) transparent}
.tfscroll.swap{animation:dcSres .24s ease}
.tfscroll.calm .tfcard{animation:none}
.tfscroll .empty .tfbtn{margin-top:4px}
.tfteam{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:var(--dim);
  padding:3px 9px;border-radius:999px;background:var(--surface2);border:1px solid var(--line)}
.tfteam i{width:6px;height:6px;border-radius:50%;background:var(--acc1)}

/* segmented control, TaskFlow style */
.tfseg{display:inline-flex;gap:2px;padding:3px;border-radius:var(--r-md);background:var(--surface2);border:1px solid var(--line)}
.tfseg button{padding:5px 11px;border-radius:calc(var(--r-md) - 3px);font-size:12px;font-weight:550;color:var(--dim);
  white-space:nowrap;transition:color .15s ease,background-color .15s ease,box-shadow .15s ease}
.tfseg button:hover{color:var(--text-soft)}
.tfseg button.sel{color:var(--text-strong);background:var(--tab-active);box-shadow:0 1px 3px rgba(0,0,0,.14)}
.tfseg button i{font-style:normal;margin-left:5px;font-size:10.5px;color:var(--faint)}
.tfseg.full{display:flex;width:100%}
.tfseg.full button{flex:1}
/* review filters: share the row when there's room, scroll sideways when not */
.tfseg.rvf{display:flex;width:100%;overflow-x:auto;scrollbar-width:none}
.tfseg.rvf::-webkit-scrollbar{display:none}
.tfseg.rvf button{flex:1 0 auto}

/* buttons */
.tfbtn{display:inline-flex;align-items:center;justify-content:center;gap:6px;height:32px;padding:0 12px;
  border-radius:var(--r-md);font-size:12.5px;font-weight:550;color:var(--text-soft);
  background:var(--surface);border:1px solid var(--line-strong);white-space:nowrap;
  transition:background-color .15s ease,color .15s ease,border-color .15s ease,filter .15s ease}
.tfbtn:hover{background:var(--surface2);color:var(--text-strong)}
.tfbtn svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2}
.tfbtn.pri{background:var(--acc1);border-color:transparent;color:var(--acc-text);font-weight:600;
  box-shadow:0 2px 10px rgba(var(--glow),.25)}
.tfbtn.pri:hover{filter:brightness(1.07);color:var(--acc-text);background:var(--acc1)}
.tfbtn.ok{color:var(--st-completed);border-color:color-mix(in srgb,var(--st-completed) 45%,transparent)}
.tfbtn.ok:hover{background:color-mix(in srgb,var(--st-completed) 12%,transparent)}
.tfbtn.bad:hover{color:var(--st-critical);border-color:var(--st-critical);background:color-mix(in srgb,var(--st-critical) 10%,transparent)}
.tfbtn.ghost{background:transparent;border-color:transparent;color:var(--dim)}
.tfbtn.ghost:hover{background:var(--surface2);color:var(--text)}
.tfbtn.sm{height:27px;padding:0 9px;font-size:11.5px}
.tfbtn:disabled{opacity:.45;cursor:default;filter:none}

/* inputs */
.tfin{width:100%;min-width:0;padding:8px 11px;font-size:13px;color:var(--text);background:var(--surface);
  border:1px solid var(--line-strong);border-radius:var(--r-md);transition:border-color .15s ease,box-shadow .15s ease}
.tfin::placeholder{color:var(--fainter)}
.tfin:focus{border-color:var(--acc1);box-shadow:0 0 0 3px rgba(var(--glow),.16);outline:none}
textarea.tfin{resize:vertical;min-height:84px;line-height:1.5}
textarea.tfin.mono,.tfmono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}
select.tfin{appearance:auto;padding-right:6px;cursor:pointer}
.tfsearch{flex:1;min-width:140px;display:flex;align-items:center;gap:7px;height:32px;padding:0 10px;
  background:var(--surface);border:1px solid var(--line-strong);border-radius:var(--r-md)}
.tfsearch:focus-within{border-color:var(--acc1);box-shadow:0 0 0 3px rgba(var(--glow),.16)}
.tfsearch svg{width:14px;height:14px;flex:none;stroke:var(--faint);fill:none;stroke-width:2}
.tfsearch input{flex:1;min-width:0;font-size:12.5px;color:var(--text)}
.tflabel{display:block;margin:14px 0 6px;font-size:11px;font-weight:600;letter-spacing:.02em;color:var(--dim)}
.tflabel:first-child{margin-top:0}
.tfgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.tfgrid .tflabel{margin-top:0}
@media (max-width:420px){.tfgrid{grid-template-columns:1fr}}
.tfrow{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.tfrow .tfgrow{flex:1}
.tferr{margin:10px 0;padding:9px 11px;font-size:12px;line-height:1.5;color:var(--st-critical);
  background:color-mix(in srgb,var(--st-critical) 9%,transparent);border:1px solid color-mix(in srgb,var(--st-critical) 30%,transparent);border-radius:var(--r-md)}
.tfnote{font-size:11.5px;color:var(--faint);line-height:1.5}

/* group headings */
.tfgh{display:flex;align-items:center;gap:8px;margin:16px 0 8px;font-size:10.5px;font-weight:650;
  letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.tfgh:first-child{margin-top:2px}
.tfgh i{width:7px;height:7px;border-radius:50%;background:var(--c,var(--faint))}
.tfgh b{font-weight:600;color:var(--fainter)}

/* cards */
.tfcard{position:relative;display:flex;gap:11px;padding:12px 13px;margin-bottom:8px;border-radius:var(--r-lg);
  background:var(--surface);border:1px solid var(--line);cursor:pointer;
  animation:dcPgIn .3s cubic-bezier(.32,.72,.22,1) backwards;
  transition:border-color .15s ease,box-shadow .15s ease,transform .15s ease}
.tfcard:hover{border-color:var(--line-strong);box-shadow:0 4px 16px -6px rgba(0,0,0,.25)}
.tfcard.static{cursor:default}
.tfcard.done .tfc-txt{color:var(--faint);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--faint) 50%,transparent)}
.tfcard.flash{animation:dcFlash 1.1s ease}
.tfc-main{flex:1;min-width:0}
.tfc-title{font-size:13px;font-weight:600;color:var(--text-strong);line-height:1.4}
.tfc-txt{font-size:13px;line-height:1.5;color:var(--text);
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.tfc-txt i{color:var(--faint)}
.tfc-desc{margin-top:4px;font-size:12px;line-height:1.5;color:var(--dim);white-space:pre-wrap;word-break:break-word;
  display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.tfmeta{display:flex;align-items:center;flex-wrap:wrap;gap:6px 9px;margin-top:8px;font-size:11px;color:var(--faint)}
.tfmeta .tfflex{flex:1}
.tfmeta svg{width:12px;height:12px;stroke:currentColor;fill:none;stroke-width:2;vertical-align:-2px}
.tfst{display:inline-flex;align-items:center;gap:5px;font-weight:600;color:var(--text-soft)}
.tfst i{width:7px;height:7px;border-radius:50%;background:var(--c)}
.tfpill{display:inline-flex;align-items:center;gap:5px;padding:1px 8px;border-radius:999px;font-size:10.5px;font-weight:650;
  text-transform:capitalize;color:var(--c,var(--dim));background:color-mix(in srgb,var(--c,var(--dim)) 13%,transparent);
  border:1px solid color-mix(in srgb,var(--c,var(--dim)) 26%,transparent)}
.r-critical{--c:var(--st-critical)}.r-high{--c:var(--warn)}.r-medium{--c:var(--info)}.r-low{--c:var(--dim)}
.tfpage{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--acc-soft)}
a.tfpage{text-decoration:none}
a.tfpage:hover{text-decoration:underline}
.tfdue.late{color:var(--st-critical);font-weight:600}
.tfava{flex:none;display:inline-flex;align-items:center;justify-content:center;border-radius:50%;
  font-weight:700;background-size:cover;background-position:center;box-shadow:0 0 0 2px var(--surface)}
.tfavas{display:inline-flex}
.tfavas .tfava+.tfava{margin-left:-6px}

/* quick-complete circle, like TaskFlow's task card */
.tfchk{flex:none;width:20px;height:20px;margin-top:1px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  border:1.8px solid var(--c);color:transparent;background:transparent;
  transition:background-color .15s ease,color .15s ease,transform .15s var(--ease-out)}
.tfchk svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:3}
.tfchk:hover{color:var(--c);background:color-mix(in srgb,var(--c) 14%,transparent);transform:scale(1.08)}
.tfcard.done .tfchk{background:var(--c);color:#fff}

/* subtask progress */
.tfprog{display:inline-flex;align-items:center;gap:6px}
.tfprog b{display:inline-block;width:38px;height:4px;border-radius:2px;background:var(--line);overflow:hidden;position:relative}
.tfprog b::after{content:'';position:absolute;inset:0;width:var(--p);background:var(--st-completed);border-radius:2px}

/* detail */
.tfd-top{display:flex;align-items:center;gap:8px;margin-bottom:14px}
.tfd-top .tfgrow{flex:1}
.tfd-fb{font-size:13.5px;line-height:1.6;color:var(--text);word-break:break-word}
.tfd-fb p,.tfd-fb ul,.tfd-fb ol,.tfd-fb pre,.tfd-fb blockquote{margin:0 0 8px}
.tfd-fb ul,.tfd-fb ol{padding-left:20px}
.tfd-fb a{color:var(--acc-soft)}
.tfd-fb img{max-width:100%;border-radius:var(--r-md);border:1px solid var(--line)}
.tfd-fb code,.tfd-fb pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;background:var(--surface2);border-radius:5px;padding:1px 5px}
.tfd-fb pre{padding:8px 10px;white-space:pre-wrap}
.tfd-sec{margin-top:18px;padding-top:16px;border-top:1px solid var(--line-soft)}
.tfd-sec>h5{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:10.5px;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:var(--faint)}
.tfd-sec>h5 span{flex:1}
.tfd-line{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:10px;font-size:11.5px;color:var(--faint)}
.tfd-line b{font-weight:600;color:var(--text-soft)}
.tfsub{display:flex;align-items:center;gap:9px;padding:6px 0;border-bottom:1px solid var(--line-soft)}
.tfsub:last-of-type{border-bottom:0}
.tfsub .tfbox{flex:none;width:17px;height:17px;border-radius:5px;display:flex;align-items:center;justify-content:center;
  border:1.6px solid var(--line-strong);color:transparent;transition:background-color .15s ease,border-color .15s ease}
.tfsub .tfbox svg{width:10px;height:10px;stroke:currentColor;fill:none;stroke-width:3}
.tfsub.on .tfbox{background:var(--st-completed);border-color:var(--st-completed);color:#fff}
.tfsub span{flex:1;min-width:0;font-size:13px;color:var(--text);word-break:break-word}
.tfsub.on span{color:var(--faint);text-decoration:line-through}
.tfsub .tfx{opacity:0;width:22px;height:22px;border-radius:6px;color:var(--faint);display:flex;align-items:center;justify-content:center}
.tfsub:hover .tfx{opacity:1}
.tfsub .tfx:hover{color:var(--st-critical);background:var(--surface2)}
@media (hover:none){.tfsub .tfx{opacity:.7}}
.tfatt{display:flex;flex-wrap:wrap;gap:8px}
.tfatt img{width:84px;height:64px;object-fit:cover;border-radius:var(--r-md);border:1px solid var(--line);cursor:zoom-in}
.tfatt a.tffile{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;font-size:12px;color:var(--text-soft);
  border:1px solid var(--line);border-radius:var(--r-md);text-decoration:none;max-width:100%}
.tfatt .tfachip{position:relative}
.tfatt .tfachip button{position:absolute;top:3px;right:3px;width:18px;height:18px;border-radius:9px;background:rgba(0,0,0,.65);
  color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center}
.tflinked{display:flex;gap:9px;align-items:flex-start;padding:8px 10px;margin-bottom:6px;border-radius:var(--r-md);
  background:var(--surface);border:1px solid var(--line-soft);cursor:pointer;width:100%;text-align:left}
.tflinked:hover{border-color:var(--line-strong)}
.tflinked span{flex:1;min-width:0;font-size:12px;color:var(--text-soft);line-height:1.45;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.tflinked b{display:block;font-size:11.5px;color:var(--text-strong)}

/* reviewer picker */
.tfpick{display:flex;flex-wrap:wrap;gap:6px}
.tfpick button{display:inline-flex;align-items:center;gap:6px;padding:4px 10px 4px 4px;border-radius:999px;font-size:12px;
  color:var(--text-soft);background:var(--surface);border:1px solid var(--line-strong);transition:all .15s ease}
.tfpick button.sel{color:var(--acc-text);background:var(--acc1);border-color:var(--acc1)}
.tfpick button.sel .tfava{box-shadow:0 0 0 2px var(--acc1)}

/* review statuses */
.rv-pending{--c:var(--st-open)}.rv-approved{--c:var(--st-completed)}.rv-needs_work{--c:var(--st-critical)}.rv-live{--c:var(--st-onhold)}
.tfacts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.tfacts:empty{display:none}
.tfnotebox{margin-top:10px}
/* review: cards open into a full page with the conversation */
.tfcard.rvcard{cursor:pointer}
.rvd-title{margin:10px 0 4px;font-size:16px;font-weight:650;line-height:1.35;color:var(--text-strong)}
.rvd-desc{margin-top:12px;font-size:13px;line-height:1.6;color:var(--text);white-space:pre-wrap;word-break:break-word}
.rvd-shots img{width:calc(50% - 4px);height:auto;max-height:220px;object-fit:cover}
.rvd-who{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 3px;border-radius:999px;font-size:12px;
  color:var(--text-soft);background:var(--surface);border:1px solid var(--line)}
.rv-tl{display:flex;flex-direction:column;gap:12px}
.rv-ev{display:flex;font-size:12px;color:var(--dim);line-height:1.5}
.rv-ev>i{flex:none;width:8px;height:8px;margin:5px 9px 0;border-radius:50%;background:var(--c)}
.rv-ev>div{flex:1;min-width:0}
.rv-ev b{color:var(--text-soft);font-weight:600}
.rv-when{font-size:11px;color:var(--faint)}
.rv-note{margin-top:5px;padding:7px 10px;border-left:2px solid var(--c);border-radius:0 var(--r-sm) var(--r-sm) 0;
  background:var(--surface);color:var(--text-soft);white-space:pre-wrap;word-break:break-word}
.rv-cm{display:flex;gap:10px}
.rv-cmb{flex:1;min-width:0;padding:8px 11px;border-radius:var(--r-md);background:var(--surface);border:1px solid var(--line-soft)}
.rv-cmh{display:flex;align-items:baseline;gap:8px;margin-bottom:2px}
.rv-cmh b{font-size:12.5px;color:var(--text-strong)}
.rv-x{margin-left:auto;width:20px;height:20px;border-radius:5px;color:var(--faint);font-size:10px;opacity:0;transition:opacity .12s ease}
.rv-cm:hover .rv-x,.rv-x:focus-visible{opacity:1}
.rv-x:hover{color:var(--st-critical);background:var(--surface2)}
@media (hover:none){.rv-x{opacity:.7}}
.rv-cmt{font-size:13px;line-height:1.5;color:var(--text);white-space:pre-wrap;word-break:break-word}
.rv-compose{margin-top:14px}
.rv-compose .tfacts{margin-top:8px;align-items:center}
.tffiles{margin-top:8px;padding:8px 10px;border-radius:var(--r-md);background:var(--surface2);
  font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:1.55;color:var(--text-soft);
  white-space:pre-wrap;word-break:break-word}
.tfmore{display:flex;align-items:center;justify-content:center;gap:6px;width:100%;margin-top:12px;padding:9px 0;
  font-size:12px;color:var(--dim);border:1px dashed var(--line-strong);border-radius:var(--r-md)}
.tfmore:hover{color:var(--text);background:var(--surface)}
.tfform{padding:14px;margin-bottom:14px;border-radius:var(--r-lg);background:var(--surface);border:1px solid var(--line-strong);
  box-shadow:0 8px 28px -12px rgba(0,0,0,.3);animation:dcSres .22s ease}
.tfform .tfacts{justify-content:flex-end;margin-top:14px}
.tfspin{width:20px;height:20px;margin:40px auto;border-radius:50%;border:2px solid var(--line-strong);border-top-color:var(--acc1);
  animation:route-spin .7s linear infinite}
@keyframes route-spin{to{transform:rotate(360deg)}}
.tfgate{text-align:center;padding:56px 12px;color:var(--faint);font-size:13px;line-height:1.6}
.tfgate svg{width:40px;height:40px;stroke:var(--fainter);fill:none;stroke-width:1.6;margin-bottom:10px}

/* task chip on a comment */
.taskchip{display:inline-flex;max-width:100%;align-items:center;gap:7px;margin-top:8px;padding:4px 10px 4px 9px;
  font-size:11px;font-weight:550;color:var(--text-soft);background:var(--surface);border:1px solid var(--line);
  border-radius:var(--r-md);transition:background-color .15s ease,border-color .15s ease,color .15s ease}
.taskchip:hover{background:var(--surface2);border-color:rgba(var(--glow),.45);color:var(--text)}
.taskchip i{width:7px;height:7px;border-radius:50%;background:var(--c,var(--acc1))}
.taskchip svg{width:12px;height:12px;stroke:var(--acc-soft);fill:none;stroke-width:2}
.pinchip+.taskchip{margin-left:6px}

/* account card in settings */
.tfacct{display:flex;align-items:center;gap:12px;padding:12px;border-radius:var(--r-lg);background:var(--surface);border:1px solid var(--line)}
.tfacct .tfa-ava{flex:none;width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-size:16px;font-weight:700;background-size:cover;background-position:center}
.tfacct .tfa-id{flex:1;min-width:0}
.tfacct .tfa-id b{display:block;font-size:13.5px;color:var(--text-strong);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tfacct .tfa-id span{display:block;font-size:11.5px;color:var(--faint);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tfswitch{position:relative;display:inline-flex;flex:none;cursor:pointer}
.tfswitch input{position:absolute;opacity:0;width:0;height:0}
.tfswitch span{width:36px;height:20px;border-radius:10px;background:var(--surface2);border:1px solid var(--line-strong);transition:background-color .18s ease}
.tfswitch span::after{content:'';position:absolute;top:4px;left:4px;width:12px;height:12px;border-radius:50%;background:var(--faint);transition:transform .18s var(--ease-pop),background-color .18s ease}
.tfswitch input:checked+span{background:color-mix(in srgb,var(--acc1) 25%,transparent);border-color:var(--acc1)}
.tfswitch input:checked+span::after{transform:translateX(16px);background:var(--acc1)}
.tflookrow{display:flex;align-items:center;gap:12px}
.tflookrow .tfgrow{flex:1;font-size:12px;color:var(--text-soft)}

/* sign-in: when signed out the panel is just this card, centred, with no
   feed, tabs or search behind it */
.panel.locked .tabs,.panel.locked .searchrow,.panel.locked .list,.panel.locked .typing,
.panel.locked .totop,.panel.locked .tobot,.panel.locked .srch,.panel.locked .pinsbtn,
.panel.locked .lockmsg{display:none!important}
.panel.locked .auth.show{flex:1;min-height:0;overflow-y:auto;display:flex;flex-direction:column;justify-content:center;
  border-top:0;background:transparent;padding:24px 24px 48px}
.panel.has-bg.locked .auth.show{background:transparent}
.auth .acard{width:100%;max-width:330px;margin:0 auto}
.panel.locked .auth .acard{padding:26px 24px 22px;border:1px solid var(--line);border-radius:var(--r-lg);
  background:color-mix(in srgb,var(--surface) 70%,transparent);box-shadow:0 18px 50px rgba(0,0,0,.22)}
.auth .abrand{display:flex;flex-direction:column;align-items:center;text-align:center;margin-bottom:20px}
.auth .abrand .tfmark{width:44px;height:44px;flex:none;border-radius:var(--r-lg);display:flex;align-items:center;justify-content:center;
  background:var(--acc-grad,var(--acc1));color:var(--acc-text);margin-bottom:14px;
  box-shadow:0 6px 18px rgba(var(--glow),.35),inset 0 1px 0 rgba(255,255,255,.25)}
.auth .abrand .tfmark svg{width:22px;height:22px;stroke:currentColor;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.auth .abrand h4{margin:0 0 6px;font-size:17px;line-height:1.25}
.auth .abrand .asub{margin:0;font-size:12px;line-height:1.5;max-width:260px}
.auth .alabel{display:block;font-size:11.5px;font-weight:600;color:var(--text-soft);margin-bottom:12px}
.auth .alabel input{display:block;margin:6px 0 0;padding:10px 12px}
.auth .alrow{display:flex;align-items:center;justify-content:space-between}
.auth .aforgot{font-size:11.5px;font-weight:500;color:var(--acc-soft);padding:0 2px;border-radius:var(--r-sm)}
.auth .aforgot:hover{text-decoration:underline}
.auth .aerr,.auth .aok{margin:-4px 0 12px;padding:8px 10px;border-radius:var(--r-md);font-size:12px;line-height:1.4}
.auth .aerr{background:color-mix(in srgb,var(--heart) 12%,transparent)}
.auth .aok{display:none;color:var(--st-completed);background:color-mix(in srgb,var(--st-completed) 12%,transparent)}
.auth .aok.show{display:block}
.auth .abtn{padding:11px 0;margin-top:2px}
.auth .abtn:disabled{opacity:.6;cursor:default;filter:none}
.auth .alinks{margin-top:16px;padding-top:14px;border-top:1px solid var(--line-soft,var(--line));text-align:center}
.auth .alinks a{font-size:12px;color:var(--faint);text-decoration:none}
.auth .alinks a b{color:var(--acc-soft);font-weight:600}
.auth .alinks a:hover b{text-decoration:underline}
@media (prefers-reduced-motion:reduce){.tfcard,.tfscroll.swap,.tfform{animation:none}}
</style>

<div class="pinpop pinfloat"></div>

<!-- element-pinning chrome: lives at page level, outside the panel -->
<div class="pickveil"><div class="picklabel">Click an element to pin it \u00b7 Esc to cancel</div></div>
<div class="pickhl"></div>
<div class="pindot"></div>
<div class="pinlayer"></div>
<div class="pintip"></div>
<div class="dctoast"></div>
<div class="scannote" role="status" aria-live="polite"></div>
<div class="undotoast" role="status" aria-live="polite"></div>

<div class="overlay"></div>

<!-- the rig: panel + edge column move as ONE transform, so nothing can lag.
     .rig shifts by the panel's width; .rigb (the column + pins drawer) shifts
     again by the drawer's width. -->
<div class="rig"><div class="rigb">
<div class="pinmenu"></div>
<button class="toggle" aria-label="Open comments">
  <svg class="tg-chat" viewBox="0 0 24 24" fill="none" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
  <svg class="tg-shut" viewBox="0 0 24 24" fill="none" stroke-width="2.2"><path d="m9 6 6 6-6 6"/></svg>
  <span class="badge zero">0</span>
  <span class="tabpin tglpin" title="Pinned comments"><svg viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg></span>
</button>
<button class="pineye" aria-label="Show pinned comments on this page" title="Show pins on this page">
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
  <span class="pecount">0</span>
</button>
<div class="presence" aria-label="People on this page"></div>
</div>
<div class="panel" role="complementary" aria-label="TaskFlow">
  <i class="pshadow" aria-hidden="true"></i>
  <nav class="rail out" aria-label="TaskFlow">
    <span class="tfmark" title="TaskFlow"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg></span>
    <button class="radd rtf" data-tip="Add to TaskFlow" aria-label="Add to TaskFlow" aria-haspopup="menu" aria-expanded="false">
      <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
    <button class="rbtn on" data-view="comments" data-tip="Focus &amp; comments" aria-label="Focus and comments">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/></svg><i class="rdot zero">0</i></button>
    <button class="rbtn rtf" data-view="tasks" data-tip="Tasks" aria-label="Tasks">
      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg><i class="rdot zero">0</i></button>
    <button class="rbtn rtf" data-view="golive" data-tip="Go Live" aria-label="Go Live">
      <svg viewBox="0 0 24 24"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg><i class="rdot zero">0</i></button>
    <button class="rbtn rtf" data-view="review" data-tip="Review" aria-label="Review">
      <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg><i class="rdot zero">0</i></button>
    <span class="rsp"></span>
    <div class="rranks rtf" hidden></div>
    <button class="rbtn rtf rlvl" hidden aria-label="Level and ranks">
      <svg viewBox="0 0 34 34" aria-hidden="true"><circle class="rl-track" cx="17" cy="17" r="14.5"/><circle class="rl-fill" cx="17" cy="17" r="14.5"/></svg>
      <b class="rl-num">1</b><em class="xppop" aria-live="polite"></em></button>
    <span class="rsep rtf rlsep" hidden></span>
    <a class="rbtn rtf ropen" data-tip="Open TaskFlow" aria-label="Open TaskFlow" target="_blank" rel="noopener">
      <svg viewBox="0 0 24 24"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg></a>
    <button class="rbtn rset" data-tip="Settings" aria-label="Settings">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg></button>
  </nav>
  <div class="addmenu" role="menu" aria-label="Add to TaskFlow">
    <div class="am-h">Add to TaskFlow</div>
    <button class="am-it" data-add="task" role="menuitem">
      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8.5 12 2.5 2.5 4.5-5"/></svg>
      <span><b>Task</b>Something that needs doing</span></button>
    <button class="am-it" data-add="golive" role="menuitem">
      <svg viewBox="0 0 24 24"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/></svg>
      <span><b>Ready for live</b>A change waiting to be pushed</span></button>
    <button class="am-it" data-add="review" role="menuitem">
      <svg viewBox="0 0 24 24"><path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1"/><path d="m9 14 2 2 4-4"/></svg>
      <span><b>Review</b>Submit this page for review</span></button>
    <button class="am-it" data-add="context" role="menuitem">
      <svg viewBox="0 0 24 24"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
      <span><b>Context</b>Something worth remembering</span></button>
  </div>
  <div class="bgwrap"><div class="bgimglayer"></div><div class="bgtintlayer"></div><div class="bgglass"></div></div>
  <div class="resizer" role="separator" aria-label="Resize panel" tabindex="0"></div>
  <div class="head">
    <div class="sub"></div>
    <div class="hbtns">
      <button class="srch" aria-label="Search comments" title="Search comments">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
      </button>
      <button class="bellbtn hid" aria-label="Notifications" title="Notifications">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
      </button>
      <button class="pinsbtn" aria-label="All pins" title="All pins">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
      </button>
      <button class="mebtn" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false" title="Account"></button>
      <button class="gear hid" aria-label="Settings" title="Settings">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01A1.7 1.7 0 0 0 10.05 3V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56h.01a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1.05z"/></svg>
      </button>
      <button class="logout hid" aria-label="Sign out" title="Sign out">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
      </button>
      <button class="close" aria-label="Close">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </div>
  </div>
  <div class="memenu" role="menu">
    <div class="mm-who"><div class="mm-ava"></div><div class="mm-id"><b class="mm-name"></b><span class="mm-role"></span></div></div>
    <button class="mm-item" data-mm="notif" role="menuitem">
      <svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>
      <span>Notifications</span><em class="mm-state"></em></button>
    <button class="mm-item" data-mm="settings" role="menuitem">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>
      <span>Settings</span></button>
    <div class="mm-sep"></div>
    <button class="mm-item danger" data-mm="logout" role="menuitem">
      <svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg>
      <span>Sign out</span></button>
  </div>
  <section class="focusbar" aria-label="Focus" hidden>
    <button class="fc-head" aria-expanded="true">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/></svg>
      <span class="fc-title">Focus</span><i class="fc-count"></i><span class="fc-sp"></span>
      <svg class="fc-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></button>
    <div class="fc-wrap"><div class="fc-inner"><div class="fc-body"></div></div></div>
  </section>
  <div class="tabs">
    <i class="glide" aria-hidden="true"></i>
    <button class="tab active" data-ctx="page">This page<span class="tabdot zero"></span><span class="tabpin" data-pw="page" title="Pinned comments"><svg viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg></span></button>
    <button class="tab" data-ctx="general">General<span class="tabdot zero"></span><span class="tabpin" data-pw="general" title="Pinned comments"><svg viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg></span></button>
    <button class="tab notif-tab">Alerts<span class="tabdot zero"></span></button>
    <button class="tab pages-tab">Pages<span class="tabdot zero"></span></button>
    <div class="pagemenu"></div>
    <div class="pinpop"></div>
  </div>
  <div class="searchrow">
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
    <input class="sq" type="text" placeholder="Search all comments\u2026" autocomplete="off">
    <button class="sx" aria-label="Close search">\u2715</button>
  </div>
  <div class="list"></div>
  <div class="tfview">
    <div class="tfbar"></div>
    <div class="tfscroll"></div>
  </div>
  <button class="totop" aria-label="Scroll to top" title="Scroll to top">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 19V5M5 12l7-7 7 7"/></svg><span>Back to top</span>
  </button>
  <button class="tobot" aria-label="Scroll to bottom" title="Scroll to bottom">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 5v14M19 12l-7 7-7-7"/></svg><span>Latest</span>
  </button>
  <div class="modconfirm" role="dialog" aria-modal="true" aria-label="Moderator action">
    <div class="mccard">
      <div class="mctitle"></div>
      <div class="mctext"></div>
      <div class="mcquote"></div>
      <div class="mcrow"><button class="mccancel">Cancel</button><button class="mcok"></button></div>
    </div>
  </div>
  <div class="ctxsheet" role="dialog" aria-modal="true" aria-label="Save context">
    <div class="mccard ctxcard">
      <div class="mctitle">Save context</div>
      <div class="mctext">Something worth remembering that isn’t a task. It goes to your team’s Context in TaskFlow.</div>
      <span class="tflabel">Subject</span>
      <input class="tfin ctxsub" type="text" placeholder="e.g. Captcha on contact forms" autocomplete="off">
      <span class="tflabel">Description <span class="tfnote">· what you’d want to read back later</span></span>
      <textarea class="tfin ctxdesc" rows="5" placeholder="It’s an Elementor add-on called X, configured under Settings → Forms."></textarea>
      <div class="tferr ctxerr" hidden></div>
      <div class="mcrow"><button class="mccancel ctxcancel">Cancel</button><button class="mcok edit ctxsave">Save</button></div>
    </div>
  </div>
  <div class="likepop" role="tooltip"></div>
  <div class="lightbox" role="dialog" aria-label="Image preview">
    <button class="lbclose" aria-label="Close">&#10005;</button>
    <img alt="">
  </div>
  <div class="notifask" role="dialog" aria-label="Notification setup">
    <div class="nacard">
      <div class="nasteps"></div>
      <div class="nabody"></div>
      <div class="narow">
        <button class="naback">Back</button>
        <span class="nasp"></span>
        <button class="naskip">Skip</button>
        <button class="nanext">Next</button>
      </div>
    </div>
  </div>
  <div class="notifcfg" role="dialog" aria-label="Notification settings">
    <div class="ncsheet">
      <div class="nchead">
        <span class="nctitle">Notifications</span>
        <label class="ncmaster"><input type="checkbox" class="ncon"><span></span></label>
        <button class="ncclose" aria-label="Close">&#10005;</button>
      </div>
      <div class="ncbody">
        <div class="ncperm"></div>
        <div class="ncsec">Events</div>
        <div class="nclegend"><span class="nclabel">Event</span><span>Desktop</span><span>Phone</span></div>
        <div class="ncevents"></div>
        <div class="ncsec">Phone delivery (ntfy.sh)</div>
        <div class="ncdesc">Your private link. Subscribe to it in the free <b>ntfy</b> app and notifications reach you with the site closed. Anyone who has this link can read your notifications \u2014 keep it private.</div>
        <div class="nctopicrow"><input class="nctopic" readonly><button class="nccopy">Copy</button></div>
        <div class="ncbtns">
          <button class="ncregen">Regenerate ntfy.sh notification link</button>
          <button class="nctest">Send test</button>
          <button class="notifsetup">Run setup again</button>
        </div>
        <div class="ncsec">Get the app</div>
        <div class="ncdesc">Paste the link above into whichever of these you want. Desktop popups from this panel already work in any open tab \u2014 the apps are for when everything is closed.</div>
        <div class="ncapps">
          <a class="ncapp" href="https://apps.apple.com/us/app/ntfy/id1625396347" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="2.5"/><path d="M11 18h2"/></svg>
            <span><b>iPhone / iPad</b>App Store</span></a>
          <a class="ncapp" href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24"><path d="m4 3 12 9-12 9z"/></svg>
            <span><b>Android</b>Google Play</span></a>
          <a class="ncapp ncappweb" href="#" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>
            <span><b>Any browser</b>Desktop \u00b7 open my link on the web</span></a>
        </div>
        <div class="ncsec">Muted people</div>
        <div class="ncdesc">Nothing from these people will notify you, anywhere.</div>
        <input class="ncsearch" type="text" placeholder="Search people to mute\u2026" autocomplete="off">
        <div class="ncresults"></div>
        <div class="ncmuted"></div>
      </div>
    </div>
  </div>
  <div class="onboard" role="dialog" aria-label="Welcome tour">
    <div class="obcard">
      <div class="obicon"></div>
      <div class="obtitle"></div>
      <div class="obtext"></div>
      <div class="obdots"></div>
      <div class="obrow">
        <button class="obskip">Skip tour</button>
        <span class="obsp"></span>
        <button class="obback">Back</button>
        <button class="obnext">Next</button>
      </div>
    </div>
  </div>
  <div class="annot" role="dialog" aria-label="Annotate screenshot">
    <div class="anhead">
      <span class="antitle">Annotate</span>
      <button class="antool on" data-t="pen" title="Freehand pen">
        <svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>Pen</button>
      <button class="antool" data-t="box" title="Rectangle">
        <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="1.5"/></svg>Box</button>
      <button class="antool" data-t="arrow" title="Arrow">
        <svg viewBox="0 0 24 24"><path d="M5 19 19 5M19 5h-8M19 5v8"/></svg>Arrow</button>
      <button class="anundo" title="Undo last mark" disabled>
        <svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3"/></svg>Undo</button>
      <span class="ansp"></span>
      <button class="ancancel">Cancel</button>
      <button class="ansave">Save</button>
    </div>
    <div class="anwrap"><canvas class="ancv"></canvas></div>
    <div class="anhint">Pick a tool, then draw straight on the screenshot \u00b7 drawings use your accent colour</div>
  </div>

  <div class="spage">
    <div class="shead">
      <div class="sheadtop">
        <div class="stitle">Settings</div>
        <button class="sclose" aria-label="Close settings">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="snav">
        <button class="snavb sel" data-sec="you">You</button>
        <button class="snavb" data-sec="look">Appearance</button>
        <button class="snavb" data-sec="panel">Panel</button>
        <button class="snavb" data-sec="help">Help</button>
      </div>
    </div>
    <div class="sgroup" data-sec="you">
      <div class="sname">TaskFlow account</div>
      <div class="sdesc">You’re signed in with TaskFlow. Your name, photo and colour come from your TaskFlow profile.</div>
      <div class="tfacct">
        <div class="tfa-ava"></div>
        <div class="tfa-id"><b class="tfa-name"></b><span class="tfa-mail"></span></div>
        <a class="tfbtn sm tfa-edit" target="_blank" rel="noopener">Edit profile</a>
      </div>
      <div class="tfteamrow" hidden>
        <div class="acctlabel">Team for tasks, Go Live and Review</div>
        <select class="tfin tfteamsel"></select>
      </div>
      <div class="tfnote tfa-role" style="margin-top:10px"></div>
      <button class="dangerbtn tfa-out">Sign out</button>
    </div>
    <div class="sgroup tfranksgrp" data-sec="you">
      <div class="sname">Level &amp; ranks <b class="tfrk-count"></b></div>
      <div class="sdesc">The same XP and ranks as TaskFlow. Creating and completing tasks here earns XP too.</div>
      <div class="tfranks"></div>
    </div>
    <div class="sgroup" data-sec="look">
      <div class="sname">Theme</div>
      <div class="sdesc">Light or dark. TaskFlow remembers this per device, so it’s set here too.</div>
      <div class="segrow modegroup">
        <button class="seg" data-mode="dark">Dark</button>
        <button class="seg" data-mode="light">Light</button>
        <button class="seg" data-mode="system">System</button>
      </div>
      <div class="tflookrow" style="margin-top:18px">
        <div class="tfgrow"><b style="display:block;color:var(--text-strong);font-size:12.5px;font-weight:600">Match my TaskFlow look</b>
          <span class="tflookdesc">Uses the preset, colours, text size and background from your TaskFlow appearance settings.</span></div>
        <label class="tfswitch"><input type="checkbox" class="tflook"><span></span></label>
      </div>
    </div>
    <div class="sgroup" data-sec="look">
      <div class="sname">Panel background</div>
      <div class="sdesc">An image behind the comments. Only you see it. With none set, your TaskFlow background is used.</div>
      <div class="bgrow">
        <div class="bgprev"><span>None</span></div>
        <div class="bgbtns">
          <button class="pfpup bgup">Upload image</button>
          <button class="pfprm bgrm show">Remove</button>
        </div>
        <input class="bgfile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none">
      </div>
      <div class="bgctl">
        <div class="bglabel">Blur <b class="bgblurv">0px</b></div>
        <input class="bgblur rng" type="range" min="0" max="40" step="1" value="0">
        <div class="bglabel">Tint</div>
        <div class="bgtintrow">
          <input class="bgtint" type="color" value="#141416">
          <button class="bgtintclear">Clear tint</button>
        </div>
        <div class="bglabel">Tint strength <b class="bgopv">60%</b></div>
        <input class="bgop rng" type="range" min="0" max="100" step="1" value="60">
      </div>
    </div>
    <div class="sgroup" data-sec="look">
      <div class="sname">Accent colour</div>
      <div class="sdesc">Used for buttons, unread badges and highlights. Reset to follow your TaskFlow accent.</div>
      <div class="colorrow">
        <span class="swatchwrap"><input class="accentpick" type="color" value="#7fb0d4"></span>
        <input class="hexin accenthex" type="text" maxlength="7" spellcheck="false" placeholder="#7fb0d4">
        <button class="resetcol accentreset">Reset</button>
      </div>
    </div>
    <div class="sgroup" data-sec="you">
      <div class="sname">Your name in chat</div>
      <div class="sdesc">Colour of your name on every comment. Add a second colour for a gradient.</div>
      <div class="colorrow">
        <span class="swatchwrap"><input class="namepick" type="color" value="#f0f2f5"></span>
        <input class="hexin namehex" type="text" maxlength="7" spellcheck="false" placeholder="default">
        <button class="resetcol namereset">Reset</button>
      </div>
      <div class="colorrow" style="margin-top:8px">
        <span class="swatchwrap"><input class="namepick2" type="color" value="#9d7cff"></span>
        <input class="hexin namehex2" type="text" maxlength="7" spellcheck="false" placeholder="second colour — optional, makes a gradient">
        <button class="resetcol namereset2">Clear</button>
      </div>
    </div>
    <div class="sgroup" data-sec="look">
      <div class="sname">Timestamps</div>
      <div class="sdesc">How the time next to each comment is written.</div>
      <div class="segrow timefmtgroup">
        <button class="seg" data-timefmt="relative">2h ago</button>
        <button class="seg" data-timefmt="clock">3:42 PM</button>
      </div>
    </div>
    <div class="sgroup" data-sec="panel">
      <div class="sname">Tab position</div>
      <div class="sdesc">Where the closed tab sits vertically.</div>
      <div class="segrow tabposgroup">
        <button class="seg" data-tabpos="top">Top</button>
        <button class="seg" data-tabpos="middle">Middle</button>
        <button class="seg" data-tabpos="bottom">Bottom</button>
      </div>
    </div>
    <div class="sgroup" data-sec="panel">
      <div class="sname">Panel side</div>
      <div class="sdesc">Which edge the panel and its tab sit on.</div>
      <div class="segrow sidegroup">
        <button class="seg" data-side="left">Left</button>
        <button class="seg" data-side="right">Right</button>
      </div>
    </div>
    <div class="sgroup" data-sec="panel">
      <div class="sname">Tab size</div>
      <div class="sdesc">The closed tab you click to open the panel.</div>
      <div class="segrow tabsizegroup">
        <button class="seg" data-tabsize="s">Small</button>
        <button class="seg" data-tabsize="m">Medium</button>
        <button class="seg" data-tabsize="l">Large</button>
      </div>
    </div>
    <div class="sgroup" data-sec="look">
      <div class="sname">Image &amp; GIF size <b class="mdval">160px</b></div>
      <div class="sdesc">Maximum height for screenshots and GIFs in the thread.</div>
      <div class="scalerow">
        <button class="mddown" aria-label="Smaller">&minus;</button>
        <div class="scbar"><span class="mdbar"></span></div>
        <button class="mdup" aria-label="Larger">+</button>
        <button class="screset mdreset">Reset</button>
      </div>
    </div>
    <div class="sgroup" data-sec="look">
      <div class="sname">Text size <b class="scval">100%</b></div>
      <div class="sdesc">Scales the whole panel — type, avatars, buttons and spacing.</div>
      <div class="scalerow">
        <button class="scdown" aria-label="Smaller">&minus;</button>
        <div class="scbar"><span></span></div>
        <button class="scup" aria-label="Larger">+</button>
        <button class="screset">Reset</button>
      </div>
    </div>
    <div class="sgroup" data-sec="help">
      <div class="sname">Welcome tour</div>
      <div class="sdesc">A quick walkthrough of pinning, annotating, tasks and search.</div>
      <button class="acctbtn obreplay" style="margin-top:2px">Replay the tour</button>
    </div>
  </div>

  <div class="typing"><span class="tdots"><i></i><i></i><i></i></span><span class="twho"></span></div>

  <div class="compose">
    <div class="pickbar">
      <span class="pcount"><b>0</b> selected</span>
      <button class="pcancel">Cancel</button>
      <button class="pgo" disabled>Create task</button>
    </div>
    <div class="gifpicker">
      <div class="gifinner">
      <div class="gifhead">
        <input class="gifq" type="text" placeholder="Search GIFs…" autocomplete="off">
        <button class="gifclose" aria-label="Close GIF search">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="gifgrid"></div>
      </div>
    </div>
    <div class="replyto">Replying to <b></b><button type="button">Cancel</button></div>
    <div class="chips"></div>
    <div class="mentionpop" role="listbox"></div>
    <div class="fmtbar" aria-label="Formatting">
      <button type="button" data-fmt="bold" title="Bold (Ctrl+B)"><b>B</b></button>
      <button type="button" data-fmt="italic" title="Italic (Ctrl+I)"><i>I</i></button>
      <button type="button" data-fmt="code" title="Code (Ctrl+E)"><svg viewBox="0 0 24 24"><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></svg></button>
      <button type="button" data-fmt="list" title="Bulleted list"><svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="18" r="1"/></svg></button>
      <span class="fmt-sep"></span>
      <button type="button" data-fmt="mention" title="Mention someone">@</button>
    </div>
    <div class="composebar">
      <div class="meava">?</div>
      <div class="inputrow">
        <button class="pinbtn" aria-label="Pin an element on the page" title="Pin an element on the page">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>
        </button>
        <button class="imgbtn" aria-label="Attach an image" title="Attach an image (or paste / drop one)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 8"/></svg>
        </button>
        <input class="imgfile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
        <button class="gifbtn" aria-label="Add a GIF" title="Add a GIF">GIF</button>
        <textarea class="text" rows="1" placeholder="Write a comment…" maxlength="5000"></textarea>
        <button class="send" aria-label="Send">
          <svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
        </button>
      </div>
    </div>
    <div class="hint"><kbd>Enter</kbd> send <span>\u00b7</span> <kbd>Shift</kbd>+<kbd>Enter</kbd> new line <span>\u00b7</span> <kbd>@</kbd> mention <span>\u00b7</span> <kbd>Ctrl</kbd>+<kbd>/</kbd> toggle</div>
    <div class="dropzone"><div class="dz-card"><svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-8 8"/></svg>Drop to attach</div></div>
  </div>

  <div class="auth">
    <div class="acard">
      <div class="abrand">
        <span class="tfmark"><svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7"/></svg></span>
        <h4>Sign in to TaskFlow</h4>
        <div class="asub">Use your TaskFlow email and password to comment and see your team’s tasks.</div>
      </div>
      <label class="alabel">Email
        <input class="aemail" type="email" placeholder="you@palmerindustries.com" autocomplete="email"></label>
      <label class="alabel"><span class="alrow">Password<button class="aforgot" type="button">Forgot?</button></span>
        <input class="apass" type="password" placeholder="••••••••" autocomplete="current-password"></label>
      <div class="aerr"></div>
      <div class="aok"></div>
      <button class="abtn">Sign in</button>
      <div class="alinks"><a class="aregister" target="_blank" rel="noopener">New to TaskFlow? <b>Create an account</b></a></div>
    </div>
  </div>
</div>
</div>`;

  const $=s=>root.querySelector(s), $$=s=>root.querySelectorAll(s);
  /* what we have already told the user about, so a re-render never repeats */
  let notifSeen=null;
  let barStyle=null;   /* injected style that repaints the page scrollbar */
  /* Width of the page's own scrollbar. The host stays inside the layout
     viewport (so the toggle tab is always visible and clickable); only the
     open panel stretches this far past it, closing the gap at the edge. */
  function syncScrollbarWidth(){
    const w=Math.max(0,Math.min(40,window.innerWidth-document.documentElement.clientWidth));
    host.style.setProperty('--sbw',w+'px');
  }
  syncScrollbarWidth();
  window.addEventListener('resize',syncScrollbarWidth);
  window.addEventListener('resize',()=>{if(typeof syncTabBand==='function')syncTabBand();});
  const panel=$('.panel'), overlay=$('.overlay'), list=$('.list'),
        textEl=$('.text'), replyBar=$('.replyto'), badge=$('.badge'), sub=$('.sub'),
        compose=$('.compose'), authBox=$('.auth'), meAva=$('.meava'), logoutBtn=$('.logout'),
        gearBtn=$('.gear'), resizer=$('.resizer');
  let ctx='page', parentId=0, inflight=0, getSeq=0;
  const cache={page:null,general:null,other:{}};
  let USERS={};                                   /* uid -> {name,settings} */
  let typingState={};                             /* context -> [{uid,name,ttl}] */
  let isOpen=false;

  /* ================= account/session (token survives hard refresh) ================= */
  let ME=null;                                    /* local account + TaskFlow profile when signed in */

  /* ---- TaskFlow (Supabase) client ----
     A small fetch wrapper instead of supabase-js: sign in, keep the session
     fresh, and talk to the REST API as the signed-in person (row-level
     security decides what they can see and change). The session lives in
     this site's localStorage under its own key, so it never collides with
     anything else on the page. */
  const TF=(()=>{
    const KEY='dc_tf_session';
    const read=()=>{try{return JSON.parse(localStorage.getItem(KEY))||null;}catch(e){return null;}};
    let s=read();
    const save=v=>{s=v;try{v?localStorage.setItem(KEY,JSON.stringify(v)):localStorage.removeItem(KEY);}catch(e){}};
    const H=extra=>Object.assign({apikey:SB_ANON,'Content-Type':'application/json'},extra||{});
    async function auth(path,body,bearer){
      const r=await fetch(SB_URL+'/auth/v1/'+path,{method:'POST',
        headers:H(bearer?{Authorization:'Bearer '+bearer}:null),body:JSON.stringify(body||{})});
      const j=await r.json().catch(()=>({}));
      if(!r.ok){
        const e=new Error(j.error_description||j.msg||j.message||('Sign-in failed ('+r.status+')'));
        e.status=r.status;throw e;
      }
      return j;
    }
    const keep=j=>{
      save({access_token:j.access_token,refresh_token:j.refresh_token,
        expires_at:j.expires_at||Math.floor(Date.now()/1000)+(j.expires_in||3600),
        uid:j.user&&j.user.id,email:j.user&&j.user.email,created:j.user&&j.user.created_at});
      return s;
    };
    let refreshing=null;
    /* a valid access token, refreshing it a little before it runs out */
    function fresh(){
      if(!TF_READY)return Promise.resolve(null);
      const ls=read();                       /* another tab may have refreshed already */
      if(ls&&(!s||ls.expires_at>s.expires_at))s=ls;
      if(!s)return Promise.resolve(null);
      if(s.expires_at-Date.now()/1000>90)return Promise.resolve(s.access_token);
      if(!refreshing)refreshing=auth('token?grant_type=refresh_token',{refresh_token:s.refresh_token})
        .then(j=>keep(j).access_token)
        .catch(e=>{if(e.status>=400&&e.status<500)save(null);return s?s.access_token:null;})
        .finally(()=>{refreshing=null;});
      return refreshing;
    }
    async function rest(path,opt){
      opt=opt||{};
      const t=await fresh();
      if(!t){const e=new Error('Please sign in.');e.code='auth';throw e;}
      const r=await fetch(SB_URL+'/rest/v1/'+path,{method:opt.method||'GET',
        headers:H(Object.assign({Authorization:'Bearer '+t},opt.prefer?{Prefer:opt.prefer}:{})),
        body:opt.body===undefined?undefined:JSON.stringify(opt.body)});
      const txt=await r.text();let j=null;try{j=txt?JSON.parse(txt):null;}catch(e){}
      if(!r.ok){
        const e=new Error((j&&(j.message||j.hint||j.error))||('TaskFlow returned '+r.status));
        e.status=r.status;e.code=j&&j.code;throw e;
      }
      return j;
    }
    return {
      has:()=>!!(TF_READY&&(s||read())),
      access:()=>(s&&s.access_token)||'',
      uid:()=>s&&s.uid,
      fresh,rest,
      rpc:(name,args)=>rest('rpc/'+name,{method:'POST',body:args||{}}),
      /* when the account was made (account-age ranks); sessions from before
         this was stored ask Supabase once */
      async created(){
        if(s&&s.created)return s.created;
        const t=await fresh();if(!t)return '';
        try{
          const r=await fetch(SB_URL+'/auth/v1/user',{headers:H({Authorization:'Bearer '+t})});
          const j=await r.json();
          if(j&&j.created_at&&s){s.created=j.created_at;save(s);}
          return (j&&j.created_at)||'';
        }catch(e){return '';}
      },
      signIn:(email,password)=>auth('token?grant_type=password',{email,password}).then(keep),
      recover:email=>auth('recover',{email}),
      signOut(localOnly){
        const t=s&&s.access_token;save(null);
        if(t&&!localOnly)auth('logout?scope=local',{},t).catch(()=>{});
      }
    };
  })();
  const token=()=>TF.access();

  function api(action,data,whichCtx){
    const c=(whichCtx||ctx)==='page'?PAGE:'general';
    return TF.fresh().catch(()=>null).then(()=>{
      const b=new URLSearchParams({action,nonce:NONCE,context:c,token:token(),...data});
      return fetch(AJAX,{method:'POST',body:b}).then(r=>r.json());
    });
  }

  /* which edge the panel lives on, and how big the closed tab is */
  const toggleEl=$('.toggle');
  let side='right', tabsize='m';
  function applySide(v,persist){
    side=v==='left'?'left':'right';
    panel.classList.toggle('left',side==='left');
    toggleEl.classList.toggle('left',side==='left');
    try{syncDock();}catch(e){}   /* not ready during boot; later side flips re-dock */
    $$('.sidegroup .seg').forEach(b=>b.classList.toggle('sel',b.dataset.side===side));
    if(persist)localStorage.setItem('dc_side',side);
  }
  function applyTabsize(v,persist){
    tabsize=['s','m','l'].includes(v)?v:'m';
    toggleEl.classList.remove('sz-s','sz-m','sz-l');
    toggleEl.classList.add('sz-'+tabsize);
    $$('.tabsizegroup .seg').forEach(b=>b.classList.toggle('sel',b.dataset.tabsize===tabsize));
    if(persist)localStorage.setItem('dc_tabsize',tabsize);
  }
  const saveSetting=obj=>{
    if(!ME)return;
    ME.settings=Object.assign(ME.settings||{},obj);
    api('dc_settings',{settings:JSON.stringify(obj)});
  };
  $$('.sidegroup .seg').forEach(b=>b.onclick=()=>{applySide(b.dataset.side,true);saveSetting({side});});
  $$('.tabsizegroup .seg').forEach(b=>b.onclick=()=>{applyTabsize(b.dataset.tabsize,true);saveSetting({tabsize});});

  /* timestamps, tab position, notifications */
  function applyTimefmt(v,persist){
    timefmt=v==='clock'?'clock':'relative';
    $$('.timefmtgroup .seg').forEach(b=>b.classList.toggle('sel',b.dataset.timefmt===timefmt));
    if(persist)localStorage.setItem('dc_timefmt',timefmt);
    lastSig=null;if(cache[ctx])render(cache[ctx]);
  }
  let tabpos='middle';
  function applyTabpos(v,persist){
    tabpos=['top','middle','bottom'].includes(v)?v:'middle';
    toggleEl.classList.remove('pos-top','pos-middle','pos-bottom');
    toggleEl.classList.add('pos-'+tabpos);
    $$('.tabposgroup .seg').forEach(b=>b.classList.toggle('sel',b.dataset.tabpos===tabpos));
    if(persist)localStorage.setItem('dc_tabpos',tabpos);
  }
  $$('.timefmtgroup .seg').forEach(b=>b.onclick=()=>{applyTimefmt(b.dataset.timefmt,true);saveSetting({timefmt});});
  $$('.tabposgroup .seg').forEach(b=>b.onclick=()=>{applyTabpos(b.dataset.tabpos,true);saveSetting({tabpos});});

  /* ---- accent colour ---- */
  const ACCENT_DEFAULT='#7fb0d4';
  const accentPick=$('.accentpick'), accentHex=$('.accenthex');
  const isHex=v=>/^#[0-9a-fA-F]{6}$/.test(v);
  const hexToRgb=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)).join(',');
  /* hue + saturation of a hex, so the panel's greys can be tinted to match */
  function hexToHs(hex){
    const [r,g,b]=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
    const mx=Math.max(r,g,b), mn=Math.min(r,g,b), d=mx-mn, l=(mx+mn)/2;
    let h=0;
    if(d){
      h=mx===r?((g-b)/d+(g<b?6:0)):mx===g?((b-r)/d+2):((r-g)/d+4);
      h*=60;
    }
    const sat=d?d/(1-Math.abs(2*l-1)):0;
    return {h:Math.round(h),s:Math.round(sat*100)};
  }
  /* ---- the TaskFlow look ----
     TaskFlow's appearance lives in user_preferences.theme_colors: either the
     new UI (a preset, light + dark palettes from src/modern/tokens.css) or the
     classic UI (its own defaults plus custom bg/text/border/accent, status
     colours and a background image). The same palette is rebuilt here and
     written onto the host element, which every part of the panel reads. */
  const PRESETS={   /* bg, bg-2, bg-3, bg-4, border, border-light, text, muted, dim, accent, sidebar */
    slate: {light:['#f7f7f8','#ffffff','#f1f1f3','#e7e7ea','#e5e5e9','#d6d6db','#18181b','#5d5d66','#97979f','#4f5bd5','#f1f1f3'],
            dark: ['#111113','#18181b','#202024','#2a2a2f','#26262b','#34343a','#ececef','#a1a1aa','#6b6b74','#7b86f0','#141416']},
    ocean: {light:['#f5f8fb','#ffffff','#edf2f7','#e1e9f1','#e0e7ee','#cfd9e3','#0f1a24','#51606e','#91a0ad','#0a74b8','#edf2f7'],
            dark: ['#0d141b','#131c25','#1a2530','#23303c','#1f2b37','#2c3a48','#e6edf3','#9aabbb','#637383','#3ea4e6','#0f171f']},
    forest:{light:['#f6f8f6','#ffffff','#eef3ef','#e2eae4','#e0e7e1','#cfdad2','#142018','#546259','#94a299','#1d8048','#eef3ef'],
            dark: ['#0e1411','#141b17','#1b241f','#243029','#202b25','#2d3a32','#e5ede8','#9bb0a2','#64786b','#3fbf75','#101713']},
    rose:  {light:['#faf7f8','#ffffff','#f5eef1','#ede2e6','#ece2e5','#dfd0d6','#22161a','#6b5960','#a8969d','#cc2f66','#f5eef1'],
            dark: ['#151012','#1c1518','#251c20','#30252a','#2c2226','#3a2d33','#f1e8eb','#b39fa6','#7a6870','#ef6491','#181214']},
    sand:  {light:['#f9f7f3','#fffdf9','#f3efe7','#e9e3d6','#e9e3d8','#dbd2c2','#241f17','#695f51','#a59b8b','#b9520f','#f3efe7'],
            dark: ['#14120e','#1b1814','#24201a','#2f2a22','#2b261f','#3a342a','#f0ebe2','#b3a895','#7b725f','#e98a42','#171511']},
    violet:{light:['#f8f7fb','#ffffff','#f1eff8','#e6e2f1','#e6e2ef','#d7d1e6','#1b1726','#5f5970','#9e98af','#6a47dc','#f1eff8'],
            dark: ['#121019','#18151f','#211d2a','#2b2636','#27222f','#353040','#ece9f3','#a8a1b8','#6f6880','#9c7ef6','#14121b']}
  };
  const MODERN_ST={light:{critical:'#dc2f3c',open:'#2f6fdf',in_progress:'#d48806',on_hold:'#7c5cdb',completed:'#1f9d55',warn:'#d97706',info:'#2f6fdf'},
                   dark: {critical:'#f2555f',open:'#5b9bf5',in_progress:'#f0b43c',on_hold:'#a48bf2',completed:'#3cc47c',warn:'#f0a83a',info:'#5b9bf5'}};
  const CLASSIC={   /* TaskFlow's original look (src/index.css) */
    dark: {bg:'#0a0a0f',bg2:'#111118',bg3:'#1a1a24',bg4:'#22222f',border:'#2a2a3a',borderL:'#333344',text:'#e8e8f0',muted:'#7878a0',dim:'#4a4a6a',accent:'#6366f1',
           st:{critical:'#f87171',open:'#60a5fa',in_progress:'#fbbf24',on_hold:'#a78bfa',completed:'#4ade80',warn:'#f59e0b',info:'#3b82f6'}},
    light:{bg:'#f4f4f8',bg2:'#ffffff',bg3:'#ededf3',bg4:'#e2e2ea',border:'#d8d8e4',borderL:'#c8c8d8',text:'#12121c',muted:'#5a5a78',dim:'#9898b4',accent:'#6366f1',
           st:{critical:'#f87171',open:'#60a5fa',in_progress:'#fbbf24',on_hold:'#a78bfa',completed:'#4ade80',warn:'#d97706',info:'#2563eb'}}
  };
  const hexOk=v=>/^#?[0-9a-f]{6}$/i.test(String(v||'').trim())||/^#?[0-9a-f]{3}$/i.test(String(v||'').trim());
  function rgbOf(h){let s=String(h).trim().replace('#','');if(s.length===3)s=s.split('').map(c=>c+c).join('');const n=parseInt(s,16);return [(n>>16)&255,(n>>8)&255,n&255];}
  const mixHex=(a,b,t)=>{const A=rgbOf(a),B=rgbOf(b);return '#'+A.map((x,i)=>Math.round(x+(B[i]-x)*t).toString(16).padStart(2,'0')).join('');};
  const rgbaOf=(h,a)=>'rgba('+rgbOf(h).join(',')+','+a+')';
  const lumOf=h=>{const [r,g,b]=rgbOf(h);return .299*r+.587*g+.114*b;};
  /* readable ink on a coloured chip (TaskFlow profile colours run dark and light) */
  const inkOn=h=>hexOk(h)&&lumOf(h)<150?'#ffffff':'#101012';
  let tfColors=(()=>{try{return JSON.parse(localStorage.getItem('dc_tf_look'))||{};}catch(e){return {};}})();
  let LOOK={accent:ACCENT_DEFAULT,mode:'dark'};
  function lookMode(){
    const m=(ME&&ME.settings&&ME.settings.mode)||localStorage.getItem('dc_mode')||'dark';
    if(m==='system')return matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';
    return m==='light'?'light':'dark';
  }
  const followTf=()=>!(ME&&ME.settings&&+ME.settings.tflook===0)&&localStorage.getItem('dc_tflook')!=='0';
  /* the phone's own overrides, same rule as TaskFlow's resolveForDevice */
  function tfResolved(){
    const {mobile,...base}=tfColors||{};
    if(!mobile||typeof mobile!=='object'||!matchMedia('(max-width: 768px)').matches)return base;
    const out={...base};
    Object.entries(mobile).forEach(([k,v])=>{if(k==='modernUi'||k==='preset')return;v===null?delete out[k]:out[k]=v;});
    return out;
  }
  function applyLook(){
    const mode=lookMode(), c=followTf()?tfResolved():{};
    /* not following TaskFlow (or not signed in yet): TaskFlow's default new UI */
    const modern=!followTf()||!!c.modernUi||!Object.keys(c).length;
    let P;
    if(modern){
      const p=(PRESETS[c.preset]||PRESETS.slate)[mode];
      P={bg:p[0],bg2:p[1],bg3:p[2],bg4:p[3],border:p[4],borderL:p[5],text:p[6],muted:p[7],dim:p[8],accent:p[9],side:p[10],
         st:MODERN_ST[mode],font:"'Inter'",r:[6,8,12]};
    }else{
      const d=CLASSIC[mode];
      P={...d,st:{...d.st},side:null,font:"'Space Grotesk'",r:[3,4,6]};
      if(hexOk(c.bg)){P.bg=c.bg;P.bg2=mixHex(c.bg,'#ffffff',.045);P.bg3=mixHex(c.bg,'#ffffff',.09);P.bg4=mixHex(c.bg,'#ffffff',.14);}
      if(hexOk(c.text)){P.text=c.text;P.muted=rgbaOf(c.text,.62);P.dim=rgbaOf(c.text,.42);}
      if(hexOk(c.border)){P.border=c.border;P.borderL=mixHex(c.border,lumOf(c.border)>140?'#000000':'#ffffff',.18);}
      if(hexOk(c.accent))P.accent=c.accent;
      ['critical','open','in_progress','on_hold','completed'].forEach(k=>{if(hexOk(c[k]))P.st[k]=c[k];});
      if(c.background){
        P.bgImg=c.background;
        P.blur=c.glassBlur==null?14:+c.glassBlur||0;
        P.tint=hexOk(c.bgTint)?c.bgTint:'#000000';
        P.tintOp=Math.round(Math.min(.9,Math.max(0,+c.bgTintOpacity||0))*100);
      }
    }
    const light=lumOf(hexOk(P.bg)?P.bg:'#000000')>140;
    const V={
      '--bg':P.bg,'--surface':P.bg2,'--surface2':P.bg3,'--tab-active':light?P.bg2:P.bg4,
      '--text':P.text,'--text-strong':P.text,'--text-soft':`color-mix(in srgb, ${P.text} 84%, ${P.bg})`,
      '--dim':P.muted,'--faint':`color-mix(in srgb, ${P.muted} 55%, ${P.dim})`,'--fainter':P.dim,
      '--hint':`color-mix(in srgb, ${P.dim} 75%, ${P.bg})`,
      '--line':P.border,'--line-soft':`color-mix(in srgb, ${P.border} 62%, ${P.bg})`,'--line-strong':P.borderL,
      '--compose-bg':P.side||P.bg,'--rail-bg':P.side||P.bg,'--menu-bg':P.bg2,'--toggle-bg':P.bg2,'--toggle-hover':P.bg3,
      '--font':P.font+',ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
      '--r-sm':P.r[0]+'px','--r-md':P.r[1]+'px','--r-lg':P.r[2]+'px','--r-ava':'50%',
      '--heart':P.st.critical,'--ok':P.st.completed,'--warn':P.st.warn,'--info':P.st.info,
      '--st-critical':P.st.critical,'--st-open':P.st.open,'--st-inprogress':P.st.in_progress,
      '--st-onhold':P.st.on_hold,'--st-completed':P.st.completed,
      '--top-glint':light?'rgba(255,255,255,.65)':'rgba(255,255,255,.06)','--texture-alpha':'0',
      '--panel-shadow':light?'-24px 0 60px rgba(16,18,24,.16),-1px 0 0 rgba(16,18,24,.06)':'-28px 0 70px rgba(0,0,0,.6),-1px 0 0 rgba(255,255,255,.06)'
    };
    Object.entries(V).forEach(([k,v])=>host.style.setProperty(k,v));
    host.dataset.mode=light?'light':'dark';
    LOOK={...P,mode:light?'light':'dark',modern,preset:modern?(PRESETS[c.preset]?c.preset:'slate'):null,
      fontScale:followTf()?(+c.fontScale||1):1};
    applyAccent(accentOwn);
    if(typeof applyBg==='function')try{applyBg();paintBgControls();}catch(e){}
    if(typeof paintLookControls==='function')paintLookControls();
  }
  let accentOwn='';
  function applyAccent(v,persist){
    const hex=isHex(v||'')?v.toLowerCase():'';
    accentOwn=hex;
    const use=hex||(LOOK.accent&&hexOk(LOOK.accent)?LOOK.accent:ACCENT_DEFAULT);
    const hs=hexToHs(use), ink=lumOf(use)>165?'#0b0b0e':'#ffffff';
    /* everything reads these from the host: panel, tab, pins, page chrome */
    [['--acc1',use],['--acc2',use],['--acc-grad',use],['--acc-soft',use],['--glow',hexToRgb(use)],
     ['--acc-text',ink],['--live',use],['--acc-h',hs.h],['--acc-s',hs.s+'%']]
      .forEach(([k,val])=>host.style.setProperty(k,val));
    if(barStyle){showPageBar();hidePageBar();}   /* restyle the page bar */
    accentPick.value=use;accentHex.value=hex;
    if(persist)localStorage.setItem('dc_accent',hex);
  }
  accentPick.addEventListener('input',()=>{applyAccent(accentPick.value,true);saveSetting({accent:accentPick.value.toLowerCase()});});
  accentHex.addEventListener('input',()=>{
    const v=accentHex.value.trim();
    if(isHex(v)){applyAccent(v,true);saveSetting({accent:v.toLowerCase()});}
  });
  $('.accentreset').onclick=()=>{applyAccent('',true);saveSetting({accent:''});};

  /* ---- your name's colour and effect ---- */
  const namePick=$('.namepick'), nameHex=$('.namehex'),
        namePick2=$('.namepick2'), nameHex2=$('.namehex2');
  let namecolor='', namecolor2='';
  function applyNamecolor(v,persist){
    namecolor=isHex(v||'')?v.toLowerCase():'';
    namePick.value=namecolor||'#f0f2f5';
    nameHex.value=namecolor;
    if(persist)localStorage.setItem('dc_namecolor',namecolor);
    lastSig=null;if(cache[ctx])render(cache[ctx]);
  }
  function applyNamecolor2(v,persist){
    namecolor2=isHex(v||'')?v.toLowerCase():'';
    namePick2.value=namecolor2||'#9d7cff';
    nameHex2.value=namecolor2;
    if(persist)localStorage.setItem('dc_namecolor2',namecolor2);
    lastSig=null;if(cache[ctx])render(cache[ctx]);
  }
  namePick2.addEventListener('input',()=>{applyNamecolor2(namePick2.value,true);saveSetting({namecolor2:namePick2.value.toLowerCase()});});
  nameHex2.addEventListener('input',()=>{
    const v=nameHex2.value.trim();
    if(isHex(v)){applyNamecolor2(v,true);saveSetting({namecolor2:v.toLowerCase()});}
    else if(v===''){applyNamecolor2('',true);saveSetting({namecolor2:''});}
  });
  $('.namereset2').onclick=()=>{applyNamecolor2('',true);saveSetting({namecolor2:''});};
  namePick.addEventListener('input',()=>{applyNamecolor(namePick.value,true);saveSetting({namecolor:namePick.value.toLowerCase()});});
  nameHex.addEventListener('input',()=>{
    const v=nameHex.value.trim();
    if(isHex(v)){applyNamecolor(v,true);saveSetting({namecolor:v.toLowerCase()});}
    else if(v===''){applyNamecolor('',true);saveSetting({namecolor:''});}
  });
  $('.namereset').onclick=()=>{applyNamecolor('',true);saveSetting({namecolor:''});};

  /* ---- image & GIF size ---- */
  const MD_MIN=120, MD_MAX=560, MD_STEP=40, MD_DEFAULT=160;
  const mdVal=$('.mdval'), mdBar=$('.mdbar'), mdDown=$('.mddown'), mdUp=$('.mdup');
  let media=MD_DEFAULT, mediaTimer=null;
  function applyMedia(px,persist){
    media=Math.max(MD_MIN,Math.min(MD_MAX,Math.round((parseFloat(px)||MD_DEFAULT)/MD_STEP)*MD_STEP));
    panel.style.setProperty('--media-max',media+'px');
    mdVal.textContent=media+'px';
    mdBar.style.width=((media-MD_MIN)/(MD_MAX-MD_MIN)*100)+'%';
    mdDown.disabled=media<=MD_MIN;mdUp.disabled=media>=MD_MAX;
    if(persist)localStorage.setItem('dc_media',media);
  }
  function saveMedia(){
    localStorage.setItem('dc_media',media);
    if(!ME)return;
    ME.settings=ME.settings||{};ME.settings.media=media;
    clearTimeout(mediaTimer);
    mediaTimer=setTimeout(()=>api('dc_settings',{settings:JSON.stringify({media})}),300);
  }
  const stepMedia=d=>{applyMedia(media+d,true);saveMedia();};
  mdDown.onclick=()=>stepMedia(-MD_STEP);
  mdUp.onclick=()=>stepMedia(MD_STEP);
  $('.mdreset').onclick=()=>{applyMedia(MD_DEFAULT,true);saveMedia();};

  const SC_MIN=70, SC_MAX=160, SC_STEP=10;
  const scVal=$('.scval'), scBar=$('.scbar span'), scDown=$('.scdown'), scUp=$('.scup');
  let scale=100, scaleTimer=null;

  function applyScale(pct,persist){
    scale=Math.max(SC_MIN,Math.min(SC_MAX,Math.round(parseFloat(pct)/SC_STEP)*SC_STEP||100));
    panel.style.setProperty('--ui-scale',scale/100);
    scVal.textContent=scale+'%';
    scBar.style.width=((scale-SC_MIN)/(SC_MAX-SC_MIN)*100)+'%';
    scDown.disabled=scale<=SC_MIN;scUp.disabled=scale>=SC_MAX;
    if(persist)localStorage.setItem('dc_scale',scale);
    if(typeof syncTabBand==='function')syncTabBand();   /* zoom changes the tab row height */
  }
  function saveScale(){
    localStorage.setItem('dc_scale',scale);
    if(!ME)return;
    ME.settings=ME.settings||{};ME.settings.scale=scale;
    clearTimeout(scaleTimer);
    scaleTimer=setTimeout(()=>api('dc_settings',{settings:JSON.stringify({scale})}),300);
  }
  const stepScale=d=>{applyScale(scale+d,true);saveScale();};
  scDown.onclick=()=>stepScale(-SC_STEP);
  scUp.onclick=()=>stepScale(SC_STEP);
  $('.screset').onclick=()=>{applyScale(100,true);saveScale();};

  function applyWidth(pct,persist){
    pct=Math.max(20,Math.min(90,Math.round(parseFloat(pct))||30));  /* default 30% */
    /* % of the panel's own container, not vw: vw includes the scrollbar and
       disagrees with the measurements used during a drag */
    panel.style.width='calc('+pct+'% + var(--sbw,0px))';   /* keep the scrollbar allowance */
    panel.style.minWidth='320px';
    if(persist)localStorage.setItem('dc_width',pct);
    return pct;
  }

  /* drag the panel's left edge to resize, live.
     The handle expands to a full-screen overlay for the duration of the drag:
     pointer capture does not hold inside a top-layer popover, so bound to its
     13px strip the handle stopped receiving moves the moment the cursor
     outran the edge — which looked like lag and snapped straight on release.
     Width is solved absolutely each frame, so it cannot drift. */
  let dragging=false, widthSaveTimer=null, dragRaf=null;
  let grabOffset=0, lastX=0, targetW=0;

  /* Width is written as a PERCENT, never px. getBoundingClientRect() reports
     zoom-scaled pixels while a px width is taken in unzoomed local pixels, so
     any CSS zoom on an ancestor makes the two disagree (here by ~11%). A
     percent resolves against the same box the rects are measured in, so the
     edge lands exactly under the cursor at any zoom or DPI. */
  let dragPct=30, hostRect=null;
  function paintDrag(){
    dragRaf=null;
    if(!dragging||!hostRect)return;
    /* hostRect is measured once at drag start: reading layout here would force
       a synchronous reflow every frame right after we wrote a new width */
    const edge=side==='left'
      ?(lastX+grabOffset)-hostRect.left
      :hostRect.right-(lastX+grabOffset);
    const wantPx=Math.max(320,Math.min(hostRect.width*0.94,edge));
    dragPct=wantPx/hostRect.width*100;
    targetW=wantPx;
    panel.style.width=dragPct.toFixed(3)+'%';
  }

  function startDrag(e){
    if(e.button)return;
    dragging=true;
    lastX=e.clientX;
    hostRect=host.getBoundingClientRect();                    /* measured once */
    const pr=panel.getBoundingClientRect();
    grabOffset=(side==='left'?pr.right:pr.left)-e.clientX;    /* no snap on click */
    targetW=pr.width;
    panel.classList.add('resizing');
    resizer.classList.add('dragging');            /* full-screen hit area */
    try{resizer.setPointerCapture(e.pointerId);}catch(_){}
    document.documentElement.style.cursor='ew-resize';
    e.preventDefault();e.stopPropagation();
  }
  resizer.addEventListener('pointerdown',startDrag,true);
  resizer.addEventListener('mousedown',e=>{if(!dragging)startDrag(e);},true);

  function onMove(e){
    if(!dragging)return;
    lastX=e.clientX;
    if(dragRaf===null)dragRaf=requestAnimationFrame(paintDrag);
    e.preventDefault();
  }
  function finishDrag(e){
    if(!dragging)return;
    if(e&&e.clientX!==undefined)lastX=e.clientX;
    if(dragRaf!==null){cancelAnimationFrame(dragRaf);dragRaf=null;}
    paintDrag();
    dragging=false;
    resizer.classList.remove('dragging');
    panel.classList.remove('resizing');
    if(typeof syncDock==='function')try{syncDock();}catch(e){}   /* drag over: docking eases again */
    document.documentElement.style.cursor='';
    try{if(e&&e.pointerId!==undefined&&resizer.hasPointerCapture&&resizer.hasPointerCapture(e.pointerId))
      resizer.releasePointerCapture(e.pointerId);}catch(_){}
    const pct=Math.max(20,Math.min(90,Math.round(dragPct)));
    applyWidth(pct);
    saveWidth(pct);
  }
  /* listen on the handle (now full-screen) and on window, belt and braces */
  ['pointermove','mousemove'].forEach(t=>{
    resizer.addEventListener(t,onMove,{capture:true,passive:false});
    window.addEventListener(t,onMove,{capture:true,passive:false});
  });
  ['pointerup','mouseup','pointercancel'].forEach(t=>{
    resizer.addEventListener(t,finishDrag,true);
    window.addEventListener(t,finishDrag,true);
  });
  window.addEventListener('blur',finishDrag);
  resizer.addEventListener('click',e=>{e.stopPropagation();e.preventDefault();},true);

  function saveWidth(pct){
    localStorage.setItem('dc_width',pct);
    if(!ME)return;
    ME.settings=ME.settings||{};ME.settings.width=pct;
    clearTimeout(widthSaveTimer);
    widthSaveTimer=setTimeout(()=>api('dc_settings',{settings:JSON.stringify({width:pct})}),300);
  }

  resizer.addEventListener('keydown',e=>{
    const hostW=host.getBoundingClientRect().width||window.innerWidth;
    const cur=Math.round(panel.getBoundingClientRect().width/hostW*100);
    if(e.key==='ArrowLeft'){applyWidth(cur+2);saveWidth(Math.min(90,cur+2));e.preventDefault();}
    if(e.key==='ArrowRight'){applyWidth(cur-2);saveWidth(Math.max(20,cur-2));e.preventDefault();}
  });

  function setAuthed(user){
    notifSeen=null;   /* fresh baseline per session */
    ME=user;
    compose.style.display=user?'':'none';
    authBox.classList.toggle('show',!user);
    logoutBtn.classList.toggle('show',!!user);
    gearBtn.classList.toggle('show',!!user);
    $('.mebtn').classList.toggle('show',!!user);
    if(!user&&typeof closeMeMenu==='function')closeMeMenu();
    $('.bellbtn').classList.toggle('show',!!user);
    panel.classList.toggle('locked',!user);   /* blur the chat when signed out */
    $('.rail').classList.toggle('out',!user);
    /* queried live: setAuthed runs at boot, before the notification block's
       consts are initialised */
    if(!user){closeSettings();$('.notifcfg').classList.remove('show');}
    else if(typeof paintBell==='function')paintBell();
    if(typeof presenceBeat==='function'){try{user?presenceBeat():setPresence([]);}catch(e){}}
    if(!user&&typeof tfReset==='function')tfReset();
    syncMeAva(user);
    gifWatched=null;   /* watch history is per account */
    if(user){
      const st=user.settings||{};
      if(st.mode)localStorage.setItem('dc_mode',st.mode);
      if(st.tflook!==undefined)localStorage.setItem('dc_tflook',String(+st.tflook));
    }
    /* signed in: the account's width wins and refreshes the local cache;
       signed out or still booting: paint from the cache so there is no jump */
    applyWidth(user?(user.settings&&user.settings.width):localStorage.getItem('dc_width'),!!user);
    applyScale(user?((user.settings&&user.settings.scale)||Math.round((LOOK.fontScale||1)*10)*10):(localStorage.getItem('dc_scale')||100),!!user&&!!(user.settings&&user.settings.scale));
    applyMedia(user?((user.settings&&user.settings.media)||MD_DEFAULT):(localStorage.getItem('dc_media')||MD_DEFAULT),!!user);
    applySide(user?((user.settings&&user.settings.side)||'right'):(localStorage.getItem('dc_side')||'right'),!!user);
    applyTabsize(user?((user.settings&&user.settings.tabsize)||'m'):(localStorage.getItem('dc_tabsize')||'m'),!!user);
    accentOwn=user?((user.settings&&user.settings.accent)||''):(localStorage.getItem('dc_accent')||'');
    if(user)localStorage.setItem('dc_accent',accentOwn);
    applyLook();   /* also applies the accent and the background */
    applyNamecolor(user?(user.settings&&user.settings.namecolor):(localStorage.getItem('dc_namecolor')||''),!!user);
    applyNamecolor2(user?(user.settings&&user.settings.namecolor2):(localStorage.getItem('dc_namecolor2')||''),!!user);
    applyTimefmt(user?((user.settings&&user.settings.timefmt)||'relative'):(localStorage.getItem('dc_timefmt')||'relative'),!!user);
    applyTabpos(user?((user.settings&&user.settings.tabpos)||'middle'):(localStorage.getItem('dc_tabpos')||'middle'),!!user);

    if(cache[ctx])render(cache[ctx]);             /* re-render: own actions appear */
    updateBadges();
    if(user)maybeTour(user);
  }

  /* your picture: the TaskFlow profile photo, else your TaskFlow colour */
  const meAvatar=()=>ME?((ME.settings&&ME.settings.avatar)||ME.avatar||''):'';
  const meColor=()=>ME?(hexOk(ME.color)?ME.color:color(ME.name)):'var(--surface2)';
  function syncMeAva(user){
    const av=meAvatar(), bg=meColor(), ink=user&&hexOk(user.color)?inkOn(user.color):'#101012';
    [meAva,$('.tfa-ava')].forEach(el=>{
      if(!el)return;
      el.textContent=av?'':user?user.name[0].toUpperCase():'?';
      el.style.background=av?'':bg;
      el.style.color=ink;
      el.style.backgroundImage=av?`url('${av}')`:'';
      el.style.backgroundSize=av?'cover':'';
      el.style.backgroundPosition=av?'center':'';
    });
    [$('.mebtn'),$('.mm-ava')].forEach(el=>{
      if(!el)return;
      el.textContent=av?'':user?user.name[0].toUpperCase():'';
      el.style.background=av?`center/cover url('${av}')`:bg;
      el.style.color=ink;
    });
    const mn=$('.mm-name');if(mn)mn.textContent=user?user.name:'';
    if(typeof paintAccount==='function')paintAccount();
  }


  /* ================= per-user panel background ================= */
  const bgPrev=$('.bgprev'), bgUp=$('.bgup'), bgRm=$('.bgrm'), bgFile=$('.bgfile'),
        bgBlur=$('.bgblur'), bgTint=$('.bgtint'), bgOp=$('.bgop'),
        bgBlurV=$('.bgblurv'), bgOpV=$('.bgopv'), bgCtl=$('.bgctl');
  /* the panel's own image wins; with none set, the TaskFlow (classic UI)
     background and its blur and tint come through. 'none' turns both off. */
  const bgCfg=()=>{
    const st=(ME&&ME.settings)||{};
    const tf=ME&&LOOK.bgImg&&st.bg_img!=='none'?LOOK:null;
    const own=st.bg_img&&st.bg_img!=='none'?st.bg_img:'';
    return {
      img:own||(tf?tf.bgImg:''),
      fromTf:!own&&!!tf,
      blur:st.bg_blur!==undefined?+st.bg_blur:tf?tf.blur:0,
      tint:st.bg_tint!==undefined&&st.bg_tint!==''?st.bg_tint:tf?tf.tint:'',
      op:st.bg_opacity!==undefined?+st.bg_opacity:tf?tf.tintOp:60
    };
  };
  /* paint the panel from the stored values; also used on sign-in */
  /* how far the header's sheet must reach to sit behind the tab row: the row's
     own height plus its margins, measured because tab size is a setting */
  function syncTabBand(){
    const t=$('.tabs');
    if(!t)return;
    const h=t.getBoundingClientRect().height||t.offsetHeight;   /* survives ui zoom */
    panel.style.setProperty('--tabband',Math.round(h+32)+'px');
  }
  function applyBg(){
    syncTabBand();
    const c=bgCfg(), on=!!c.img;
    panel.classList.toggle('has-bg',on);
    panel.style.setProperty('--bg-img',on?`url("${c.img}")`:'none');
    panel.style.setProperty('--bg-blur',c.blur+'px');
    panel.style.setProperty('--bg-tint',c.tint||'transparent');
    panel.style.setProperty('--bg-op',on&&c.tint?(c.op/100):'0');
  }
  function paintBgControls(){
    const c=bgCfg();
    bgPrev.classList.toggle('has',!!c.img);
    bgPrev.style.backgroundImage=c.img?`url("${c.img}")`:'';
    const st=(ME&&ME.settings)||{}, offTf=st.bg_img==='none'&&!!LOOK.bgImg;
    bgRm.classList.toggle('show',!!c.img||offTf);
    bgRm.textContent=offTf?'Use TaskFlow background':'Remove';
    bgPrev.title=c.fromTf?'Your TaskFlow background':'';
    bgCtl.classList.toggle('off',!c.img);
    bgBlur.value=c.blur;bgBlurV.textContent=c.blur+'px';
    bgOp.value=c.op;bgOpV.textContent=c.op+'%';
    bgTint.value=/^#[0-9a-f]{6}$/i.test(c.tint)?c.tint:'#141416';
  }
  const saveBg=obj=>{
    if(!ME)return;
    ME.settings=Object.assign(ME.settings||{},obj);
    applyBg();
    api('dc_settings',{settings:JSON.stringify(obj)});
  };
  bgUp.onclick=()=>bgFile.click();
  bgFile.addEventListener('change',()=>{
    const f=bgFile.files[0];bgFile.value='';
    if(!f||!ME)return;
    const img=new Image();
    img.onload=()=>{
      /* downscale to something sane for a side panel before uploading */
      const MAX=1400;
      const sc=Math.min(1,MAX/Math.max(img.width,img.height));
      const cv=document.createElement('canvas');
      cv.width=Math.round(img.width*sc);cv.height=Math.round(img.height*sc);
      cv.getContext('2d').drawImage(img,0,0,cv.width,cv.height);
      const b64=cv.toDataURL('image/jpeg',.86).split(',')[1];
      bgUp.disabled=true;bgUp.textContent='Uploading…';
      api('dc_upload',{type:'image/jpeg',data:b64}).then(j=>{
        bgUp.disabled=false;bgUp.textContent='Upload image';
        if(!j.success){alert((j.data&&j.data.msg)||'Upload failed.');return;}
        const cur=bgCfg();
        saveBg({bg_img:j.data.url,bg_tint:cur.tint||'#141416',bg_opacity:cur.op,bg_blur:cur.blur});
        paintBgControls();
      });
    };
    img.onerror=()=>alert('Could not read that image.');
    img.src=URL.createObjectURL(f);
  });
  bgRm.onclick=()=>{
    const st=(ME&&ME.settings)||{};
    /* own image -> back to TaskFlow's (if any); TaskFlow's -> none; none -> TaskFlow's */
    const next=st.bg_img==='none'?'':(bgCfg().fromTf?'none':'');
    saveBg({bg_img:next});paintBgControls();
  };
  /* sliders preview live, save when released */
  bgBlur.addEventListener('input',()=>{
    bgBlurV.textContent=bgBlur.value+'px';
    panel.style.setProperty('--bg-blur',bgBlur.value+'px');
  });
  bgBlur.addEventListener('change',()=>saveBg({bg_blur:+bgBlur.value}));
  bgOp.addEventListener('input',()=>{
    bgOpV.textContent=bgOp.value+'%';
    panel.style.setProperty('--bg-op',(+bgOp.value/100));
  });
  bgOp.addEventListener('change',()=>saveBg({bg_opacity:+bgOp.value}));
  bgTint.addEventListener('input',()=>panel.style.setProperty('--bg-tint',bgTint.value));
  bgTint.addEventListener('change',()=>saveBg({bg_tint:bgTint.value}));
  $('.bgtintclear').onclick=()=>{saveBg({bg_tint:''});paintBgControls();};

  /* settings is a full page in the tab area; gear toggles it, tabs leave it */
  function openSettings(){
    panel.classList.add('settings-open');gearBtn.classList.add('openm');
    $('.rset').classList.add('on');
    sub.textContent='Settings';
    showSec('you');
    paintAccount();paintLookControls();
  }
  function closeSettings(){
    if(!panel.classList.contains('settings-open'))return;
    panel.classList.remove('settings-open');gearBtn.classList.remove('openm');
    $('.rset').classList.remove('on');
    sub.textContent=viewTitle();
    /* slide the comment view back in */
    panel.classList.remove('returning');void panel.offsetWidth;panel.classList.add('returning');
    setTimeout(()=>panel.classList.remove('returning'),300);
  }
  /* settings sections */
  function showSec(sec){
    $$('.snavb').forEach(b=>b.classList.toggle('sel',b.dataset.sec===sec));
    $$('.spage .sgroup').forEach(g=>{g.hidden=g.dataset.sec!==sec;});
    const sp=$('.spage');if(sp)sp.scrollTop=0;
  }
  $$('.snavb').forEach(b=>b.onclick=()=>showSec(b.dataset.sec));
  showSec('you');
  $('.sclose').onclick=closeSettings;
  gearBtn.onclick=()=>panel.classList.contains('settings-open')?closeSettings():openSettings();
  $('.rset').onclick=()=>gearBtn.click();

  /* ---- TaskFlow account card, team picker, theme ---- */
  function paintAccount(){
    if(!ME)return;
    $('.tfa-name').textContent=ME.name;
    $('.tfa-mail').textContent=ME.email&&ME.email.indexOf('sb-')!==0?ME.email:'';
    $('.tfa-edit').href=TF_APP?TF_APP+'/settings':'#';
    const teams=ME.teams||[], row=$('.tfteamrow'), sel=$('.tfteamsel');
    row.hidden=!!TEAM_LOCK||teams.length<2;
    sel.innerHTML=teams.map(t=>`<option value="${escHtml(t.id)}">${escHtml(t.name)}</option>`).join('');
    if(TFS.team)sel.value=TFS.team;
    const team=teams.find(t=>t.id===(TEAM_LOCK||TFS.team));
    const role=team?({owner:'Owner',admin:'Admin',member:'Member'}[team.role]||'Member'):'';
    $('.tfa-role').textContent=(team?`${team.name} · ${role}`:'')
      +(ME.is_admin?(team?' · ':'')+'You can moderate comments on this site.':'');
  }
  $('.tfteamsel').onchange=e=>{tfSwitchTeam(e.target.value);paintAccount();};
  $('.tfa-out').onclick=()=>logoutBtn.click();
  function paintLookControls(){
    const m=(ME&&ME.settings&&ME.settings.mode)||localStorage.getItem('dc_mode')||'dark';
    $$('.modegroup .seg').forEach(b=>b.classList.toggle('sel',b.dataset.mode===m));
    const on=followTf();
    $('.tflook').checked=on;
    const c=tfResolved(), d=$('.tflookdesc');
    if(!on)d.textContent='Off — the panel uses TaskFlow’s default look.';
    else if(!Object.keys(c).length)d.textContent='Nothing customised in TaskFlow yet, so this is its default look.';
    else if(c.modernUi)d.textContent='New UI · '+((LOOK.preset||'slate').replace(/^./,x=>x.toUpperCase()))+' preset.';
    else d.textContent='Classic UI'+(c.background?' with your background image':'')+(hexOk(c.accent)?' and your accent':'')+'.';
  }
  $$('.modegroup .seg').forEach(b=>b.onclick=()=>{
    localStorage.setItem('dc_mode',b.dataset.mode);
    if(ME)ME.settings=Object.assign(ME.settings||{},{mode:b.dataset.mode});
    applyLook();saveSetting({mode:b.dataset.mode});
  });
  matchMedia('(prefers-color-scheme: light)').addEventListener('change',()=>{
    if(((ME&&ME.settings&&ME.settings.mode)||localStorage.getItem('dc_mode'))==='system')applyLook();
  });
  $('.tflook').onchange=e=>{
    const v=e.target.checked?1:0;
    localStorage.setItem('dc_tflook',String(v));
    if(ME)ME.settings=Object.assign(ME.settings||{},{tflook:v});
    applyLook();saveSetting({tflook:v});
  };

  /* ---- sign in with TaskFlow ---- */
  const aEmail=$('.aemail'), aPass=$('.apass'), aErr=$('.aerr'), aOk=$('.aok'), aBtn=$('.abtn');
  $('.aregister').href=TF_APP?TF_APP+'/register':'#';
  if(!TF_APP)$('.aregister').style.display='none';
  function authError(msg){aOk.classList.remove('show');aErr.textContent=msg;aErr.classList.add('show');}
  /* the server mirrors the TaskFlow account; any problem (not in the site's
     team, keys missing) is reported and the TaskFlow session is dropped */
  function startSession(j){
    if(!j||!j.success){
      const code=j&&j.data&&j.data.code;
      if(code!=='setup')TF.signOut();
      throw new Error((j&&j.data&&j.data.msg)||'Could not sign in.');
    }
    setAuthed(j.data.user);
    loadAll();
    tfAfterLogin();
  }
  function submitAuth(){
    if(!TF_READY)return authError('TaskFlow isn’t connected yet. An admin needs to add the Supabase keys under Dev Comments → TaskFlow in WordPress.');
    const email=aEmail.value.trim(), pass=aPass.value;
    if(!email||!pass)return authError('Enter your TaskFlow email and password.');
    aErr.classList.remove('show');
    aBtn.disabled=true;aBtn.textContent='Signing in…';
    TF.signIn(email,pass)
      .then(()=>api('dc_session',{}))
      .then(j=>{startSession(j);aPass.value='';})
      .catch(e=>authError(/invalid login/i.test(e.message||'')?'Wrong email or password.':(e.message||'Network error. Try again.')))
      .finally(()=>{aBtn.disabled=false;aBtn.textContent='Sign in';});
  }
  aBtn.onclick=submitAuth;
  [aEmail,aPass].forEach(el=>el.addEventListener('keydown',e=>{if(e.key==='Enter')submitAuth();}));
  $('.aforgot').onclick=()=>{
    const email=aEmail.value.trim();
    if(!TF_READY)return authError('TaskFlow isn’t connected yet.');
    if(!email){aEmail.focus();return authError('Type your email first, then tap “Forgot password?”.');}
    TF.recover(email).then(()=>{
      aErr.classList.remove('show');
      aOk.textContent='Check your inbox for a TaskFlow password reset link.';aOk.classList.add('show');
    }).catch(e=>authError(e.message||'Could not send the reset email.'));
  };
  function doLogout(){
    TF.signOut();
    ['dc_width','dc_scale','dc_media','dc_side','dc_tabsize','dc_timefmt','dc_tabpos','dc_accent',
     'dc_namecolor','dc_namecolor2','dc_tf_look','dc_mode','dc_tflook'].forEach(k=>localStorage.removeItem(k));
    tfColors={};
    setAuthed(null);
  }
  logoutBtn.onclick=()=>{
    const draft=(textEl&&textEl.value.trim())?' Your unsent comment on this page is kept.':'';
    confirmDialog({
      title:'Sign out?',
      text:`This signs you out of TaskFlow on this site. Your comments stay where they are.${draft}`,
      ok:'Sign out',
      tone:'danger',
      go:doLogout
    });
  };

  /* ================= per-account unread tracking ================= */
  const seenKey=()=>'dc_seen_u'+(ME?ME.id:'guest');
  const getSeen=()=>{try{return JSON.parse(localStorage.getItem(seenKey()))||{}}catch(e){return{}}};
  const storeKey=w=>w==='page'?PAGE:'general';
  /* admin contexts are stored as /wp-admin:<screen>[-<post id>] */
  const adminLabel=p=>{
    const body=p.slice('/wp-admin:'.length).replace(/-(\d+)$/,' #$1');
    return 'Admin · '+body.replace(/[-_]/g,' ');
  };
  const adminHref=p=>{
    const m=p.slice('/wp-admin:'.length).match(/^(.*?)(?:-(\d+))?$/);
    const id=m[1]||'', post=m[2];
    if(post)return '/wp-admin/post.php?post='+post+'&action=edit';
    if(id==='dashboard')return '/wp-admin/';
    if(id.indexOf('edit-')===0)return '/wp-admin/edit.php?post_type='+id.slice(5);
    return '/wp-admin/'+(id==='admin'?'':id.replace(/_/g,'-')+'.php');
  };
  const isMine=r=>!!ME&&r.user_id===ME.id;
  const isMod=()=>!!(ME&&ME.is_admin);   /* moderators act on any comment */
  /* the id that existed when this account first loaded the panel: anything at
     or below it is backlog, not news, so a fresh account starts at zero */
  const joinKey=()=>'dc_join_u'+(ME?ME.id:'guest');
  const getJoin=()=>parseInt(localStorage.getItem(joinKey())||'0',10)||0;
  function setJoinBaseline(){
    if(!ME||localStorage.getItem(joinKey()))return;
    const all=[...(cache.page||[]),...(cache.general||[])];
    for(const k in cache.other)all.push(...cache.other[k]);
    const max=all.reduce((m,r)=>Math.max(m,parseInt(r.id,10)||0),0);
    try{localStorage.setItem(joinKey(),String(max));}catch(e){}
  }
  const countNew=(rows,key)=>{
    if(!ME)return 0;                       /* signed out: nothing to be unread */
    const floor=Math.max(getSeen()[key]||0,getJoin());
    return rows.filter(r=>parseInt(r.id,10)>floor&&!isMine(r)).length;
  };
  const unread=w=>cache[w]?countNew(cache[w],storeKey(w)):0;
  function markRead(w){
    const rows=cache[w];if(!rows)return;
    const max=rows.reduce((m,r)=>Math.max(m,parseInt(r.id,10)||0),0);
    const seen=getSeen();seen[storeKey(w)]=max;
    localStorage.setItem(seenKey(),JSON.stringify(seen));
  }
  const setCount=(el,n)=>{
    const prev=parseInt(el.textContent,10)||0;
    el.textContent=n;
    el.classList.toggle('zero',!n);
    if(n>prev){el.classList.remove('bump');void el.offsetWidth;el.classList.add('bump');}
  };
  function updateBadges(){
    try{railBadges();}catch(e){}
    const up=unread('page'), ug=unread('general');
    const others=Object.entries(cache.other)
      .map(([path,rows])=>[path,countNew(rows,path)])
      .filter(([,n])=>n>0);
    const uo=others.reduce((a,[,n])=>a+n,0);
    setCount(badge,0);   /* no count on the closed tab: ntfy handles notifying */
    setCount($('.tab[data-ctx="page"] .tabdot'),up);
    setCount($('.tab[data-ctx="general"] .tabdot'),ug);
    setCount($('.pages-tab .tabdot'),uo);
    setCount($('.notif-tab .tabdot'),ME?nfNew().length:0);
    if(typeof syncTabPins==='function')syncTabPins();
    $('.pagemenu').innerHTML=others.length
      ?others.map(([path,n])=>{
          const admin=path.indexOf('/wp-admin:')===0;
          const label=admin?adminLabel(path):path;
          const href=admin?adminHref(path):path;
          return `<a href="${href}" target="_blank" rel="noopener"><span class="opath">${label}</span><span class="ocount">${n}</span></a>`;
        }).join('')
      :'<div class="pm-empty">No new comments on other pages</div>';
  }

  /* ================= helpers ================= */
  const HUES=[212,262,330,152,32,190,0,92];
  function color(name){
    let h=0;for(const c of name)h=(h*31+c.charCodeAt(0))>>>0;
    return `hsl(${HUES[h%HUES.length]} 42% 68%)`;
  }
  let timefmt='relative';
  function timeAgo(str){
    const t=new Date(str.replace(' ','T'));
    if(timefmt==='clock'){
      const today=new Date().toDateString()===t.toDateString();
      const clock=t.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
      return today?clock:t.toLocaleDateString([],{month:'short',day:'numeric'})+' '+clock;
    }
    const d=(Date.now()-t)/1000;
    if(d<60)return'just now';if(d<3600)return Math.floor(d/60)+'m';
    if(d<86400)return Math.floor(d/3600)+'h';return Math.floor(d/86400)+'d';
  }
  const escHtml=s=>s.replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  /* url-safe base64 for data smuggled inside content tokens */
  const b64e=v=>btoa(unescape(encodeURIComponent(v))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const b64d=v=>{try{return decodeURIComponent(escape(atob(v.replace(/-/g,'+').replace(/_/g,'/'))));}catch(e){return'';}};
  const TOKRE=/\s*\[(pin|meta)\][^\[]*\[\/\1\]/g;   /* both invisible tokens */
  const stripTok=c=>c.replace(TOKRE,'');
  /* [img]url[/img] (paste-upload) -> thumbnail; [pin] -> chip; [meta] hidden.
     content is server-escaped */
  const rich=c=>c
    .replace(/\s*\[meta\][A-Za-z0-9\-_]+\[\/meta\]/g,'')
    .replace(/\s*\[pin\]([A-Za-z0-9\-_]+)\|([\d.]+)\|([\d.]+)(?:\|([A-Za-z0-9\-_]+))?\[\/pin\]/g,
      '<button class="pinchip" data-sel="$1" data-x="$2" data-y="$3" data-app="$4">'
      +'<svg viewBox="0 0 24 24"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>'
      +'Pinned element</button>')
    .replace(/\[img\](https?:[^\s\[\]<>"']+)\[\/img\]/g,
      '<img src="$1" loading="lazy">')   /* click -> lightbox (delegated) */
    .trim()
    .split(/(<[^>]+>)/).map((seg,i)=>i%2?seg:fmtText(seg)).join('');
  /* **bold**, *italic*, `code`, "- " bullets, @mentions and bare links, applied
     to text only (never inside a tag). Content arrives server-escaped. */
  function fmtText(t){
    return t.split(/(`[^`\n]+`)/).map((part,i)=>{
      if(i%2)return '<code>'+part.slice(1,-1)+'</code>';
      let x=part
        .replace(/(^|\n)[-*] (?=\S)([^\n]*)/g,'$1<span class="li">$2</span>')
        .replace(/\*\*([^*\n]+)\*\*/g,'<b>$1</b>')
        .replace(/(^|[\s(>])\*([^*\n]+)\*(?=[\s).,!?:;<]|$)/g,'$1<em>$2</em>')
        .replace(/(https?:\/\/[^\s<]+[^\s<.,!?:;)'"])/g,'<a class="lnk" href="$1" target="_blank" rel="noopener">$1</a>');
      const names=Object.values(USERS).map(u=>u&&u.name).filter(Boolean).sort((a,b)=>b.length-a.length);
      if(names.length){
        const esc=n=>n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        const re=new RegExp('(^|[\\s(>])@('+names.map(esc).join('|')+')(?![\\w])','gi');
        x=x.replace(re,(m,pre,nm)=>pre+`<span class="mention${ME&&nm.toLowerCase()===(ME.name||'').toLowerCase()?' me':''}">@${nm}</span>`);
      }
      return x;
    }).join('');
  }
  /* live display name: current account name wins over the denormalized author */
  const nameOf=r=>(USERS[r.user_id]&&USERS[r.user_id].name)||r.author;
  /* each person's own name colour and effect, from their account settings */
  const nameStyleOf=uid=>{
    const st=(USERS[uid]&&USERS[uid].settings)||{};
    const hex=v=>/^#[0-9a-f]{6}$/i.test(v||'')?v.toLowerCase():'';
    const c1=hex(st.namecolor), c2=hex(st.namecolor2);
    let vars='';
    if(c1)vars+='--nc:'+c1+';color:'+c1+';';
    if(c2)vars+='--nc2:'+c2+';';
    return {cls:c2?' grad':'',style:vars?' style="'+vars+'"':''};
  };
  const avatarUrlOf=uid=>{
    const u=USERS[uid];
    return (u&&u.settings&&u.settings.avatar)||'';
  };
  const avatarStyle=(uid,name)=>{
    const url=avatarUrlOf(uid);
    if(url)return `background-image:url('${url}');background-size:cover;background-position:center;color:transparent`;
    /* TaskFlow profile colour first, the old name-hash colour as a fallback */
    const u=USERS[uid], c=u&&hexOk(u.color)?u.color:'';
    return c?`background:${c};color:${inkOn(c)}`:`background:${color(name)}`;
  };

  let divideAt=0; /* highest id already seen when this tab was opened */
  const picked=new Set();   /* comment ids chosen for one combined task */
  let lastSig=null;   /* skip DOM rebuilds when the data is unchanged */
  const hiC={page:0,general:0}; /* rendered watermark for entrance animation */

  const expandedDone=new Set();   /* peeked-open done threads, this view only */
  const openDoneRuns=new Set();   /* expanded "N marked done" groups, by first thread id */
  /* Both forms of a thread are always in the DOM; switching is one class flip
     and a CSS grid-rows transition, so nothing re-renders mid-animation (that
     was the source of the jumping). State is applied first, the list is
     resynced after the transition, when the DOM already matches. */
  function morphDone(id,apply){
    apply(true);
    lastSig=null;
    if(cache[ctx])render(cache[ctx]);
    const g=list.querySelector(`.tgroup[data-root="${id}"]`);
    if(g&&!matchMedia('(prefers-reduced-motion:reduce)').matches)
      g.animate([{opacity:0},{opacity:1}],{duration:200,easing:'ease-out'});
  }
  /* hovering a comment lights its dot on the page */
  list.addEventListener('mouseover',e=>{
    const it=e.target.closest&&e.target.closest('.item');
    pinLayer.querySelectorAll('.pdot.hl').forEach(d=>{if(!it||d.dataset.id!==it.dataset.id)d.classList.remove('hl');});
    if(it){const d=pinLayer.querySelector(`.pdot[data-id="${it.dataset.id}"]`);if(d)d.classList.add('hl');}
  });
  list.addEventListener('mouseleave',()=>pinLayer.querySelectorAll('.pdot.hl').forEach(d=>d.classList.remove('hl')));

  /* shared by the action buttons and by undo; both return the new state */
  function toggleDone(id){
    let now=false;
    morphDone(id,()=>{
      const rec=(cache[ctx]||[]).find(r=>r.id==id);
      if(rec&&ME){
        rec.dones=(rec.dones&&rec.dones.length)?[]:[ME.id];
        now=rec.dones.length>0;
        expandedDone.delete(String(id));
      }
    });
    mutate('dc_done',{id});
    if(typeof updatePinEye==='function')updatePinEye();
    return now;
  }
  function togglePinC(id){
    const rec=[...(cache.page||[]),...(cache.general||[])].find(r=>r.id==id);
    let on=false;
    if(rec){rec.pinned=+rec.pinned?0:1;on=!!rec.pinned;lastSig=null;if(cache[ctx])render(cache[ctx]);lastPopSig=null;lastFloatSig=null;syncTabPins();}
    mutate('dc_pin',{id});
    return on;
  }
  function render(rows,forceBottom){
    /* Every payload used to rebuild list.innerHTML wholesale. A typing
       heartbeat fires one every couple of seconds, so any hover state you
       were holding got torn down and rebuilt — that is the blinking. */
    const sig=ctx+'|'+(ME?ME.id:0)+'|'+divideAt+'|'+[...picked].sort().join('.')+'|'+[...openDoneRuns].join('.')+'|'+rows.map(r=>
      r.id+':'+r.parent_id+':'+(+r.pinned||0)+':'+r.likes.length+':'+(r.checks?r.checks.length:0)+':'+(r.downs?r.downs.length:0)+':'+(r.dones?r.dones.length:0)+':'+(expandedDone.has(String(r.id))?'x':'')+':'+r.content.length+':'+nameOf(r)
      +':'+avatarUrlOf(r.user_id)+':'+JSON.stringify(nameStyleOf(r.user_id))+':'+(r.task_id?r.task_id+tfTaskStatus(r.task_id):'')).join(',');
    if(searchQ){renderSearch();return;}   /* search mode owns the list */
    if(toTop){toTop.classList.remove('show');toBot.classList.remove('show');}
    if(pinsView){renderPins();return;}    /* so does the all-pins view */
    if(notifView){renderNotifs();return;} /* and the notification centre */
    if(pagesView){renderPagesInbox();return;} /* and the pages inbox */
    if(!forceBottom&&sig===lastSig){if(typeof syncJump==='function')syncJump();return;}
    lastSig=sig;
    if(!rows.length){
      list.innerHTML=`<div class="empty">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
        No comments yet.<br>Start the conversation below.</div>`;
      return;
    }
    /* flat: a reply is just another message, the quote block shows what it
       answers, so nothing nests any more */
    const byId={};rows.forEach(r=>byId[r.id]=r);
    /* one-line summary of the comment a reply is answering */
    const quoteOf=r=>{
      const p=byId[r.parent_id];
      if(!p)return '';
      const ta=document.createElement('textarea');ta.innerHTML=p.content;
      let txt=ta.value.replace(/\[img\][^\[]*\[\/img\]/g,' <i>[image]</i> ').replace(/\[pin\][^\[]*\[\/pin\]/g,' <i>[pin]</i> ').replace(/\[meta\][^\[]*\[\/meta\]/g,'').trim();
      if(!txt)txt='<i>[image]</i>';
      return `<button class="quote" data-goto="${p.id}">
        <span class="qmeta"><span class="qname">${nameOf(p)}</span>
        <span class="qtime">${timeAgo(p.created_at)}</span></span>
        <span class="qtext">${txt}</span></button>`;
    };
    const newC=r=>ME&&hiC[ctx]>0&&parseInt(r.id,10)>hiC[ctx]&&!isMine(r)?' anim':'';
  const isDone=r=>((r.dones||[]).length>0);   /* separate from the check reaction */
  const isPinnedC=r=>!!(+r.pinned);            /* pinned OUT of the feed by a moderator */
    const item=(r,reply,hasThread,inThread)=>{
      const liked=!!ME&&r.likes.includes(ME.id);
      const checks=r.checks||[];
      const checked=!!ME&&checks.includes(ME.id);
      const downs=r.downs||[];
      const downed=!!ME&&downs.includes(ME.id);
      const done=isDone(r);
      const pinnedC=isPinnedC(r);
      const mm=r.content.match(/\[meta\]([A-Za-z0-9\-_]+)\[\/meta\]/);
      const nm=nameOf(r);
      return `<div class="item${reply?' reply':''}${hasThread?' root-with-replies':''}${newC(r)}${picked.has(String(r.id))?' picked':''}${done?' done':''}${pinnedC?' pinned-c':''}" data-id="${r.id}" data-parent="${r.parent_id}">
        <button class="pick${picked.has(String(r.id))?' on':''}" data-id="${r.id}" aria-label="Select comment">
          <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg></button>
        <div class="avatar" style="${avatarStyle(r.user_id,nm)}">${nm[0].toUpperCase()}</div>
        <div class="itembody">
          <div class="meta"><span class="author${nameStyleOf(r.user_id).cls}"${nameStyleOf(r.user_id).style}>${nm}</span><span class="time">${timeAgo(r.created_at)}</span>${mm?`<button class="minfo" data-m="${mm[1]}" aria-label="Posted from"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg></button>`:''}</div>
          ${pinnedC?'<span class="pintag"><svg viewBox="0 0 24 24"><path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3z"/></svg>Pinned</span>':''}
          ${reply?quoteOf(r):''}
          <div class="content">${rich(r.content)}</div>
          ${taskChip(r)}
          ${ME?`<div class="acts">
            <button class="like${liked?' liked':''}" data-id="${r.id}">
              <svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>
              ${r.likes.length||''}</button>
            <button class="ckb${checked?' checked':''}" data-id="${r.id}" title="Agree">
              <svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>
              ${checks.length||''}</button>
            <button class="dwn${downed?' downed':''}" data-id="${r.id}" title="Disagree">
              <svg viewBox="0 0 32 32"><path d="M30 16V9a7.01 7.01 0 0 0-7-7H2v14h6.465l3.577 5.366l.846 5.917A2.01 2.01 0 0 0 14.868 29H17a3.003 3.003 0 0 0 3-3v-6h6a4.005 4.005 0 0 0 4-4M8 14H4V4h4Zm20 2a2.003 2.003 0 0 1-2 2h-8v8a1 1 0 0 1-1 1h-2.133l-.91-6.366L10 14.697V4h13a5.006 5.006 0 0 1 5 5Z"/></svg>
              ${downs.length||''}</button>
            <button class="do-reply" data-id="${r.id}" data-author="${nm}">Reply</button>
            ${(TASKFLOW||TF_READY)?`<button class="pickstart" data-id="${r.id}" title="Select several comments for one task">Select</button>`:''}
            ${(TASKFLOW||TF_READY)?`<button class="task" data-id="${r.id}" title="${r.task_id?'Open the TaskFlow task made from this comment':'Create a TaskFlow task from this comment'}">
              <svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
              ${r.task_id?'View task':'Task'}</button>`:''}
            ${!inThread?`<button class="donebtn${done?' on':''}" data-done="${r.id}" title="Collapse this thread for everyone">${done?'Undone':'Done'}</button>`:''}
            ${(!inThread&&isMod())?`<button class="pinbtn-c${pinnedC?' on':''}" data-pinc="${r.id}" title="${pinnedC?'Return this to the feed':'Pin out of the feed'}">${pinnedC?'Unpin':'Pin'}</button>`:''}
            ${(isMine(r)||isMod())?`<button class="edit" data-id="${r.id}">Edit</button><button class="del" data-id="${r.id}">Delete</button>`:''}
          </div>`:''}
        </div></div>`;
    };
    let h='', divided=false;
    const maybeDivide=r=>{
      if(!divided&&divideAt&&parseInt(r.id,10)>divideAt&&!isMine(r)){divided=true;return '<div class="newline">NEW</div>';}
      return '';
    };
    /* threaded: every reply hangs under its ROOT comment, however deep the
       reply chain goes (one visual level; mid-thread replies keep a quote for
       context). Orphans whose parent is gone are shown as roots. */
    const rootOf=r=>{
      let cur=r,hops=0;
      while(cur.parent_id!=0&&byId[cur.parent_id]&&hops++<50)cur=byId[cur.parent_id];
      return cur;
    };
    const kids={};
    let roots=rows.filter(r=>{
      const rt=rootOf(r);
      if(rt===r)return true;
      (kids[rt.id]=kids[rt.id]||[]).push(r);
      return false;
    });
    /* pinned threads live in the tab's pin popup, not the feed */
    roots=roots.filter(r=>!isPinnedC(r));
    const plain=r=>{
      const ta=document.createElement('textarea');ta.innerHTML=r.content;
      return stripTok(ta.value).replace(/\[img\][^\[]*\[\/img\]/g,' [image] ').replace(/\s+/g,' ').trim()||'[image]';
    };
    /* A run of two or more collapsed done threads is gathered under one
       "N marked done" row (closed until clicked). Each thread is buffered
       while a run might still be growing, and flushed when it ends. */
    let run=[];
    const flushRun=()=>{
      if(run.length===1)h+=run[0].html;
      else if(run.length>1){
        const key=String(run[0].id), on=openDoneRuns.has(key);
        const who=[...new Set(run.map(x=>x.name))];
        h+=`<div class="dgrp${on?' open':''}"><button class="dgrp-h" data-dgrp="${key}" aria-expanded="${on}">
          <span class="cv"><svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg></span>
          <span class="dg-t">${run.length} marked done</span>
          <span class="dg-who">${escHtml(who.slice(0,3).join(', ')+(who.length>3?` +${who.length-3}`:''))}</span>
          <svg class="dg-chev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
          <div class="dgrp-b">${run.map(x=>x.html).join('')}</div></div>`;
      }
      run=[];
    };
    roots.forEach(root=>{
      const ch=kids[root.id]||[];
      /* done threads collapse to one line for everyone; clicking peeks them
         open locally without changing the shared state */
      const done=isDone(root), open=!done||expandedDone.has(String(root.id));
      const div=maybeDivide(root);
      if(open||div)flushRun();   /* the NEW line never hides inside a group */
      if(!open){
        run.push({id:root.id,name:nameOf(root),html:div+`<div class="tgroup" data-root="${root.id}"><button class="collapsed" data-id="${root.id}">
          <span class="cv"><svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg></span>
          <span class="cname">${escHtml(nameOf(root))}</span>
          <span class="ctxt">${escHtml(plain(root))}</span>
          ${ch.length?`<span class="ccount">+${ch.length}</span>`:''}
          ${ME?`<span class="cundo" data-undo="${root.id}">Undone</span>`:''}
          <svg class="cchev" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button></div>`});
        return;
      }
      h+=div+`<div class="tgroup" data-root="${root.id}">`;
      /* Only one form is rendered. Keeping both in the DOM and sizing them with
         a grid-rows trick collapsed the row to zero height in some layouts,
         which made done comments vanish instead of showing inline. */
      if(done){
        h+=`<div class="dwrap" data-wrap="${root.id}">
          <div class="dbar"><span>Done</span><span class="db-sp"></span>
          <button data-collapse="${root.id}">Hide</button>
          <button data-undo="${root.id}">Undone</button></div>`;
      }
      h+=item(root,false,ch.length>0);
      if(ch.length){
        h+='<div class="thread">';
        ch.forEach(r=>{
          /* quote only when replying to something other than the root, so the
             reference isn't lost inside the thread */
          h+=maybeDivide(r)+item(r,r.parent_id!=root.id,false,true);   /* replies: no Done */
        });
        h+='</div>';
      }
      if(done)h+='</div>';        /* /dwrap */
      h+='</div>';                /* /tgroup */
    });
    flushRun();
    const atBottom=list.scrollHeight-list.scrollTop-list.clientHeight<60;
    list.innerHTML=h;
    hiC[ctx]=rows.reduce((m,r)=>Math.max(m,parseInt(r.id,10)||0),hiC[ctx]);
    syncPicking();
    initGifs();
    if(forceBottom||atBottom){
      const nl=list.querySelector('.newline');
      if(forceBottom&&nl)nl.scrollIntoView({block:'start'});
      else list.scrollTop=list.scrollHeight;
    }
  }

  /* GIFs play through roughly three times when they first come on screen,
     then freeze on their first frame. Hovering replays them.
     GIF loop length isn't exposed to JS, so the play window is a fixed
     estimate; the freeze frame is captured by drawing the image to a canvas. */
  const GIF_PLAY_MS=9000;
  const gifStills=new Map();         /* url -> data: URL of the first frame */

  /* which GIFs this person has already watched, kept per account so the
     opening plays happen once ever rather than once per page load */
  const gifSeenKey=()=>'dc_gifseen_'+(ME?ME.id:'guest');
  let gifWatched=null;
  function watchedSet(){
    if(gifWatched)return gifWatched;
    try{gifWatched=new Set(JSON.parse(localStorage.getItem(gifSeenKey()))||[]);}
    catch(_){gifWatched=new Set();}
    return gifWatched;
  }
  function markWatched(url){
    const set=watchedSet();
    if(set.has(url))return;
    set.add(url);
    /* keep the list from growing without bound */
    const arr=[...set].slice(-400);gifWatched=new Set(arr);
    try{localStorage.setItem(gifSeenKey(),JSON.stringify(arr));}catch(_){}
  }

  function captureStill(url){
    if(gifStills.has(url))return Promise.resolve(gifStills.get(url));
    return new Promise(res=>{
      const probe=new Image();
      probe.crossOrigin='anonymous';
      probe.onload=()=>{
        try{
          const c=document.createElement('canvas');
          c.width=probe.naturalWidth;c.height=probe.naturalHeight;
          c.getContext('2d').drawImage(probe,0,0);
          const d=c.toDataURL('image/png');
          gifStills.set(url,d);res(d);
        }catch(_){gifStills.set(url,'');res('');}   /* cross-origin: can't freeze */
      };
      probe.onerror=()=>{gifStills.set(url,'');res('');};
      probe.src=url;
    });
  }

  /* ================= notifications ================= */
  const EVENTS=[
    {k:'comment',n:'New comment',       s:'Anyone posts anywhere'},
    {k:'reply',  n:'Reply to me',       s:'Someone replies to your comment'},
    {k:'mention',n:'Mention',           s:'Someone types your name with an @'},
    {k:'like',   n:'Like',              s:'Someone likes your comment'},
    {k:'check',  n:'Check',             s:'Someone checks your comment'},
    {k:'down',   n:'Thumbs down',       s:'Someone disagrees with your comment'},
    {k:'done',   n:'Marked done',       s:'Someone collapses your thread'},
    {k:'task',   n:'Turned into a task',s:'Your comment is sent to TaskFlow'}
  ];
  const DEF_EVENTS={comment:{b:1,p:0},reply:{b:1,p:1},mention:{b:1,p:1},
    like:{b:1,p:0},check:{b:1,p:0},down:{b:1,p:0},done:{b:1,p:0},task:{b:1,p:0}};
  const newTopic=()=>'dc-'+Array.from(crypto.getRandomValues(new Uint8Array(12)))
    .map(b=>'abcdefghijkmnpqrstuvwxyz23456789'[b%32]).join('');
  function notif(){
    const n=(ME&&ME.settings&&ME.settings.notif)||{};
    return {
      on:!!n.on, asked:!!n.asked,
      events:Object.assign({},DEF_EVENTS,n.events||{}),
      mute:(n.mute||[]).map(Number),
      topic:n.topic||'',
      server:n.server||'https://ntfy.sh'
    };
  }
  function saveNotif(n){
    if(!ME)return;
    ME.settings=ME.settings||{};ME.settings.notif=n;
    saveSetting({notif:n});
  }

  /* ---- setup wizard ---- */
  const APP_IOS='https://apps.apple.com/us/app/ntfy/id1625396347';
  const APP_AND='https://play.google.com/store/apps/details?id=io.heckel.ntfy';
  /* ---- QR generator: byte mode, ECC L, versions 1-10. Verified against a
     real decoder. Returns a boolean matrix; used for the app-store codes. ---- */
function qrMatrix(text){
  const data=[];
  for(const ch of unescape(encodeURIComponent(text)))data.push(ch.charCodeAt(0));

  /* total data codewords per version at ECC L */
  const DCW=[19,34,55,80,108,136,156,194,232,274];
  /* ecc codewords per block, [blocks, total per block] for ECC L */
  const ECC=[7,10,15,20,26,18,20,24,30,18];
  const BLOCKS=[1,1,1,1,1,2,2,2,2,4];
  let ver=0;
  for(let v=1;v<=10;v++){
    const cap=DCW[v-1]-(v<10?2:3);   /* mode+count overhead */
    if(data.length<=cap){ver=v;break;}
  }
  if(!ver)throw new Error('too long');

  /* --- bit stream --- */
  const bits=[];
  const put=(val,len)=>{for(let i=len-1;i>=0;i--)bits.push((val>>i)&1);};
  put(4,4);                                    /* byte mode */
  put(data.length,ver<10?8:16);
  data.forEach(b=>put(b,8));
  const total=DCW[ver-1]*8;
  for(let i=0;i<4&&bits.length<total;i++)bits.push(0);
  while(bits.length%8)bits.push(0);
  const cws=[];
  for(let i=0;i<bits.length;i+=8){
    let v=0;for(let j=0;j<8;j++)v=(v<<1)|bits[i+j];
    cws.push(v);
  }
  const PAD=[0xEC,0x11];
  for(let i=0;cws.length<DCW[ver-1];i++)cws.push(PAD[i%2]);

  /* --- GF(256) --- */
  const EXP=new Array(512),LOG=new Array(256);
  for(let i=0,x=1;i<255;i++){EXP[i]=x;LOG[x]=i;x<<=1;if(x&256)x^=0x11D;}
  for(let i=255;i<512;i++)EXP[i]=EXP[i-255];
  const mul=(a,b)=>a&&b?EXP[LOG[a]+LOG[b]]:0;
  function rsPoly(n){
    let p=[1];
    for(let i=0;i<n;i++){
      const q=[...p,0];
      for(let j=0;j<p.length;j++)q[j+1]^=mul(p[j],EXP[i]);
      p=q;
    }
    return p;
  }
  function rsEnc(block,n){
    const gen=rsPoly(n), res=[...block,...new Array(n).fill(0)];
    for(let i=0;i<block.length;i++){
      const f=res[i];
      if(!f)continue;
      for(let j=0;j<gen.length;j++)res[i+j]^=mul(gen[j],f);
    }
    return res.slice(block.length);
  }

  /* --- split into blocks, interleave --- */
  const nb=BLOCKS[ver-1], eccLen=ECC[ver-1];
  const short=Math.floor(DCW[ver-1]/nb), extra=DCW[ver-1]%nb;
  const dblocks=[],eblocks=[];
  let off=0;
  for(let i=0;i<nb;i++){
    const len=short+(i>=nb-extra?1:0);
    const blk=cws.slice(off,off+len);off+=len;
    dblocks.push(blk);eblocks.push(rsEnc(blk,eccLen));
  }
  const final=[];
  for(let i=0;i<Math.max(...dblocks.map(b=>b.length));i++)
    dblocks.forEach(b=>{if(i<b.length)final.push(b[i]);});
  for(let i=0;i<eccLen;i++)eblocks.forEach(b=>final.push(b[i]));

  /* --- matrix --- */
  const size=17+ver*4;
  const m=Array.from({length:size},()=>new Array(size).fill(null));
  const setF=(r,c,v)=>{if(r>=0&&r<size&&c>=0&&c<size)m[r][c]=v;};
  /* finders + separators */
  [[0,0],[0,size-7],[size-7,0]].forEach(([R,C])=>{
    for(let r=-1;r<8;r++)for(let c=-1;c<8;c++){
      const inR=r>=0&&r<7,inC=c>=0&&c<7;
      const dark=inR&&inC&&(r===0||r===6||c===0||c===6||(r>=2&&r<=4&&c>=2&&c<=4));
      setF(R+r,C+c,dark?1:0);
    }
  });
  /* timing */
  for(let i=8;i<size-8;i++){
    if(m[6][i]===null)m[6][i]=i%2?0:1;
    if(m[i][6]===null)m[i][6]=i%2?0:1;
  }
  /* alignment */
  const AL=[[],[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]][ver];
  if(AL)for(const r of AL)for(const c of AL){
    if((r<8&&c<8)||(r<8&&c>size-9)||(r>size-9&&c<8))continue;
    for(let dr=-2;dr<=2;dr++)for(let dc=-2;dc<=2;dc++)
      m[r+dr][c+dc]=(Math.max(Math.abs(dr),Math.abs(dc))!==1)?1:0;
  }
  /* dark module + format area reserve */
  m[size-8][8]=1;
  const fmtCells=[];
  for(let i=0;i<9;i++){if(m[8][i]===null){m[8][i]=0;fmtCells.push([8,i]);}}
  for(let i=0;i<9;i++){if(m[i][8]===null){m[i][8]=0;fmtCells.push([i,8]);}}
  for(let i=size-8;i<size;i++){if(m[8][i]===null){m[8][i]=0;}}
  for(let i=size-7;i<size;i++){if(m[i][8]===null){m[i][8]=0;}}

  /* --- place data, zigzag --- */
  const reserved=m.map(row=>row.map(v=>v!==null));
  let bi=0;
  const dataBits=[];
  final.forEach(b=>{for(let i=7;i>=0;i--)dataBits.push((b>>i)&1);});
  let up=true;
  for(let col=size-1;col>0;col-=2){
    if(col===6)col--;
    for(let k=0;k<size;k++){
      const row=up?size-1-k:k;
      for(const c of [col,col-1]){
        if(reserved[row][c])continue;
        m[row][c]=bi<dataBits.length?dataBits[bi++]:0;
      }
    }
    up=!up;
  }

  /* --- masking --- */
  const MASKS=[
    (r,c)=>(r+c)%2===0,(r,c)=>r%2===0,(r,c)=>c%3===0,(r,c)=>(r+c)%3===0,
    (r,c)=>(Math.floor(r/2)+Math.floor(c/3))%2===0,(r,c)=>((r*c)%2)+((r*c)%3)===0,
    (r,c)=>(((r*c)%2)+((r*c)%3))%2===0,(r,c)=>(((r+c)%2)+((r*c)%3))%2===0
  ];
  function penalty(g){
    const n=g.length;let p=0;
    for(let r=0;r<n;r++)for(let c=0;c<n;c++){
      if(c<n-1&&r<n-1&&g[r][c]===g[r][c+1]&&g[r][c]===g[r+1][c]&&g[r][c]===g[r+1][c+1])p+=3;
    }
    const runs=line=>{let run=1,s=0;for(let i=1;i<line.length;i++){
      if(line[i]===line[i-1])run++;else{if(run>=5)s+=3+(run-5);run=1;}}
      if(run>=5)s+=3+(run-5);return s;};
    for(let i=0;i<n;i++){p+=runs(g[i]);p+=runs(g.map(row=>row[i]));}
    let dark=0;g.forEach(row=>row.forEach(v=>dark+=v));
    p+=10*Math.floor(Math.abs(dark*100/(n*n)-50)/5);
    return p;
  }
  const FMT=[0x77C4,0x72F3,0x7DAA,0x789D,0x662F,0x6318,0x6C41,0x6976]; /* ECC L, masks 0-7 */
  let best=null,bestP=Infinity,bestMask=0;
  for(let mk=0;mk<8;mk++){
    const g=m.map((row,r)=>row.map((v,c)=>reserved[r][c]?v:(MASKS[mk](r,c)?v^1:v)));
    /* write format bits for scoring accuracy */
    const f=FMT[mk];
    for(let i=0;i<=5;i++)g[8][i]=(f>>(14-i))&1;
    g[8][7]=(f>>8)&1;g[8][8]=(f>>7)&1;g[7][8]=(f>>6)&1;
    for(let i=9;i<15;i++)g[14-i][8]=(f>>(14-i))&1;
    for(let i=0;i<8;i++)g[size-1-i][8]=(f>>i)&1;
    for(let i=0;i<7;i++)g[8][size-7+i]=(f>>(6-i))&1;
    g[size-8][8]=1;
    const p=penalty(g);
    if(p<bestP){bestP=p;best=g;bestMask=mk;}
  }
  return best.map(row=>row.map(v=>!!v));
}
  /* matrix -> crisp svg, one path for all dark modules */
  function qrSvg(text){
    let m;try{m=qrMatrix(text);}catch(e){return '';}
    const n=m.length,q=2,size=n+q*2;
    let d='';
    for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(m[r][c])d+=`M${c+q} ${r+q}h1v1h-1z`;
    return `<svg viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg">`
      +`<rect width="${size}" height="${size}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  }

  const askBox=$('.notifask'), naBody=$('.nabody'), naSteps=$('.nasteps'),
        naNext=$('.nanext'), naBack=$('.naback'), naSkip=$('.naskip');
  let waChoice='', waStep=0, waSteps=[];

  const icoBell='<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  const icoDesk='<svg viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
  const icoPhone='<svg viewBox="0 0 24 24"><rect x="6" y="2" width="12" height="20" rx="2.5"/><path d="M11 18h2"/></svg>';
  const icoBoth='<svg viewBox="0 0 24 24"><rect x="2" y="5" width="13" height="10" rx="1.8"/><rect x="16" y="9" width="6" height="11" rx="1.8"/></svg>';
  const icoNone='<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-9.3-5M5.2 8.7C5 15 3 17 3 17h14M13.7 21a2 2 0 0 1-3.4 0M3 3l18 18"/></svg>';
  const icoDone='<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>';

  const topicUrl=()=>{const n=notif();return (n.server||'https://ntfy.sh')+'/'+(n.topic||'');};
  const topicName=()=>notif().topic||'';
  const li=(i,html)=>`<div class="naitem"><i>${i}</i><div>${html}</div></div>`;

  /* every screen is a function returning html; some add behaviour after paint */
  const SCREENS={
    choose:()=>({
      html:`<div class="naicon">${icoBell}</div>
        <div class="natitle">How do you want to be notified?</div>
        <div class="natext">Dev Comments can tell you when someone comments, replies or reacts.</div>
        <div class="nachoice">
          <button data-pick="desktop">${icoDesk}<span><b>Desktop only</b>Popups on this computer</span></button>
          <button data-pick="phone">${icoPhone}<span><b>Phone only</b>Push notifications on the go</span></button>
          <button data-pick="both">${icoBoth}<span><b>Both</b>Desktop and phone</span></button>
          <button data-pick="none" class="nanone">${icoNone}<span><b>I don\u2019t want notifications</b>Nothing at all</span></button>
        </div>`,
      hideNext:true,hideBack:true,
      after:()=>naBody.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>pick(b.dataset.pick))
    }),

    /* ---- desktop path ---- */
    d1:()=>({
      html:`<div class="naicon">${icoDesk}</div>
        <div class="natitle">Open your notification link</div>
        <div class="natext">This page is your private notification feed. Keep it open for the next few steps.</div>
        ${li(1,'Click the button below \u2014 it opens <b>your own link</b> in a new tab.')}
        ${li(2,'In the top-left of that page, click <b>GRANT NOW</b> and allow notifications.')}
        <button class="naopen">Open my notification link</button>
        <div class="nawarn">Anyone who has this link can read your notifications. Don\u2019t share it or screenshot it.</div>`,
      after:()=>naBody.querySelector('.naopen').onclick=()=>window.open(topicUrl(),'_blank','noopener')
    }),
    d2:()=>({
      html:`<div class="naicon">${icoDesk}</div>
        <div class="natitle">Create a free ntfy account</div>
        <div class="natext">An account is what lets notifications keep arriving in the background, instead of only while that tab is focused.</div>
        ${li(1,'On that same page, click <b>Sign up</b> and create a free account.')}
        ${li(2,'Open <b>Settings</b> on that page.')}
        ${li(3,'Turn on <b>Background notifications</b>.')}
        ${li(4,'You can now close the ntfy tab \u2014 notifications keep coming.')}`
    }),

    /* ---- phone path ---- */
    p1:()=>({
      html:`<div class="naicon">${icoPhone}</div>
        <div class="natitle">Install the ntfy app</div>
        <div class="natext">Scan with your phone camera, or search \u201cntfy\u201d in your app store.</div>
        <div class="naqr">${qrSvg(APP_IOS)}</div>
        <div class="naqrcap">iPhone \u00b7 App Store</div>`,
      after:()=>{}
    }),
    p2:()=>({
      html:`<div class="naicon">${icoPhone}</div>
        <div class="natitle">Android</div>
        <div class="natext">If you\u2019re on Android, scan this one instead.</div>
        <div class="naqr">${qrSvg(APP_AND)}</div>
        <div class="naqrcap">Android \u00b7 Google Play</div>`
    }),
    p3:()=>({
      html:`<div class="naicon">${icoPhone}</div>
        <div class="natitle">Subscribe to your topic</div>
        <div class="natext">One-time setup inside the app.</div>
        ${li(1,'Open the app and <b>allow notifications</b> when it asks.')}
        ${li(2,'Tap the <b>+</b> button.')}
        ${li(3,'Type in this topic name exactly:')}
        <div class="natopic"><input class="natopicv" readonly><button class="natopiccopy">Copy</button></div>
        ${li(4,'Tap <b>Subscribe</b>. That\u2019s it.')}`,
      after:()=>{
        naBody.querySelector('.natopicv').value=topicName();
        naBody.querySelector('.natopiccopy').onclick=()=>{
          const f=naBody.querySelector('.natopicv');
          (navigator.clipboard?navigator.clipboard.writeText(f.value):Promise.reject())
            .then(()=>toast('Topic copied.')).catch(()=>{f.select();toast('Press Ctrl+C to copy.');});
        };
      }
    }),

    done:()=>({
      html:`<div class="naicon">${icoDone}</div>
        <div class="natitle">All set</div>
        <div class="natext">Next you\u2019ll pick exactly which events notify you, and on which device. You can change any of it later in Settings.</div>`,
      nextLabel:'Open settings'
    })
  };

  function pathFor(choice){
    if(choice==='desktop')return ['d1','d2','done'];
    if(choice==='phone')return ['p1','p2','p3','done'];
    if(choice==='both')return ['d1','d2','p1','p2','p3','done'];
    return [];
  }
  function paintWizard(){
    const key=waSteps[waStep];
    const sc=SCREENS[key]();
    naBody.innerHTML=sc.html;
    naBody.scrollTop=0;
    naSteps.innerHTML=waSteps.length>1
      ? waSteps.map((_,i)=>`<i class="${i===waStep?'on':''}"></i>`).join('') : '';
    naBack.classList.toggle('hide',!!sc.hideBack||waStep===0);
    naNext.classList.toggle('hide',!!sc.hideNext);
    naSkip.classList.toggle('hide',key==='done');
    naNext.textContent=sc.nextLabel||'Next';
    if(sc.after)sc.after();
  }
  async function pick(choice){
    waChoice=choice;
    const n=notif();
    n.asked=true;
    n.on=choice!=='none';
    if(n.on&&!n.topic)n.topic=newTopic();
    /* desktop-only or both: browser popups need permission up front */
    if(choice==='desktop'||choice==='both')await askPermission();
    /* phone-only: don't nag for a permission they said they don't want */
    if(choice==='phone')
      Object.keys(n.events).forEach(k=>{n.events[k]={b:0,p:n.events[k].p};});
    if(choice==='desktop')
      Object.keys(n.events).forEach(k=>{n.events[k]={b:n.events[k].b,p:0};});
    saveNotif(n);
    if(choice==='none'){closeWizard();return;}
    waSteps=pathFor(choice);waStep=0;paintWizard();
  }
  function closeWizard(){askBox.classList.remove('show');}
  naNext.onclick=()=>{
    if(waStep<waSteps.length-1){waStep++;paintWizard();return;}
    closeWizard();openNotifCfg();       /* the last screen opens settings */
  };
  naBack.onclick=()=>{if(waStep>0){waStep--;paintWizard();}};
  naSkip.onclick=()=>{closeWizard();openNotifCfg();};
  askBox.addEventListener('click',e=>{if(e.target===askBox)closeWizard();});

  function openWizard(){
    if(!ME)return;
    waChoice='';waStep=0;waSteps=['choose'];
    askBox.classList.add('show');
    paintWizard();
  }
  function maybeAskNotif(){
    if(!ME||notif().asked)return;
    setTimeout(openWizard,400);
  }
  async function askPermission(){
    if(!('Notification' in window))return 'unsupported';
    if(Notification.permission==='granted'||Notification.permission==='denied')return Notification.permission;
    try{return await Notification.requestPermission();}catch(e){return Notification.permission;}
  }

  /* ---- config sheet ---- */
  const cfg=$('.notifcfg'), cfgOn=$('.ncon'), cfgEvents=$('.ncevents'),
        cfgTopic=$('.nctopic'), cfgPerm=$('.ncperm'),
        cfgSearch=$('.ncsearch'), cfgResults=$('.ncresults'), cfgMuted=$('.ncmuted');
  const tick='<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>';
  function paintPerm(){
    const sup='Notification' in window;
    const p=sup?Notification.permission:'unsupported';
    if(!sup){
      cfgPerm.className='ncperm warn';
      cfgPerm.textContent='This browser cannot show desktop popups. Phone notifications still work.';
    }else if(p==='granted'){
      cfgPerm.className='ncperm';cfgPerm.textContent='';
    }else if(p==='denied'){
      cfgPerm.className='ncperm warn';
      cfgPerm.textContent='Desktop popups are blocked in your browser settings for this site. Phone notifications still work.';
    }else{
      cfgPerm.className='ncperm warn';
      cfgPerm.innerHTML='Desktop popups need your permission. <button class="ncallow">Allow popups</button>';
      cfgPerm.querySelector('.ncallow').onclick=async()=>{await askPermission();paintPerm();};
    }
  }
  function paintEvents(){
    const n=notif();
    cfgEvents.innerHTML=EVENTS.map(ev=>{
      const e=n.events[ev.k]||{b:0,p:0};
      return `<div class="ncrow"><span class="nclabel">${escHtml(ev.n)}<span class="ncsub">${escHtml(ev.s)}</span></span>
        <button class="ncbox${e.b?' on':''}" data-ev="${ev.k}" data-ch="b" aria-label="${escHtml(ev.n)} on desktop">${tick}</button>
        <button class="ncbox${e.p?' on':''}" data-ev="${ev.k}" data-ch="p" aria-label="${escHtml(ev.n)} on phone">${tick}</button></div>`;
    }).join('');
    cfgEvents.querySelectorAll('.ncbox').forEach(b=>b.onclick=()=>{
      const n2=notif();
      const e=n2.events[b.dataset.ev]||{b:0,p:0};
      e[b.dataset.ch]=e[b.dataset.ch]?0:1;
      n2.events[b.dataset.ev]=e;
      saveNotif(n2);
      b.classList.toggle('on',!!e[b.dataset.ch]);
    });
  }
  function paintMuted(){
    const n=notif();
    cfgMuted.innerHTML=n.mute.length?n.mute.map(uid=>{
      const nm=(USERS[uid]&&USERS[uid].name)||'Deleted account';
      return `<div class="ncm"><span class="ncava" style="${avatarStyle(uid,nm)}">${escHtml(nm[0].toUpperCase())}</span>
        ${escHtml(nm)}<button class="ncx" data-un="${uid}">Unmute</button></div>`;
    }).join(''):'<div class="ncempty">Nobody muted.</div>';
    cfgMuted.querySelectorAll('.ncx').forEach(b=>b.onclick=()=>{
      const n2=notif();
      n2.mute=n2.mute.filter(x=>x!=b.dataset.un);
      saveNotif(n2);paintMuted();
    });
  }
  function paintCfg(){
    const n=notif();
    cfgOn.checked=n.on;
    cfg.classList.toggle('off',!n.on);
    cfgTopic.value=(n.server||'https://ntfy.sh')+'/'+(n.topic||'');
    $('.ncappweb').href=cfgTopic.value;   /* the web client, already on your topic */
    paintPerm();paintEvents();paintMuted();
    cfgSearch.value='';cfgResults.innerHTML='';
  }
  function openNotifCfg(){
    if(!ME)return;
    const n=notif();
    if(!n.topic){n.topic=newTopic();saveNotif(n);}
    closeSettings();
    cfg.classList.add('show');
    paintCfg();paintBell();
  }
  $('.notifsetup').onclick=()=>{cfg.classList.remove('show');openWizard();};
  const bellBtn=$('.bellbtn');
  bellBtn.onclick=()=>{
    if(cfg.classList.contains('show')){cfg.classList.remove('show');return;}
    notif().asked?openNotifCfg():openWizard();   /* never set up? walk them through it */
  };
  /* the bell dims when notifications are off, so the state is visible at a glance */
  function paintBell(){
    const n=notif();
    bellBtn.classList.toggle('off',!n.on);
    bellBtn.classList.toggle('on',cfg.classList.contains('show'));
  }
  $('.ncclose').onclick=()=>{cfg.classList.remove('show');paintBell();};
  document.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&cfg.classList.contains('show'))cfg.classList.remove('show');
  });
  cfgOn.onchange=async()=>{
    const n=notif();
    n.on=cfgOn.checked;n.asked=true;
    if(n.on&&!n.topic)n.topic=newTopic();
    saveNotif(n);
    if(n.on)await askPermission();
    paintCfg();paintBell();
  };
  $('.nccopy').onclick=()=>{
    (navigator.clipboard?navigator.clipboard.writeText(cfgTopic.value):Promise.reject())
      .then(()=>toast('Notification link copied.'))
      .catch(()=>{cfgTopic.select();toast('Press Ctrl+C to copy.');});
  };
  $('.ncregen').onclick=()=>{
    const n=notif();
    n.topic=newTopic();saveNotif(n);paintCfg();
    toast('New link created. Re-subscribe in the ntfy app; the old one is dead.');
  };
  $('.nctest').onclick=()=>{
    const n=notif();
    if(!n.topic)return;
    fetch((n.server||'https://ntfy.sh')+'/'+encodeURIComponent(n.topic),{
      method:'POST',
      headers:{Title:'Dev Comments test'},
      body:'If this arrived on your phone, notifications are working.'
    }).then(()=>toast('Test sent.')).catch(()=>toast('Could not reach the notification service.'));
    showBrowserNotif('Dev Comments test','Desktop popups are working.','');
  };
  cfgSearch.addEventListener('input',()=>{
    const q=cfgSearch.value.trim().toLowerCase();
    const n=notif();
    if(!q){cfgResults.innerHTML='';return;}
    const hits=Object.keys(USERS)
      .filter(uid=>+uid!==(ME&&ME.id)&&!n.mute.includes(+uid)
        &&(USERS[uid].name||'').toLowerCase().includes(q))
      .slice(0,6);
    cfgResults.innerHTML=hits.length?hits.map(uid=>{
      const nm=USERS[uid].name;
      return `<button data-mute="${uid}"><span class="ncava" style="${avatarStyle(uid,nm)}">${escHtml(nm[0].toUpperCase())}</span>${escHtml(nm)}</button>`;
    }).join(''):'<button disabled style="color:var(--fainter)">No match</button>';
    cfgResults.querySelectorAll('[data-mute]').forEach(b=>b.onclick=()=>{
      const n2=notif();
      n2.mute.push(+b.dataset.mute);
      saveNotif(n2);
      cfgSearch.value='';cfgResults.innerHTML='';paintMuted();
    });
  });

  /* ---- desktop popups, fired from the poll ---- */
  function showBrowserNotif(title,body,id){
    if(!('Notification' in window)||Notification.permission!=='granted')return;
    try{
      const nt=new Notification(title,{body,tag:'dc-'+(id||Date.now()),icon:(ME&&ME.settings&&ME.settings.avatar)||undefined});
      nt.onclick=()=>{window.focus();if(!isOpen)open();if(id)setTimeout(()=>gotoComment(id),150);nt.close();};
    }catch(e){}
  }
  function notifyFromRows(rows){
    const n=notif();
    if(!ME||!n.on)return;
    const snap={};
    rows.forEach(r=>{snap[r.id]={l:(r.likes||[]).length,c:(r.checks||[]).length,
      d:(r.downs||[]).length,n:(r.dones||[]).length};});
    if(notifSeen===null){notifSeen=snap;return;}   /* first load is not news */
    const ta=document.createElement('textarea');
    const plainOf=r=>{ta.innerHTML=r.content;return stripTok(ta.value)
      .replace(/\[img\][^\[]*\[\/img\]/g,' [image] ').replace(/\s+/g,' ').trim()||'[image]';};
    const muted=uid=>n.mute.includes(+uid);
    const want=(k,r)=>n.events[k]&&n.events[k].b&&!muted(r.user_id||r);
    rows.forEach(r=>{
      const prev=notifSeen[r.id];
      const who=nameOf(r);
      if(!prev){                                   /* a comment we have not seen */
        if(r.user_id===ME.id||muted(r.user_id))return;
        const mine=r.parent_id!=0&&(rows.find(x=>x.id==r.parent_id)||{}).user_id===ME.id;
        const mention=plainOf(r).toLowerCase().includes('@'+(ME.name||'').toLowerCase());
        const k=mine?'reply':mention?'mention':'comment';
        if(n.events[k]&&n.events[k].b)
          showBrowserNotif(mine?`${who} replied to you`:mention?`${who} mentioned you`:`${who} commented`,plainOf(r),r.id);
        return;
      }
      if(r.user_id!==ME.id)return;                 /* reactions only matter on mine */
      const cur=snap[r.id];
      const noun=r.parent_id!=0?'reply':'comment';
      const bump=(a,b)=>cur[a]>prev[a]&&n.events[b]&&n.events[b].b;
      if(bump('l','like'))  showBrowserNotif(`Someone liked your ${noun}`,plainOf(r),r.id);
      if(bump('c','check')) showBrowserNotif(`Someone checked your ${noun}`,plainOf(r),r.id);
      if(bump('d','down'))  showBrowserNotif(`Someone disagreed with your ${noun}`,plainOf(r),r.id);
      if(bump('n','done'))  showBrowserNotif('Your thread was marked done',plainOf(r),r.id);
    });
    notifSeen=snap;
  }

  /* ================= onboarding tour ================= */
  const onboard=$('.onboard'), obIcon=$('.obicon'), obTitle=$('.obtitle'),
        obText=$('.obtext'), obDots=$('.obdots'), obNext=$('.obnext'), obBack=$('.obback');
  const OB_STEPS=[
    {t:'Welcome to TaskFlow on the dev site',
     x:'Every page has its own comment thread, plus a General tab for site-wide chat. The rail on the side switches to your TaskFlow tasks, Go Live and Review — filtered to the page you’re on.',
     i:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'},
    {t:'Pin feedback to the page',
     x:'Hit the pin in the comment box, then click anything on the page. Readers get a dot on the exact element \u2014 and the pin tab under the toggle shows every pin without opening the panel.',
     i:'<path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>'},
    {t:'Screenshots that explain themselves',
     x:'Paste a screenshot straight into the comment box, then tap \u270e on its thumbnail to draw arrows and boxes on it before sending. GIF reactions live right next to it.',
     i:'<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>'},
    {t:'From comment to task',
     x:'Task turns a comment into a TaskFlow task right here, with the page, text and screenshots filled in. The comment then shows the task’s live status. Select bundles several comments into one task.',
     i:'<path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>'},
    {t:'Find anything, make it yours',
     x:'The magnifier searches every comment on every page. The panel wears your TaskFlow look — preset, colours and background — and settings let you pick light or dark, panel side and more.',
     i:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'}
  ];
  let obStep=0, obOpen=false;
  function obPaint(dir){
    const st=OB_STEPS[obStep];
    obIcon.innerHTML='<svg viewBox="0 0 24 24">'+st.i+'</svg>';
    obTitle.textContent=st.t;
    obText.textContent=st.x;
    obDots.innerHTML=OB_STEPS.map((_,i)=>'<i class="'+(i===obStep?'on':'')+'"></i>').join('');
    obBack.classList.toggle('hide',obStep===0);
    obNext.textContent=obStep===OB_STEPS.length-1?'Get started':'Next';
    /* slide the copy in the direction of travel */
    [obIcon,obTitle,obText].forEach(el=>{
      el.classList.remove('obswap','back');void el.offsetWidth;
      el.classList.add('obswap');if(dir<0)el.classList.add('back');
    });
  }
  function openTour(){
    if(obOpen)return;
    obOpen=true;obStep=0;
    closeSettings();
    onboard.classList.remove('closing');onboard.classList.add('show');
    obPaint(1);
  }
  function closeTour(){
    if(!obOpen)return;
    obOpen=false;
    localStorage.setItem('dc_onboarded','1');
    saveSetting({onboarded:1});
    const done=()=>{onboard.classList.remove('show','closing');maybeAskNotif();};
    if(matchMedia('(prefers-reduced-motion:reduce)').matches){done();return;}
    onboard.classList.add('closing');
    onboard.addEventListener('animationend',done,{once:true});
  }
  obNext.onclick=()=>{obStep<OB_STEPS.length-1?(obStep++,obPaint(1)):closeTour();};
  obBack.onclick=()=>{if(obStep>0){obStep--;obPaint(-1);}};
  $('.obskip').onclick=closeTour;
  $('.obreplay').onclick=openTour;
  onboard.addEventListener('click',e=>{if(e.target===onboard)closeTour();});
  document.addEventListener('keydown',e=>{
    if(!obOpen)return;
    if(e.key==='Escape')closeTour();
    if(e.key==='ArrowRight'||e.key==='Enter')obNext.click();
    if(e.key==='ArrowLeft')obBack.click();
  });
  /* first sign-in on this account (or this browser, pre-account) gets the tour */
  function maybeTour(user){
    const seen=(user&&user.settings&&user.settings.onboarded)||localStorage.getItem('dc_onboarded');
    if(!seen){setTimeout(openTour,350);return;}   /* let the panel settle first */
    maybeAskNotif();                              /* tour first, then this */
  }

  /* ================= element pinning ================= */
  const pickVeil=$('.pickveil'), pickHl=$('.pickhl'), pinDot=$('.pindot'),
        toastEl=$('.dctoast'), pinBtn=$('.pinbtn');
  let pendingPin=null, pinChip=null, toastTimer=null, pickCb=null;
  /* 4th segment (optional): app context, e.g. the estimator's filled-in state */
  const PINRE=/\[pin\]([A-Za-z0-9\-_]+)\|([\d.]+)\|([\d.]+)(?:\|([A-Za-z0-9\-_]+))?\[\/pin\]/;
  const parsePin=c=>{const m=c.match(PINRE);return m?{sel:b64d(m[1]),x:m[2],y:m[3],app:m[4]||''}:null;};
  const pinTok=p=>'[pin]'+b64e(p.sel)+'|'+p.x+'|'+p.y+(p.app?'|'+p.app:'')+'[/pin]';
  /* ask any registered app (e.g. the estimator) to snapshot its state for the
     element being pinned; used by the picker and by "save form state" on an
     existing pin */
  function captureApp(el){
    let out=null;
    (window.dcPinProviders||[]).some(pr=>{
      try{const c=pr.capture&&pr.capture(el);if(c){out=c;return true;}}catch(err){}
      return false;
    });
    return out?b64e(JSON.stringify(out)):'';
  }
  function toast(msg){
    toastEl.textContent=msg;toastEl.classList.add('show');
    clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastEl.classList.remove('show'),2600);
  }
  function clearPin(){
    pendingPin=null;pinBtn.classList.remove('on');
    if(pinChip){pinChip.remove();pinChip=null;syncChips();}
  }
  /* shortest selector that matches exactly one element right now */
  function cssPath(el){
    const uniq=sel=>{try{return document.querySelectorAll(sel).length===1;}catch(e){return false;}};
    if(el.id&&uniq('#'+CSS.escape(el.id)))return '#'+CSS.escape(el.id);
    const parts=[];
    let n=el;
    while(n&&n.nodeType===1&&n!==document.body&&n!==document.documentElement){
      if(n.id&&uniq('#'+CSS.escape(n.id))){
        parts.unshift('#'+CSS.escape(n.id));
        const sel=parts.join('>');
        if(uniq(sel))return sel;
      }
      let part=n.tagName.toLowerCase();
      const sibs=n.parentNode?[...n.parentNode.children].filter(c=>c.tagName===n.tagName):[];
      if(sibs.length>1)part+=':nth-of-type('+(sibs.indexOf(n)+1)+')';
      parts.unshift(part);
      n=n.parentNode;
    }
    parts.unshift('body');
    return parts.join('>');
  }
  /* the topmost page element under the cursor, ignoring our own chrome */
  const elUnder=(x,y)=>document.elementsFromPoint(x,y)
    .find(n=>n!==host&&!host.contains(n)&&n!==document.documentElement&&n!==document.body);
  /* Themes can zoom the document or smooth-scroll via transforms, which can
     shift or scale OUR host relative to true viewport coordinates \u2014 then
     "fixed" children of the host stop lining up with getBoundingClientRect
     values from the page. So never trust that alignment: measure where the
     host actually is and map every client coordinate into host space. When
     nothing is shifted this is an exact no-op. */
  function hostMap(){
    const hr=host.getBoundingClientRect();
    const z=host.offsetWidth?hr.width/host.offsetWidth:1;
    return {x:v=>(v-hr.left)/z, y:v=>(v-hr.top)/z, s:v=>v/z};
  }
  let picking=false,pickMx=0,pickMy=0,pickRaf=null;
  function hlAt(x,y){
    const el=elUnder(x,y);
    if(!el){pickHl.classList.remove('show');return null;}
    const r=el.getBoundingClientRect(), M=hostMap();
    pickHl.style.cssText=`left:${M.x(r.left)}px;top:${M.y(r.top)}px;width:${M.s(r.width)}px;height:${M.s(r.height)}px`;
    pickHl.classList.add('show');
    return el;
  }
  /* re-resolve the hovered element every frame, not just on mousemove: the
     theme's smooth (transform) scrolling keeps sliding the page after the
     cursor stops, which would leave a mousemove-only highlight — and the
     stored pin — on the wrong spot */
  function pickFrame(){
    if(!picking){pickRaf=null;return;}
    hlAt(pickMx,pickMy);
    pickRaf=requestAnimationFrame(pickFrame);
  }
  /* cb receives the picked pin; default target is the compose box */
  function startPick(cb){
    if(!ME)return;
    pickCb=cb||null;
    picking=true;closePanel();
    pickVeil.classList.add('show');
    if(pickRaf===null)pickRaf=requestAnimationFrame(pickFrame);
  }
  function endPick(){
    picking=false;
    pickVeil.classList.remove('show');pickHl.classList.remove('show');
  }
  pinBtn.onclick=()=>{pendingPin?clearPin():startPick();};
  pickVeil.addEventListener('mousemove',e=>{pickMx=e.clientX;pickMy=e.clientY;});
  pickVeil.addEventListener('click',e=>{
    const el=hlAt(e.clientX,e.clientY);   /* fresh rect at the moment of the click */
    endPick();
    if(!el){open();return;}
    const r=el.getBoundingClientRect();
    /* store the element (selector) plus WHERE inside it as percentages —
       the dot is re-derived from the element's live rect when viewed, so it
       lands on the same spot at any viewport size */
    /* apps on the page (e.g. the estimator form) can attach their state to the
       pin, so opening it later replays the pinner's selections */
    const appCtx=captureApp(el);
    const p={
      sel:cssPath(el),
      x:Math.max(0,Math.min(1,(e.clientX-r.left)/(r.width||1))).toFixed(4),
      y:Math.max(0,Math.min(1,(e.clientY-r.top)/(r.height||1))).toFixed(4),
      tag:el.tagName.toLowerCase(),
      app:appCtx
    };
    open();
    if(pickCb){const cb=pickCb;pickCb=null;cb(p);return;}
    pendingPin=p;
    pinBtn.classList.add('on');
    pinChip=document.createElement('div');
    pinChip.className='chip pinned';
    pinChip.innerHTML='<svg viewBox="0 0 24 24"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>'
      +escHtml(p.tag)+' pinned<button class="x" type="button">\u2715</button>';
    pinChip.querySelector('.x').onclick=clearPin;
    chipsBox.appendChild(pinChip);syncChips();
    textEl.focus();
  });
  window.addEventListener('keydown',e=>{
    if(e.key==='Escape'&&picking){endPick();pickCb=null;open();}
  },true);
  /* viewing a pin: resolve the selector fresh and track the element's live
     rect every frame, so scroll, zoom and any screen size all stay correct */
  let dotRaf=null,dotUntil=0,dotEl=null,dotX=0,dotY=0;
  function dotFrame(){
    if(Date.now()>dotUntil||!dotEl||!dotEl.isConnected){
      pinDot.classList.remove('show');dotRaf=null;dotEl=null;return;   /* CSS fades it out */
    }
    const r=dotEl.getBoundingClientRect(), M=hostMap();
    pinDot.style.visibility=(!r.width&&!r.height)?'hidden':'';
    pinDot.style.left=M.x(r.left+r.width*dotX)+'px';
    pinDot.style.top=M.y(r.top+r.height*dotY)+'px';
    dotRaf=requestAnimationFrame(dotFrame);
  }
  function showPin(sel,x,y,app){
    closePanel();
    const place=el=>{
      el.scrollIntoView({behavior:'smooth',block:'center'});
      dotEl=el;dotX=+x;dotY=+y;dotUntil=Date.now()+4200;
      pinDot.classList.add('show');
      if(dotRaf===null)dotRaf=requestAnimationFrame(dotFrame);
    };
    const finish=()=>{
      let el=null;
      try{el=document.querySelector(sel);}catch(e){}
      if(!el){toast('Pinned element not found \u2014 the page may have changed.');return;}
      const r=el.getBoundingClientRect();
      /* the element exists but is not visible (e.g. it lives on a hidden form
         step): let an app provider bring it on screen, then place the dot */
      if(!r.width&&!r.height){
        const revealed=(window.dcPinProviders||[]).some(pr=>{
          try{return !!(pr.reveal&&pr.reveal(el,()=>place(el)));}catch(err){return false;}
        });
        if(revealed)return;
        toast('The pinned element is hidden right now \u2014 it may be on another step or view.');
        return;
      }
      place(el);
    };
    /* app-context pins (e.g. estimator): replay the pinner's selections and
       step first, then place the dot once the target is actually on screen */
    if(app){
      let ctx=null;try{ctx=JSON.parse(b64d(app));}catch(e){}
      if(ctx){
        const taken=(window.dcPinProviders||[]).some(pr=>{
          try{return !!(pr.restore&&pr.restore(ctx,finish));}catch(err){return false;}
        });
        if(taken)return;
      }
    }
    finish();
  }

  /* ---- pins overlay: see this page's pins without opening the panel ---- */
  const pinEye=$('.pineye'), pinLayer=$('.pinlayer'), peCount=$('.pecount');
  let pinsOn=false, layerRaf=null, layerPins=[];
  /* ---- per-user hidden pins: account setting when signed in, this browser otherwise ---- */
  function hiddenPins(){
    const src=ME&&ME.settings&&Array.isArray(ME.settings.hidepins)?ME.settings.hidepins
      :(()=>{try{return JSON.parse(localStorage.getItem('dc_hidepins')||'[]');}catch(e){return [];}})();
    return new Set(src.map(String));
  }
  const pinHidden=id=>hiddenPins().has(String(id));
  function setPinHidden(id,hide){
    const set=hiddenPins();
    hide?set.add(String(id)):set.delete(String(id));
    const arr=[...set].map(Number).filter(Boolean).slice(-500);
    try{localStorage.setItem('dc_hidepins',JSON.stringify(arr));}catch(e){}
    if(ME)saveSetting({hidepins:arr});
    /* hiding: drop just that dot so the others don't re-animate */
    const k=layerPins.findIndex(x=>String(x.id)===String(id));
    if(hide&&pinsOn&&k>=0){
      const d=layerPins[k].dot;layerPins.splice(k,1);
      d.classList.add('gone');setTimeout(()=>d.remove(),220);
      const hid=hiddenPins();
      layerSig=pagePins().map(p=>p.id+(threadDone(p.r)?'d':'')+(hid.has(String(p.id))?'h':'')).join(',');
    }else if(pinsOn||localStorage.getItem('dc_pins_show')!=='0'){
      layerSig=null;showPinsLayer(true);
    }
    syncPinMenuRows();
  }
  function pagePins(){
    return (cache.page||[]).map(r=>{
      const t=document.createElement('textarea');t.innerHTML=r.content;
      const p=parsePin(t.value);
      return p?{id:r.id,r,sel:p.sel,x:+p.x,y:+p.y,app:p.app||''}:null;
    }).filter(Boolean);
  }
  /* the eye docks under the panel toggle, whichever size/side/position it has */
  function placePinEye(){
    const r=toggleEl.getBoundingClientRect(), M=hostMap();
    const left=toggleEl.classList.contains('left');
    pinEye.classList.toggle('left',left);
    pinEye.style.top=M.y(r.bottom+10)+'px';   /* same 10px rhythm as the presence rail */
    pinEye.style.right=left?'auto':'0';
    pinEye.style.left=left?'0':'auto';
  }
  function updatePinEye(){
    const pins=pagePins();
    peCount.textContent=pins.length;
    const show=pins.length>0;   /* stays out, docked to the panel, while it's open */
    if(show)placePinEye();
    pinEye.classList.toggle('show',show);
    if(!show)closePinMenu();
    /* the overlay is sticky: it stays (and survives reloads) until the user
       turns it off, whether or not the panel is open */
    if(pinsOn||localStorage.getItem('dc_pins_show')!=='0'){   /* on unless turned off */
      pins.length?showPinsLayer(true):(pinsOn&&hidePinsLayer(true));
    }
  }
  /* hover card: the comment a dot belongs to, shown right next to it */
  const pinTip=$('.pintip');
  let tipDot=null;
  function positionTip(dot){
    const r=dot.getBoundingClientRect(), M=hostMap();
    const w=pinTip.offsetWidth, h=pinTip.offsetHeight;
    const fitsRight=r.right+12+w<innerWidth;
    pinTip.style.left=M.x(fitsRight?r.right+12:r.left-12-w)+'px';
    pinTip.style.top=M.y(Math.max(8,Math.min(r.top+r.height/2-h/2,innerHeight-h-8)))+'px';
  }
  /* a pin's thread is done when its root is */
  function threadDone(r){
    const rows=cache.page||[];let cur=r,guard=0;
    while(cur&&cur.parent_id&&cur.parent_id!="0"&&guard++<50){
      const up=rows.find(x=>x.id==cur.parent_id);if(!up)break;cur=up;
    }
    return !!(cur&&(cur.dones||[]).length);
  }
  function showPinTip(p,dot){
    tipDot=dot;
    const nm=nameOf(p.r), ns=nameStyleOf(p.r.user_id), dn=threadDone(p.r);
    pinTip.classList.toggle('done',dn);
    pinTip.innerHTML=`<div class="pt-head"><span class="pt-ava" style="${avatarStyle(p.r.user_id,nm)}">${nm[0].toUpperCase()}</span>`
      +`<b class="author${ns.cls}"${ns.style}>${nm}</b><span class="pt-time">${timeAgo(p.r.created_at)}</span>`
      +(dn?'<span class="pt-done"><svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>Done</span>':'')+`</div>`
      +`<div class="pt-txt">${escHtml(snippetOf(p.r,140))}</div><i>Click to open the comment</i>`;
    positionTip(dot);
    pinTip.classList.add('show');
  }
  function hidePinTip(){tipDot=null;pinTip.classList.remove('show');}
  /* the hide chip sits beside the hovered dot, on the side away from the card */
  const pdHide=document.createElement('button');
  pdHide.className='pdhide';pdHide.type='button';pdHide.setAttribute('aria-label','Hide this pin for me');
  pdHide.innerHTML='<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.2A9.7 9.7 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3 3.8M6.2 6.6A17 17 0 0 0 2.5 12S6 19 12 19a9.4 9.4 0 0 0 4.2-1"/></svg>';
  let chipDot=null, chipPin=null, chipT=null;
  function placeChip(dot){
    const r=dot.getBoundingClientRect(), M=hostMap(), tipRight=r.right+12+pinTip.offsetWidth<innerWidth;
    pdHide.style.left=M.x(tipRight?r.left-26:r.right+4)+'px';
    pdHide.style.top=M.y(r.top+r.height/2)+'px';
  }
  function showChip(p,dot){
    clearTimeout(chipT);chipDot=dot;chipPin=p;
    placeChip(dot);pdHide.classList.add('show');
  }
  function hideChip(now){
    clearTimeout(chipT);
    const go=()=>{chipDot=null;chipPin=null;pdHide.classList.remove('show');};
    now?go():(chipT=setTimeout(go,180));
  }
  const chipLater=()=>hideChip(false);
  pdHide.onmouseenter=()=>clearTimeout(chipT);
  pdHide.onmouseleave=chipLater;
  pdHide.onclick=e=>{
    e.stopPropagation();
    if(!chipPin)return;
    const id=chipPin.id, dot=chipDot;
    hidePinTip();hideChip(true);
    setPinHidden(id,true);
    undoable('Pin hidden \u2014 re-tick it in the pins list',()=>setPinHidden(id,false));
  };
  function layerFrame(){
    if(!pinsOn){layerRaf=null;return;}
    const M=hostMap();
    layerPins.forEach(p=>{
      if(!p.el||!p.el.isConnected){p.dot.style.display='none';return;}
      const r=p.el.getBoundingClientRect();
      const panelL=Math.min(isOpen?panel.getBoundingClientRect().left:Infinity,
        pinMenu.classList.contains('show')?pinMenu.getBoundingClientRect().left:Infinity);
      const dx=r.left+r.width*p.x;
      const off=(!r.width&&!r.height)||r.bottom<0||r.top>innerHeight||r.right<0||r.left>innerWidth
        ||dx>panelL-10;   /* behind the open panel */
      p.dot.style.display=off?'none':'flex';
      if(!off){
        p.dot.style.left=M.x(r.left+r.width*p.x)+'px';
        p.dot.style.top=M.y(r.top+r.height*p.y)+'px';
      }
    });
    /* keep the hover card (and the hide chip) glued to its dot through scrolling */
    if(tipDot)tipDot.style.display==='none'?hidePinTip():positionTip(tipDot);
    if(chipDot)chipDot.style.display==='none'?hideChip(true):placeChip(chipDot);
    layerRaf=requestAnimationFrame(layerFrame);
  }
  let layerSig=null;
  function showPinsLayer(refresh){
    const pins=pagePins(), hid=hiddenPins();
    const sig=pins.map(p=>p.id+(threadDone(p.r)?'d':'')+(hid.has(String(p.id))?'h':'')).join(',');
    if(pinsOn&&sig===layerSig)return;   /* set unchanged: no rebuild, no re-animate */
    layerSig=sig;
    pinLayer.classList.remove('hiding');
    pinLayer.innerHTML='';
    hidePinTip();hideChip(true);
    pinLayer.appendChild(pdHide);
    const anyVisible=pins.some(p=>!hid.has(String(p.id)));
    const had=new Set((refresh?layerPins:[]).map(x=>String(x.id)));   /* already on screen: no re-entrance */
    layerPins=pins.map((p,i)=>{
      if(hid.has(String(p.id)))return null;   /* hidden for you; numbers stay stable */
      let el=null;try{el=document.querySelector(p.sel);}catch(e){}
      if(!el)return null;
      const dot=document.createElement('button');
      const dn=threadDone(p.r);
      dot.className='pdot'+(dn?' done':'');dot.dataset.id=p.id;
      dot.innerHTML=dn?'<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>':String(i+1);
      if(had.has(String(p.id)))dot.style.animation='none';
      else dot.style.animationDelay=(refresh?0:Math.min(i,10)*45)+'ms';
      /* stays on: opening the comment does not switch the overlay off */
      dot.onclick=()=>{hidePinTip();open();setTimeout(()=>gotoComment(p.id),150);};
      dot.onmouseenter=()=>{showPinTip(p,dot);showChip(p,dot);};
      dot.onmouseleave=()=>{hidePinTip();chipLater();};
      pinLayer.appendChild(dot);
      return {...p,el,dot};
    }).filter(Boolean);
    if(!layerPins.length&&anyVisible){
      if(!refresh)toast('None of the pinned elements are on the page any more.');
      pinsOn=false;layerSig=null;pinEye.classList.remove('on');
      return;
    }
    pinsOn=true;pinEye.classList.add('on');
    localStorage.setItem('dc_pins_show','1');   /* sticky until turned off */
    if(layerRaf===null)layerRaf=requestAnimationFrame(layerFrame);
  }
  function hidePinsLayer(silent){
    pinsOn=false;layerSig=null;pinEye.classList.remove('on');
    if(!silent)localStorage.setItem('dc_pins_show','0');   /* remembered off */
    hidePinTip();
    if(!pinLayer.children.length){pinLayer.innerHTML='';return;}
    pinLayer.classList.add('hiding');
    setTimeout(()=>{pinLayer.innerHTML='';pinLayer.classList.remove('hiding');},200);
  }
  /* the pin tab opens a dropdown of this page's pins; each row scrolls to its
     element, the footer row toggles the all-dots overlay */
  const pinMenu=$('.pinmenu');
  function snippetOf(r){
    const t=document.createElement('textarea');t.innerHTML=r.content;
    return stripTok(t.value).replace(/\[img\][^\[]*\[\/img\]/g,' [image] ').replace(/\*\*|`/g,'').replace(/\s+/g,' ').trim().slice(0,arguments[1]||60)||'[image]';
  }
  function openPinMenu(){
    const pins=pagePins();
    if(!pins.length)return;
    pinMenu.innerHTML=
      `<div class="pm-head"><span class="pm-title">Pins on this page \u00b7 ${pins.length}</span>
        <button class="pm-close" aria-label="Close">
          <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button></div>
      <div class="pm-scroll">`
      +`<div class="pm-sub">Untick a pin to hide its dot for you.</div>`
      +pins.map((p,i)=>{
        const on=!pinHidden(p.id);
        return `<div class="pm-row${on?'':' off'}" data-id="${p.id}">`
          +`<button class="pm-item" data-i="${i}"><span class="pm-n">${i+1}</span>`
          +`<span class="pm-txt"><b>${escHtml(nameOf(p.r))}</b>${escHtml(snippetOf(p.r))}</span></button>`
          +`<button class="pm-vis" role="checkbox" aria-checked="${on}" aria-label="Show this pin's dot" data-vis="${p.id}" title="${on?'Hide':'Show'} this dot for me">`
          +`<i><svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg></i></button></div>`;
      }).join('')
      +`</div>
      <div class="pm-foot"><button class="pm-item pm-all">${pinsOn?'Hide':'Show'} all dots on the page</button></div>`;
    pinMenu.querySelectorAll('.pm-item[data-i]').forEach(el=>el.onclick=()=>{
      const p=pins[+el.dataset.i];
      closePinMenu();
      showPin(p.sel,p.x,p.y,p.app);
    });
    pinMenu.querySelectorAll('.pm-vis').forEach(b=>b.onclick=e=>{
      e.stopPropagation();
      setPinHidden(b.dataset.vis,b.getAttribute('aria-checked')==='true');
    });
    pinMenu.querySelector('.pm-close').onclick=closePinMenu;
    pinMenu.querySelector('.pm-all').onclick=()=>{
      closePinMenu();
      pinsOn?hidePinsLayer():showPinsLayer();
    };
    /* full height, docked to whichever side the tabs are on */
    pinMenu.classList.toggle('left',pinEye.classList.contains('left'));
    pinMenu.classList.add('show');
    syncDock();
  }
  /* reflect the hidden set in an open pins list without rebuilding it */
  function syncPinMenuRows(){
    if(!pinMenu.classList.contains('show'))return;
    const hid=hiddenPins();
    pinMenu.querySelectorAll('.pm-row').forEach(row=>{
      const on=!hid.has(row.dataset.id), b=row.querySelector('.pm-vis');
      row.classList.toggle('off',!on);
      b.setAttribute('aria-checked',String(on));b.title=(on?'Hide':'Show')+' this dot for me';
    });
  }
  const closePinMenu=()=>{
    if(!pinMenu.classList.contains('show'))return;
    pinMenu.classList.remove('show');syncDock();
  };
  pinEye.onclick=e=>{
    e.stopPropagation();
    pinMenu.classList.contains('show')?closePinMenu():openPinMenu();
  };
  document.addEventListener('click',e=>{
    const path=e.composedPath();
    /* working in the panel keeps the list open beside it */
    if(pinMenu.classList.contains('show')&&!path.includes(pinMenu)&&!path.includes(panel))closePinMenu();
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape'||!pinMenu.classList.contains('show'))return;
    closePinMenu();e.stopImmediatePropagation();   /* one Esc per layer: the list, then the panel */
  });
  window.addEventListener('resize',()=>{if(pinEye.classList.contains('show'))placePinEye();});

  /* ================= posted-from metadata ================= */
  function metaNow(){
    let b='';
    const uad=navigator.userAgentData;
    if(uad&&uad.brands&&uad.brands.length){
      const br=uad.brands.find(x=>!/Not.?A.?Brand/i.test(x.brand))||uad.brands[0];
      b=br.brand+' '+br.version;
    }
    if(!b){
      const m=navigator.userAgent.match(/(Firefox|Edg|OPR|Chrome|Safari)\/([\d.]+)/);
      b=m?(({Edg:'Edge',OPR:'Opera'})[m[1]]||m[1])+' '+m[2].split('.')[0]:'Unknown browser';
    }
    /* browser zoom only: outer/inner ratio is unaffected by the OS display
       scale, unlike devicePixelRatio */
    const z=outerWidth?Math.round(outerWidth/innerWidth*100):100;
    return {w:innerWidth,h:innerHeight,z,b,
            os:(uad&&uad.platform)||navigator.platform||''};
  }

  /* ================= search across every page ================= */
  const searchRow=$('.searchrow'), searchQEl=$('.sq');
  let searchQ='', lastSSig=null;   /* skip rebuilds when nothing changed */
  function allRows(){
    const out=[];
    (cache.page||[]).forEach(r=>out.push(r));
    (cache.general||[]).forEach(r=>out.push(r));
    for(const k in cache.other)cache.other[k].forEach(r=>out.push(r));
    return out;
  }
  const ctxLabel=c=>c===PAGE?'This page':c==='general'?'General':c.indexOf('/wp-admin:')===0?adminLabel(c):c;
  function renderSearch(){
    const q=searchQ.toLowerCase();
    const ta=document.createElement('textarea');
    const hits=allRows().map(r=>{
      ta.innerHTML=r.content;
      const plain=stripTok(ta.value).replace(/\[img\][^\[]*\[\/img\]/g,' [image] ');
      const i=plain.toLowerCase().indexOf(q);
      const inName=nameOf(r).toLowerCase().includes(q);
      return (i>-1||inName)?{r,plain,i:Math.max(i,0)}:null;
    }).filter(Boolean).sort((a,b)=>b.r.id-a.r.id).slice(0,60);
    /* rebuild only when the query or the matching set actually changed, so
       the long-poll refresh doesn't wipe and re-animate the results */
    const ssig=q+'|'+hits.map(h=>h.r.id+':'+h.r.content.length).join(',');
    if(ssig===lastSSig)return;
    const animate=lastSSig===null;   /* stagger only on the first paint */
    lastSSig=ssig;
    if(!hits.length){list.innerHTML='<div class="snone">No comments match \u201c'+escHtml(searchQ)+'\u201d.</div>';return;}
    list.innerHTML=hits.map(h=>{
      const start=Math.max(0,h.i-40);
      let snip=escHtml(h.plain.slice(start,h.i))
        +'<b>'+escHtml(h.plain.slice(h.i,h.i+searchQ.length))+'</b>'
        +escHtml(h.plain.slice(h.i+searchQ.length,h.i+searchQ.length+90));
      if(start>0)snip='\u2026'+snip;
      return `<button class="sres" data-id="${h.r.id}" data-ctx="${escHtml(h.r.context)}">
        <span class="sr-top"><span class="sr-name">${escHtml(nameOf(h.r))}</span>
        <span class="sr-ctx">${escHtml(ctxLabel(h.r.context))}</span>
        <span class="sr-time">${timeAgo(h.r.created_at)}</span></span>
        <span class="sr-txt">${snip}</span></button>`;
    }).join('');
    list.querySelectorAll('.sres').forEach((el,i)=>{
      if(animate)el.style.animationDelay=Math.min(i,12)*22+'ms';
      else el.style.animation='none';   /* typing filters in place, no replay */
    });
    list.querySelectorAll('.sres').forEach(el=>el.onclick=()=>{
      const c=el.dataset.ctx, id=el.dataset.id;
      if(c===PAGE||c==='general'){
        closeSearch();
        const tab=$(`.tab[data-ctx="${c===PAGE?'page':'general'}"]`);
        if(tab)tab.click();
        setTimeout(()=>gotoComment(id),60);
      }else{
        /* another page: navigate there, the hash reopens the panel at the hit */
        openPage(c,id);
      }
    });
  }
  function gotoComment(id){
    if(view!=='comments')switchView('comments',true);
    const target=list.querySelector(`.item[data-id="${id}"]`);
    if(!target)return;
    target.scrollIntoView({block:'center'});
    target.classList.remove('flash');void target.offsetWidth;target.classList.add('flash');
  }
  function openSearch(){
    closePinsView();
    searchRow.classList.add('show');
    setTimeout(()=>searchQEl.focus(),0);
  }
  function closeSearch(){
    searchRow.classList.remove('show');searchQEl.value='';searchQ='';lastSSig=null;
    lastSig=null;if(cache[ctx])render(cache[ctx],true);
  }
  $('.srch').onclick=()=>searchRow.classList.contains('show')?closeSearch():openSearch();
  $('.sx').onclick=closeSearch;
  searchQEl.addEventListener('input',()=>{
    searchQ=searchQEl.value.trim();
    if(searchQ)renderSearch();   /* live: refilters on every keystroke */
    else{lastSSig=null;lastSig=null;if(cache[ctx])render(cache[ctx],true);}
  });
  searchQEl.addEventListener('keydown',e=>{if(e.key==='Escape')closeSearch();});
  /* ================= notification centre =================
     Same rules as the desktop popups: an event only appears here if its
     Desktop toggle is on and the person isn't muted. Clearing sets a
     watermark, so cleared items never come back. */
  const notifTab=$('.notif-tab');
  let notifView=false, lastNSig=null;
  const nfKey=()=>'dc_nf_u'+(ME?ME.id:'guest');
  function nfState(){
    try{return JSON.parse(localStorage.getItem(nfKey()))||{cleared:0,clearedAt:0,rk:[]};}
    catch(e){return {cleared:0,clearedAt:0,rk:[]};}
  }
  const nfSave=st=>{try{localStorage.setItem(nfKey(),JSON.stringify(st));}catch(e){}};
  const NFICO={
    comment:'<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    reply:'<svg viewBox="0 0 24 24"><path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
    mention:'<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8"/></svg>',
    like:'<svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l8.8 8.8 8.8-8.8a5.5 5.5 0 0 0 0-7.8z"/></svg>',
    check:'<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>',
    down:'<svg viewBox="0 0 32 32"><path d="M30 16V9a7.01 7.01 0 0 0-7-7H2v14h6.465l3.577 5.366l.846 5.917A2.01 2.01 0 0 0 14.868 29H17a3.003 3.003 0 0 0 3-3v-6h6a4.005 4.005 0 0 0 4-4M8 14H4V4h4Zm20 2a2.003 2.003 0 0 1-2 2h-8v8a1 1 0 0 1-1 1h-2.133l-.91-6.366L10 14.697V4h13a5.006 5.006 0 0 1 5 5Z"/></svg>',
    done:'<svg viewBox="0 0 24 24"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>'
  };
  /* build the list from current data; pure, so it can also feed the badge */
  function nfItems(){
    if(!ME)return [];
    const n=notif(), st=nfState(), out=[];
    /* server times are 'Y-m-d H:i:s'; compare as numbers, newest first */
    const tsOf=t=>{const d=new Date(String(t||'').replace(' ','T'));const v=d.getTime();return isNaN(v)?0:v;};
    /* clearedAt is a number in the SAME parse space as server stamps, so no
       UTC/local skew can make a cleared reaction look new again. Old ISO
       values from previous versions still parse. */
    const clearedAt=typeof st.clearedAt==='number'?st.clearedAt:(st.clearedAt?tsOf(st.clearedAt):0);
    const rk=new Set(st.rk||[]);   /* exact keys of reactions already cleared */
    const rows=[...(cache.page||[]),...(cache.general||[])];
    for(const k in cache.other)rows.push(...cache.other[k]);
    const byId={};rows.forEach(r=>byId[r.id]=r);
    const on=k=>!!(n.events[k]&&n.events[k].b);
    const muted=uid=>n.mute.includes(+uid);
    const ta=document.createElement('textarea');
    const plain=r=>{ta.innerHTML=r.content;return stripTok(ta.value)
      .replace(/\[img\][^\[]*\[\/img\]/g,' [image] ').replace(/\s+/g,' ').trim()||'[image]';};
    rows.forEach(r=>{
      const id=parseInt(r.id,10);
      /* someone else's new comment / reply to me / mention of me */
      if(r.user_id!==ME.id&&!muted(r.user_id)&&id>getJoin()){
        const toMe=r.parent_id!=0&&byId[r.parent_id]&&byId[r.parent_id].user_id===ME.id;
        const mention=plain(r).toLowerCase().includes('@'+(ME.name||'').toLowerCase());
        const k=toMe?'reply':mention?'mention':'comment';
        if(on(k))out.push({k,id,who:nameOf(r),when:r.created_at,ctx:r.context,
          what:toMe?'replied to you':mention?'mentioned you':'commented',txt:plain(r),
          sort:tsOf(r.created_at),fresh:id>st.cleared});
      }
      /* reactions on things I wrote: the log carries who, what and WHEN, so
         these are dated and ordered by the reaction itself */
      if(r.user_id===ME.id&&Array.isArray(r.react_log)){
        const noun=r.parent_id!=0?'reply':'comment';
        const VERB={like:'liked',check:'checked',down:'disagreed with',done:'marked done',task:'turned into a task'};
        r.react_log.forEach(e=>{
          if(!e||e.u===ME.id||muted(e.u)||!on(e.e))return;
          const ts=tsOf(e.t);
          out.push({k:e.e,id:parseInt(r.id,10),who:(USERS[e.u]&&USERS[e.u].name)||'Someone',
            when:e.t,ctx:r.context,
            what:e.e==='task'?`turned your ${noun} into a task`:`${VERB[e.e]||'reacted to'} your ${noun}`,
            txt:plain(r),sort:ts,
            fresh:!rk.has(e.e+':'+r.id+':'+e.u+':'+e.t)&&ts>=clearedAt});
        });
      }
    });
    return out.sort((a,b)=>b.sort-a.sort);
  }
  const nfNew=()=>nfItems().filter(i=>i.fresh).slice(0,80);
  const nfCleared=()=>nfItems().filter(i=>!i.fresh).slice(0,80);
  let nfSub='new';
  function renderNotifs(){
    const fresh=nfNew(), old=nfCleared();
    const items=nfSub==='new'?fresh:old;
    const sig=nfSub+'|'+items.map(i=>i.k+i.id+i.who+i.sort).join('|')+'|'+fresh.length+'|'+old.length;
    if(sig===lastNSig)return;
    const animate=lastNSig===null;
    lastNSig=sig;
    list.innerHTML=`<div class="nfsub">
        <button class="nfsubb${nfSub==='new'?' sel':''}" data-sub="new">New${fresh.length?' <i>'+fresh.length+'</i>':''}</button>
        <button class="nfsubb${nfSub==='cleared'?' sel':''}" data-sub="cleared">Cleared${old.length?' <i>'+old.length+'</i>':''}</button>
      </div>`
      +`<div class="nfhead"><span class="nfcount">${nfSub==='new'
        ?(fresh.length?fresh.length+' new':'All caught up')
        :(old.length?old.length+' cleared':'Nothing cleared yet')}</span>${
        nfSub==='new'&&fresh.length?'<button class="nfclear">Clear all</button>':''}${
        nfSub==='cleared'&&old.length?'<button class="nfrestore">Mark all unread</button>':''}</div>`
      +(items.length?items.map(i=>`<button class="nfrow${i.fresh?'':' old'}" data-id="${i.id}" data-ctx="${escHtml(i.ctx)}">
        <span class="nfico ${i.k}">${NFICO[i.k]||''}</span>
        <span class="nfbody">
          <span class="nftop"><span class="nfwho">${escHtml(i.who)}</span>
          <span class="nfwhat">${escHtml(i.what)}</span>
          <span class="nfwhen">${timeAgo(i.when)}</span></span>
          <span class="nftxt">${escHtml(i.txt)}</span>
          <span class="nfctx">${escHtml(ctxLabel(i.ctx))}</span>
        </span></button>`).join('')
        :`<div class="nfnone">${nfSub==='new'
            ?'Nothing new. Reactions and comments will show up here.'
            :'Alerts you clear are kept here.'}</div>`);
    list.querySelectorAll('.nfsubb').forEach(b=>b.onclick=()=>{
      nfSub=b.dataset.sub;lastNSig=null;renderNotifs();list.scrollTop=0;
    });
    const cl=list.querySelector('.nfclear');
    if(cl)cl.onclick=clearNotifs;
    const rs=list.querySelector('.nfrestore');
    if(rs)rs.onclick=restoreNotifs;
    list.querySelectorAll('.nfrow').forEach((el,ix)=>{
      if(animate)el.style.animationDelay=Math.min(ix,12)*22+'ms';else el.style.animation='none';
      el.onclick=()=>{
        const c=el.dataset.ctx, id=el.dataset.id;
        if(c===PAGE||c==='general'){
          const tab=$(`.tab[data-ctx="${c===PAGE?'page':'general'}"]`);
          if(tab)tab.click();
          setTimeout(()=>gotoComment(id),80);
        }else{
          openPage(c,id);
        }
      };
    });
  }
  /* clearing records where we got to, for both new comments and reaction counts */
  function clearNotifs(){
    if(!ME)return;
    const st=nfState();
    const rows=[...(cache.page||[]),...(cache.general||[])];
    for(const k in cache.other)rows.push(...cache.other[k]);
    st.cleared=rows.reduce((m,r)=>Math.max(m,parseInt(r.id,10)||0),st.cleared||0);
    /* reactions: record each one we are clearing by exact key, and keep a time
       floor built from the SAME server stamps (never Date.now(), which lives in
       a different clock and used to let cleared items bounce straight back). */
    let newest=typeof st.clearedAt==='number'?st.clearedAt:0;
    const keys=Array.isArray(st.rk)?st.rk.slice():[];
    rows.forEach(r=>(r.react_log||[]).forEach(e=>{
      const v=new Date(String(e.t||'').replace(' ','T')).getTime();
      if(!isNaN(v)&&v>newest)newest=v;
      keys.push(e.e+':'+r.id+':'+e.u+':'+e.t);
    }));
    st.clearedAt=newest;
    st.rk=Array.from(new Set(keys)).slice(-600);
    delete st.react;
    nfSave(st);
    nfSub='new';lastNSig=null;renderNotifs();updateBadges();
  }
  /* undo a clear: everything goes back to New */
  function restoreNotifs(){
    if(!ME)return;
    const st=nfState();
    st.cleared=getJoin();st.clearedAt=0;st.rk=[];
    nfSave(st);
    nfSub='new';lastNSig=null;renderNotifs();updateBadges();
  }
  function openNotifView(){
    if(searchQ)closeSearch();
    closePinsView();closePagesView();
    notifView=true;nfSub='new';lastNSig=null;
    $$('.tab[data-ctx]').forEach(x=>x.classList.remove('active'));
    notifTab.classList.add('active');
    sub.textContent='Notifications';
    renderNotifs();viewIn();
  }
  function closeNotifView(){
    if(!notifView)return;
    notifView=false;lastNSig=null;
    notifTab.classList.remove('active');
  }
  notifTab.onclick=()=>{
    if(notifView){                       /* toggle back to the page thread */
      const tab=$('.tab[data-ctx="page"]');
      if(tab)tab.click();
      return;
    }
    openNotifView();
  };

  /* ---- all-pins view: every pin on every page, filterable to your own ---- */
  const pinsBtn=$('.pinsbtn');
  let pinsView=false, pinsMine=false, lastPSig=null;
  function allPins(){
    const ta=document.createElement('textarea');
    return allRows().map(r=>{
      ta.innerHTML=r.content;
      const p=parsePin(ta.value);
      return p&&(!pinsMine||(ME&&r.user_id===ME.id))?{r,p}:null;
    }).filter(Boolean).sort((a,b)=>b.r.id-a.r.id);
  }
  function renderPins(){
    const pins=allPins();
    const psig=(pinsMine?'m':'a')+'|'+pins.map(h=>h.r.id).join(',');
    if(psig===lastPSig)return;
    const animate=lastPSig===null;
    lastPSig=psig;
    const pinsvg='<svg viewBox="0 0 24 24"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
    list.innerHTML=`<div class="pfilter"><button class="seg ${pinsMine?'':'sel'}" data-pf="all">All pins</button>`
      +`<button class="seg ${pinsMine?'sel':''}" data-pf="mine">My pins</button></div>`
      +(pins.length?'':'<div class="snone">No pins yet — hit the \ud83d\udccd in the comment box to place one.</div>')
      +pins.map(h=>`<button class="sres" data-id="${h.r.id}" data-ctx="${escHtml(h.r.context)}">
        <span class="sr-top"><span class="sr-pin">${pinsvg}</span><span class="sr-name">${escHtml(nameOf(h.r))}</span>
        <span class="sr-ctx">${escHtml(ctxLabel(h.r.context))}</span>
        <span class="sr-time">${timeAgo(h.r.created_at)}</span></span>
        <span class="sr-txt">${escHtml(snippetOf(h.r))}</span></button>`).join('');
    list.querySelectorAll('.pfilter .seg').forEach(b=>b.onclick=()=>{
      pinsMine=b.dataset.pf==='mine';renderPins();
    });
    list.querySelectorAll('.sres').forEach((el,i)=>{
      if(animate)el.style.animationDelay=Math.min(i,12)*22+'ms';
      else el.style.animation='none';
    });
    list.querySelectorAll('.sres').forEach(el=>el.onclick=()=>{
      const c=el.dataset.ctx, id=el.dataset.id;
      const hit=pins.find(h=>String(h.r.id)===id);
      if(c===PAGE||c==='general'){
        /* pin lives on (or was made from) this page: jump straight to it */
        if(hit)showPin(hit.p.sel,hit.p.x,hit.p.y,hit.p.app);
      }else{
        /* go to the page the pin is on; the #dc hash opens that comment */
        openPage(c,id);
      }
    });
  }
  function openPinsView(){
    if(searchQ)closeSearch();
    closePagesView();
    pinsView=true;lastPSig=null;pinsBtn.classList.add('on');
    renderPins();viewIn();
  }
  function closePinsView(){
    if(!pinsView)return;
    pinsView=false;lastPSig=null;pinsBtn.classList.remove('on');
    lastSig=null;if(cache[ctx])render(cache[ctx],true);
  }
  pinsBtn.onclick=()=>pinsView?closePinsView():openPinsView();

  /* ---- pinned comments: a badge on each tab (and on the closed tab);
     clicking one opens a popup. Function declarations: updateBadges reaches
     these during boot. ---- */
  const pinnedRoots=w=>(cache[w]||[]).filter(r=>+r.pinned&&r.parent_id==0).sort((a,b)=>b.id-a.id);
  const WLBL={page:'This page',general:'General'};
  let popW=null, lastPopSig=null, floatOn=false, lastFloatSig=null;
  function syncTabPins(){
    ['page','general'].forEach(w=>{
      const b=$(`.tabpin[data-pw="${w}"]`);if(!b)return;
      const n=pinnedRoots(w).length;
      b.title=n+' pinned comment'+(n===1?'':'s');
      b.classList.toggle('show',n>0);
      b.classList.toggle('on',popW===w);
    });
    const tp=$('.tglpin');
    if(tp){
      const n=pinnedRoots('page').length+pinnedRoots('general').length;
      tp.title=n+' pinned comment'+(n===1?'':'s');
      tp.classList.toggle('show',n>0&&!isOpen);
      tp.classList.toggle('on',floatOn);
      if(floatOn&&(!n||isOpen))closePinFloat();
    }
    if(popW)renderPinPop();
    if(floatOn)renderPinFloat();
  }
  /* html + change signature for one context's pinned threads */
  function pinnedHtml(w){
    const roots=pinnedRoots(w), rows=cache[w]||[];
    const byRoot=id=>{            /* every reply under a root, oldest first */
      const ids=new Set([String(id)]), out=[];
      rows.slice().sort((a,b)=>a.id-b.id).forEach(r=>{
        if(ids.has(String(r.parent_id))){ids.add(String(r.id));out.push(r);}
      });
      return out;
    };
    const one=(r,reply)=>{
      const nm=nameOf(r), ns=nameStyleOf(r.user_id);
      return `<div class="pp-row${reply?' pp-reply':''}">
        <div class="avatar" style="${avatarStyle(r.user_id,nm)}">${nm[0].toUpperCase()}</div>
        <div class="pp-body"><div class="meta"><span class="author${ns.cls}"${ns.style}>${nm}</span>
        <span class="time">${timeAgo(r.created_at)}</span><span class="pp-sp"></span>
        ${(!reply&&isMod())?`<button class="pp-unpin" data-unpin="${r.id}">Unpin</button>`:''}</div>
        <div class="content">${rich(r.content)}</div></div></div>`;
    };
    const sig=w+'|'+(isMod()?1:0)+'|'+roots.map(r=>r.id+':'+r.content.length+':'+avatarUrlOf(r.user_id)+':'+byRoot(r.id).map(c=>c.id+'.'+c.content.length).join('.')).join(',');
    return {n:roots.length,sig,html:roots.map(r=>`<div class="pp-item">${one(r,false)}${byRoot(r.id).map(c=>one(c,true)).join('')}</div>`).join('')};
  }
  const popHead=t=>`<div class="pp-head"><span>${t}</span>
        <button class="pp-x" aria-label="Close"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>`;
  function renderPinPop(){
    const pop=$('.tabs .pinpop');if(!pop||!popW)return;
    const P=pinnedHtml(popW);
    if(!P.n){closePinPop();return;}
    if(P.sig===lastPopSig)return;
    lastPopSig=P.sig;
    pop.innerHTML=popHead(`Pinned \u00b7 ${WLBL[popW]} \u00b7 ${P.n}`)+`<div class="pp-scroll">${P.html}</div>`;
  }
  function openPinPop(w){
    if(popW===w){closePinPop();return;}
    const pm=$('.pagemenu'),pt=$('.pages-tab');
    if(pm.classList.contains('show')){pt.classList.remove('openm');pm.classList.remove('show');}
    if(typeof closeMeMenu==='function')closeMeMenu();
    popW=w;lastPopSig=null;renderPinPop();
    const bd=$(`.tabpin[data-pw="${w}"]`), tr=tabsEl.getBoundingClientRect(), br=bd&&bd.getBoundingClientRect();
    if(br&&tr.width)$('.tabs .pinpop').style.setProperty('--po',Math.round(((br.left+br.width/2)-tr.left)/tr.width*100)+'%');
    $('.tabs .pinpop').classList.add('show');syncTabPins();
  }
  function closePinPop(){
    if(!popW)return;
    popW=null;lastPopSig=null;
    $('.tabs .pinpop').classList.remove('show');
    syncTabPins();
  }
  /* closed-tab popup: both contexts, docked beside the tab */
  function renderPinFloat(){
    const f=$('.pinfloat');if(!f||!floatOn)return;
    const A=pinnedHtml('page'), B=pinnedHtml('general');
    if(!A.n&&!B.n){closePinFloat();return;}
    const sig=A.sig+'#'+B.sig;
    if(sig!==lastFloatSig){
      lastFloatSig=sig;
      const both=A.n&&B.n;
      f.innerHTML=popHead(`Pinned \u00b7 ${A.n+B.n}`)+`<div class="pp-scroll">`
        +(A.n?(both?`<div class="pp-sec">${WLBL.page}</div>`:'')+A.html:'')
        +(B.n?(both||!A.n?`<div class="pp-sec">${WLBL.general}</div>`:'')+B.html:'')+`</div>`;
    }
    placePinFloat();
  }
  function placePinFloat(){
    const f=$('.pinfloat'), r=toggleEl.getBoundingClientRect(), M=hostMap();
    const left=toggleEl.classList.contains('left'), gap=10;
    f.classList.toggle('left',left);
    f.style.left=left?M.x(r.right+gap)+'px':'auto';
    f.style.right=left?'auto':M.s(window.innerWidth-r.left+gap)+'px';
    const h=f.offsetHeight, vh=M.s(window.innerHeight);
    f.style.top=Math.max(12,Math.min(M.y(r.top)-8,vh-h-12))+'px';
  }
  function openPinFloat(){
    floatOn=true;lastFloatSig=null;renderPinFloat();
    $('.pinfloat').classList.add('show');syncTabPins();
  }
  function closePinFloat(){
    if(!floatOn)return;
    floatOn=false;lastFloatSig=null;
    $('.pinfloat').classList.remove('show');
    syncTabPins();
  }
  function onPinPopClick(e,close){
    const path=e.composedPath();
    if(path.find(n=>n.classList&&n.classList.contains('pp-x'))){close();return;}
    const un=path.find(n=>n.dataset&&n.dataset.unpin);
    if(un){
      const id=un.dataset.unpin;
      togglePinC(id);
      undoable('Unpinned',()=>togglePinC(id));
      return;
    }
    const pc=path.find(n=>n.classList&&n.classList.contains('pinchip'));
    if(pc){close();showPin(b64d(pc.dataset.sel),pc.dataset.x,pc.dataset.y,pc.dataset.app||'');return;}
    const im=path.find(n=>n.tagName==='IMG'&&n.closest&&n.closest('.content'));
    if(im)openLightbox(im.dataset.gif||im.dataset.full||im.src);
  }
  $('.tabs .pinpop').addEventListener('click',e=>onPinPopClick(e,closePinPop));
  $('.pinfloat').addEventListener('click',e=>{e.stopPropagation();onPinPopClick(e,closePinFloat);});
  panel.addEventListener('click',e=>{
    if(!popW)return;
    const path=e.composedPath();
    if(path.includes($('.tabs .pinpop'))||path.find(n=>n.classList&&n.classList.contains('tabpin')))return;
    closePinPop();
  });
  document.addEventListener('click',e=>{
    if(!floatOn)return;
    const path=e.composedPath();
    if(path.includes($('.pinfloat'))||path.includes($('.tglpin')))return;
    closePinFloat();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(popW)closePinPop();if(floatOn)closePinFloat();}});
  window.addEventListener('resize',()=>{if(floatOn)placePinFloat();});

  /* ---- pages inbox: every page with comments, what's open, who's there ---- */
  let pagesView=false, pagesSort='recent', pagesQ='', lastPgSig=null;
  function pageStats(){
    const map={};
    const add=(c,r)=>(map[c]=map[c]||[]).push(r);
    (cache.page||[]).forEach(r=>add(PAGE,r));
    for(const k in cache.other)cache.other[k].forEach(r=>add(k,r));
    presence.forEach(p=>{if(p.ctx!=='general'&&p.exp>Date.now()&&!map[p.ctx])map[p.ctx]=[];});
    return Object.keys(map).map(c=>{
      const rows=map[c], roots=rows.filter(r=>r.parent_id==0);
      const isDoneR=r=>(r.dones||[]).length>0;
      const last=rows.reduce((m,r)=>!m||+r.id>+m.id?r:m,null);
      const people=[];
      rows.slice().sort((a,b)=>b.id-a.id).forEach(r=>{if(!people.includes(r.user_id))people.push(r.user_id);});
      return {c,rows,last,people,live:liveOn(c),
        open:roots.filter(r=>!isDoneR(r)&&!+r.pinned).length,
        done:roots.filter(isDoneR).length,
        unread:countNew(rows,c===PAGE?storeKey('page'):c)};
    });
  }
  const pageHref=c=>c.indexOf('/wp-admin:')===0?ORIGIN+adminHref(c):ORIGIN+c;
  /* other pages always open in a new tab, so this page and its panel stay put;
     the #dc hash opens the panel on that comment there */
  function openPage(c,id){
    /* no 'noopener' feature: with it, open() returns null and a block can't be told apart */
    const w=window.open(pageHref(c)+(id?'#dc-'+id:''),'_blank');
    if(w){try{w.opener=null;}catch(e){}}
    else if(typeof toast==='function')toast('Your browser blocked the new tab \u2014 allow pop-ups for this site.');
  }
  const pageName=c=>c.indexOf('/wp-admin:')===0?adminLabel(c):(c==='/'?'Home':c);
  function renderPagesInbox(){
    if(!list.querySelector('.pgwrap')){
      lastPgSig=null;
      list.innerHTML=`<div class="pgwrap"><div class="pgbar">
          <label class="pgsearch"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
            <input class="pgq" type="text" placeholder="Filter pages" autocomplete="off" value="${escHtml(pagesQ)}"></label>
          <div class="pgsort" role="tablist">
            <button class="pgs" data-sort="recent">Recent</button><button class="pgs" data-sort="unread">Unread</button><button class="pgs" data-sort="open">Open</button>
            <i class="pgs-glide"></i></div></div>
        <div class="pgsum"></div><div class="pgrows"></div></div>`;
      const q=list.querySelector('.pgq');
      q.addEventListener('input',()=>{pagesQ=q.value;renderPagesInbox();});
      list.querySelectorAll('.pgs').forEach(b=>b.onclick=()=>{pagesSort=b.dataset.sort;renderPagesInbox();});
    }
    list.querySelectorAll('.pgs').forEach(b=>b.classList.toggle('sel',b.dataset.sort===pagesSort));
    const sel=list.querySelector('.pgs.sel'), gl=list.querySelector('.pgs-glide');
    if(sel&&gl){gl.style.width=sel.offsetWidth+'px';gl.style.transform=`translateX(${sel.offsetLeft-3}px)`;}
    let st=pageStats();
    const q=pagesQ.trim().toLowerCase();
    if(q)st=st.filter(p=>pageName(p.c).toLowerCase().includes(q)||p.c.toLowerCase().includes(q));
    const lastId=p=>p.last?+p.last.id:0;
    st.sort((a,b)=>pagesSort==='unread'?(b.unread-a.unread)||(lastId(b)-lastId(a))
      :pagesSort==='open'?(b.open-a.open)||(lastId(b)-lastId(a)):(lastId(b)-lastId(a)));
    const sig=pagesSort+'|'+q+'|'+st.map(p=>p.c+':'+lastId(p)+':'+p.open+':'+p.unread+':'+p.live.join('.')).join(',');
    if(sig===lastPgSig)return;
    const first=lastPgSig===null;lastPgSig=sig;
    const openAll=st.reduce((a,p)=>a+p.open,0);
    list.querySelector('.pgsum').textContent=st.length?`${st.length} page${st.length===1?'':'s'}, ${openAll} open thread${openAll===1?'':'s'}`:'';
    const ava=(uid,cls)=>{const u=USERS[uid]||{}, nm=u.name||'?';
      return `<span class="${cls}" style="${avatarStyle(uid,nm)}" title="${escHtml(nm)}">${avatarUrlOf(uid)?'':escHtml(nm[0].toUpperCase())}</span>`;};
    list.querySelector('.pgrows').innerHTML=st.length?st.map((p,i)=>{
      const here=p.c===PAGE;
      const lastTxt=p.last?`<b>${escHtml(nameOf(p.last))}</b> ${escHtml(snippetOf(p.last,90))}`:'<span class="pg-quiet">No comments yet</span>';
      return `<a class="pgrow${here?' here':''}${p.unread?' unread':''}" href="${escHtml(pageHref(p.c))}"${here?'':' target="_blank" rel="noopener"'} data-c="${escHtml(p.c)}"${first?` style="animation-delay:${Math.min(i,10)*28}ms"`:' style="animation:none"'}>
        <div class="pg-main">
          <div class="pg-top"><span class="pg-path">${escHtml(pageName(p.c))}</span>
            ${here?'<span class="pg-here">You\u2019re here</span>':''}
            ${p.unread?`<span class="pg-new">${p.unread} new</span>`:''}</div>
          <div class="pg-last">${lastTxt}</div>
          <div class="pg-meta">${p.open?`<span class="pg-open"><i></i>${p.open} open</span>`:'<span class="pg-clear">All clear</span>'}
            ${p.done?`<span>${p.done} done</span>`:''}${p.last?`<span>${timeAgo(p.last.created_at)}</span>`:''}</div>
        </div>
        <div class="pg-side">
          ${p.live.length?`<span class="pg-live">${p.live.slice(0,3).map(u=>ava(u,'pg-lava')).join('')}<em>${p.live.length} here</em></span>`:''}
          <span class="pg-people">${p.people.slice(0,4).map(u=>ava(u,'pg-ava')).join('')}</span>
        </div>
        ${here?'<svg class="pg-go" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg>':'<svg class="pg-go ext" viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>'}</a>`;
    }).join(''):`<div class="empty pg-empty"><svg viewBox="0 0 24 24" fill="none" stroke-width="1.6"><path d="M3 7h18M3 12h18M3 17h12"/></svg>${q?'No pages match that filter.':'Comments on other pages show up here.'}</div>`;
    list.querySelectorAll('.pgrow.here').forEach(a=>a.onclick=e=>{
      if(e.metaKey||e.ctrlKey||e.shiftKey||e.button)return;
      e.preventDefault();const t=$('.tab[data-ctx="page"]');if(t)t.click();
    });
  }
  function openPagesView(){
    if(searchQ)closeSearch();
    closePinsView();closeNotifView();closePinPop();
    pagesView=true;lastPgSig=null;
    $$('.tab').forEach(x=>x.classList.remove('active'));
    pagesTab.classList.add('active');
    sub.textContent='All pages';
    renderPagesInbox();viewIn();
    const q=list.querySelector('.pgq');if(q&&matchMedia('(pointer:fine)').matches)setTimeout(()=>q.focus({preventScroll:true}),220);
  }
  function closePagesView(){
    if(!pagesView)return;
    pagesView=false;lastPgSig=null;pagesTab.classList.remove('active');
  }
  /* the active-tab glide follows whichever tab is active */
  const tabsEl=$('.tabs'), glide=$('.tabs .glide');
  let glideReady=false;
  function moveGlide(){
    const t=tabsEl.querySelector('.tab.active');
    if(!t||!t.offsetWidth){if(tabsEl.classList.contains('glided'))tabsEl.classList.remove('glided');return;}
    if(!glideReady){glide.classList.add('noanim');}
    glide.style.width=t.offsetWidth+'px';
    glide.style.transform=`translateX(${t.offsetLeft}px)`;
    if(!tabsEl.classList.contains('glided'))tabsEl.classList.add('glided');   /* a no-op add still fires a mutation */
    if(!glideReady){void glide.offsetWidth;glide.classList.remove('noanim');glideReady=true;}
  }
  /* only a tab's own class changes move it; the glide and the row itself are ignored so it can't feed itself */
  new MutationObserver(recs=>{if(recs.some(r=>r.target.classList&&r.target.classList.contains('tab')))moveGlide();})
    .observe(tabsEl,{subtree:true,attributes:true,attributeFilter:['class']});
  if('ResizeObserver'in window)new ResizeObserver(()=>{glideReady=false;moveGlide();}).observe(tabsEl);
  /* the header title crossfades when the view changes */
  new MutationObserver(()=>{
    if(!matchMedia('(prefers-reduced-motion:reduce)').matches)
      sub.animate([{opacity:0,transform:'translateY(3px)'},{opacity:1,transform:'none'}],{duration:240,easing:'ease-out'});
  }).observe(sub,{childList:true,characterData:true,subtree:true});

  /* a view swap eases in, so the list never just blinks to new content */
  function viewIn(){
    if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;
    list.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'none'}],
      {duration:260,easing:'cubic-bezier(.32,.72,.22,1)'});
  }

  /* ---- undo: one pending action at a time; a new one settles the last ---- */
  const undoEl=$('.undotoast');
  let undoCur=null;
  function placeUndo(){
    const M=hostMap();
    if(isOpen){
      const pr=panel.getBoundingClientRect(), cr=compose.getBoundingClientRect();
      undoEl.style.left=M.x(pr.left+pr.width/2)+'px';
      undoEl.style.bottom=(M.s(innerHeight)-M.y(cr.top)+22)+'px';   /* clears the jump notch on the divider */
    }else{undoEl.style.left='50%';undoEl.style.bottom='24px';}
  }
  function undoable(msg,revert,commit){
    settleUndo();
    const u={revert,commit,t:setTimeout(()=>settleUndo(),5000)};
    undoCur=u;
    const mac=/Mac|iP/.test(navigator.platform);
    undoEl.innerHTML=`<svg class="ut-ico" viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg><span class="ut-msg">${escHtml(msg)}</span>`
      +`<button class="ut-undo" type="button">Undo<kbd>${mac?'\u2318':'Ctrl+'}Z</kbd></button>`
      +`<button class="ut-x" type="button" aria-label="Dismiss"><svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 6 6 18M6 6l12 12"/></svg></button><i class="ut-bar"></i>`;
    placeUndo();
    undoEl.classList.remove('show');void undoEl.offsetWidth;undoEl.classList.add('show');
    placeJump();
  }
  function settleUndo(beacon){
    const u=undoCur;if(!u)return;
    undoCur=null;clearTimeout(u.t);undoEl.classList.remove('show');placeJump();
    if(u.commit)u.commit(beacon);
  }
  function runUndo(){
    const u=undoCur;if(!u)return;
    undoCur=null;clearTimeout(u.t);undoEl.classList.remove('show');placeJump();
    u.revert();
  }
  undoEl.addEventListener('click',e=>{
    const path=e.composedPath();
    if(path.find(n=>n.classList&&n.classList.contains('ut-undo')))runUndo();
    else if(path.find(n=>n.classList&&n.classList.contains('ut-x')))settleUndo();
  });
  document.addEventListener('keydown',e=>{
    if(!undoCur||!(e.ctrlKey||e.metaKey)||e.shiftKey||e.key.toLowerCase()!=='z')return;
    const t=e.composedPath()[0];
    if(t&&(t.isContentEditable||/^(input|textarea)$/i.test(t.tagName)))return;   /* their own text undo wins */
    e.preventDefault();runUndo();
  });
  window.addEventListener('pagehide',()=>settleUndo(true));

  /* deletes wait out the undo window before they reach the server */
  const pendingDel=new Set();
  function softDelete(id){
    const key=String(id), rows=cache[ctx]||[], rec=rows.find(r=>String(r.id)===key), w=ctx;
    pendingDel.add(key);
    if(rec)cache[w]=rows.filter(r=>r!==rec);
    lastSig=null;
    setTimeout(()=>{if(cache[ctx])render(cache[ctx]);syncTabPins();updatePinEye();},290);
    undoable('Comment deleted',()=>{
      pendingDel.delete(key);
      if(rec&&cache[w]&&!cache[w].includes(rec)){cache[w].push(rec);cache[w].sort((a,b)=>a.id-b.id);}
      lastSig=null;if(cache[ctx])render(cache[ctx]);syncTabPins();updatePinEye();
      setTimeout(()=>gotoComment(key),60);
    },beacon=>{
      if(beacon){
        try{navigator.sendBeacon(AJAX,new URLSearchParams({action:'dc_delete',nonce:NONCE,context:PAGE,token:token(),id:key}));}catch(e){}
        return;
      }
      mutate('dc_delete',{id:key}).finally(()=>pendingDel.delete(key));
    });
  }

  /* ---- account menu: notifications, settings, sign out ---- */
  const meBtn=$('.mebtn'), meMenu=$('.memenu');
  function openMeMenu(){
    if(typeof closePinPop==='function')closePinPop();   /* one popover at a time */
    const n=notif(), st=$('.mm-state');
    st.textContent=n.on?'On':'Off';st.classList.toggle('on',!!n.on);
    $('.mm-role').textContent=isMod()?'Moderator':'Member';
    meMenu.classList.add('show');meBtn.classList.add('openm');meBtn.setAttribute('aria-expanded','true');
  }
  function closeMeMenu(){
    meMenu.classList.remove('show');meBtn.classList.remove('openm');meBtn.setAttribute('aria-expanded','false');
  }
  meBtn.onclick=e=>{e.stopPropagation();meMenu.classList.contains('show')?closeMeMenu():openMeMenu();};
  meMenu.addEventListener('click',e=>{
    const it=e.composedPath().find(n=>n.dataset&&n.dataset.mm);if(!it)return;
    closeMeMenu();
    ({notif:()=>bellBtn.click(),settings:()=>gearBtn.click(),logout:()=>logoutBtn.click()})[it.dataset.mm]();
  });
  panel.addEventListener('click',e=>{
    if(meMenu.classList.contains('show')&&!e.composedPath().includes(meMenu)&&!e.composedPath().includes(meBtn))closeMeMenu();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&meMenu.classList.contains('show'))closeMeMenu();});

  /* ---- presence: heartbeat this page, show everyone else who has it open ---- */
  let presence=[];                 /* [{uid,ctx,exp}] */
  const presEl=$('.presence'), presKids=new Map();
  function setPresence(list){
    const now=Date.now();
    presence=(list||[]).map(p=>({uid:+p.uid,ctx:p.ctx,exp:now+(+p.ttl||0)}));
    renderPresence();
    if(typeof pagesView!=='undefined'&&pagesView)renderPagesInbox();
  }
  const liveOn=c=>{
    const now=Date.now(), seen=new Set();
    const others=presence.filter(p=>p.ctx===c&&p.exp>now&&(!ME||p.uid!==ME.id)&&!seen.has(p.uid)&&seen.add(p.uid)).map(p=>p.uid);
    /* you're on this page by definition, even before the first heartbeat lands;
       you sit last, closest to the tab */
    const meHere=!!ME&&(c===PAGE||presence.some(p=>p.ctx===c&&p.exp>now&&p.uid===ME.id));
    return meHere?[...others,ME.id]:others;
  };
  function renderPresence(){
    if(!presEl)return;
    const uids=liveOn(PAGE), MAX=matchMedia('(max-width:640px)').matches?2:4;
    const mine=ME&&uids.includes(ME.id), rest=uids.filter(u=>!ME||u!==ME.id);
    const shown=[...rest.slice(0,mine?MAX-1:MAX),...(mine?[ME.id]:[])], more=uids.length-shown.length;
    const want=new Set(shown.map(String));
    presKids.forEach((el,k)=>{
      if(want.has(k))return;
      presKids.delete(k);el.classList.add('out');setTimeout(()=>el.remove(),230);
    });
    shown.forEach((uid,i)=>{
      const k=String(uid);let el=presKids.get(k);
      const u=USERS[uid]||{}, nm=u.name||'Someone';
      if(!el){
        el=document.createElement('div');el.className='pav';
        el.style.animationDelay=(i*60)+'ms';
        presKids.set(k,el);
        const mr=presEl.querySelector('.pmore');mr?presEl.insertBefore(el,mr):presEl.appendChild(el);
      }
      el.setAttribute('style',avatarStyle(uid,nm)+';animation-delay:'+el.style.animationDelay);
      const isMe=!!ME&&uid===ME.id;
      el.dataset.name=isMe?'You':nm+' is here';
      el.classList.toggle('me',isMe);
      el.innerHTML=(avatarUrlOf(uid)?'':escHtml(nm[0].toUpperCase()))+'<i></i>';
    });
    let mr=presEl.querySelector('.pmore');
    if(more>0){if(!mr){mr=document.createElement('div');mr.className='pmore';presEl.appendChild(mr);}mr.textContent='+'+more;}
    else if(mr)mr.remove();
    presEl.classList.toggle('empty',!uids.length);
    placePresence();
  }
  /* the rail matches the tab's width and edge; closed it stacks above the tab
     (or below the pins button when the tab sits too high), open it docks to the
     panel's edge with its bottom level with the composer */
  const GAP=10;
  let presPlaced=false;

  /* ---- the edge column docks to the outermost open surface ---- */
  let dockPx=0;
  const rig=$('.rig'), rigb=$('.rigb');
  function syncDock(){
    const left=side==='left', hostW=host.offsetWidth||innerWidth;
    /* every piece of the column takes the current side before measuring */
    pinEye.classList.toggle('left',left);pinMenu.classList.toggle('left',left);
    try{if(pinEye.classList.contains('show'))placePinEye();}catch(e){}
    /* visible panel width: on the right the scrollbar allowance hangs past the edge */
    const W=left?panel.offsetWidth:panel.offsetWidth-(parseFloat(getComputedStyle(panel).paddingRight)||0);
    const menuOn=pinMenu.classList.contains('show'), Mw=menuOn?pinMenu.offsetWidth:0;
    rig.classList.toggle('left',left);
    rig.classList.toggle('dockfast',panel.classList.contains('resizing'));
    rig.style.setProperty('--rx',(isOpen?W:0)+'px');rig.classList.toggle('open',isOpen);
    rigb.style.setProperty('--rm',Mw+'px');rigb.classList.toggle('mopen',menuOn);
    dockPx=(isOpen?W:0)+Mw;
    [toggleEl,pinEye].forEach(el=>el.classList.toggle('docked',dockPx>0));
    toggleEl.setAttribute('aria-label',isOpen?'Close comments':'Open comments');
    try{placePresence();}catch(e){}
  }
  function placePresence(){
    if(!presEl)return;
    const M=hostMap(), left=side==='left';
    const tw=toggleEl.offsetWidth||44;
    presEl.classList.toggle('left',left);
    presEl.classList.toggle('docked',dockPx>0);
    presEl.style.width=tw+'px';
    presEl.style.setProperty('--pa',Math.round(tw*.64)+'px');
    const h=presEl.offsetHeight, w=presEl.offsetWidth, vw=M.s(innerWidth);
    let x,y;
    {
      /* x from layout (offsetLeft ignores the slide-in), y from the rect
         (the tab's own translateY(-50%) is a transform, which it includes) */
      const r=toggleEl.getBoundingClientRect();
      x=left?toggleEl.offsetLeft:toggleEl.offsetLeft+toggleEl.offsetWidth-w;   /* same layer as the tab */
      y=M.y(r.top)-GAP-h;
      if(y<12){
        const below=pinEye.classList.contains('show')?pinEye.getBoundingClientRect():r;
        y=M.y(below.bottom)+GAP;
      }
    }
    x=Math.max(0,Math.min(x,vw-w));
    /* the very first placement jumps into place; after that it glides */
    if(!presPlaced)presEl.style.transition='none';
    presEl.style.transform=`translate(${Math.round(x)}px,${Math.round(y)}px)`;
    if(!presPlaced){void presEl.offsetWidth;presEl.style.transition='';presPlaced=true;}
  }
  function presenceBeat(){
    if(!ME||document.hidden)return;
    api('dc_presence',{},'page').then(j=>{if(j&&j.success&&j.data)setPresence(j.data.presence);}).catch(()=>{});
  }
  function presenceLeave(){
    if(!ME)return;
    try{navigator.sendBeacon(AJAX,new URLSearchParams({action:'dc_presence',nonce:NONCE,context:PAGE,token:token(),leave:1}));}catch(e){}
  }
  setInterval(presenceBeat,20000);
  setInterval(renderPresence,5000);          /* drop anyone whose heartbeat lapsed */
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)presenceBeat();});
  window.addEventListener('pagehide',presenceLeave);
  window.addEventListener('resize',placePresence);
  toggleEl.addEventListener('animationend',e=>{if(e.target===toggleEl)placePresence();});
  if('ResizeObserver'in window)new ResizeObserver(()=>syncDock()).observe(panel);   /* panel width drag */
  window.addEventListener('resize',syncDock);
  new MutationObserver(placePresence).observe(toggleEl,{attributes:true,attributeFilter:['class','style']});

  /* #dc-<id> in the URL: open the panel on that comment (used by search
     results on other pages, and shareable by hand) */
  let hashDone=false;
  function maybeHashGoto(){
    if(hashDone)return;
    const m=location.hash.match(/^#dc-(\d+)$/);
    if(!m)return;
    const id=m[1];
    const inPage=(cache.page||[]).some(r=>r.id==id), inGen=(cache.general||[]).some(r=>r.id==id);
    hashDone=true;
    /* the link is spent the moment it's read: strip it so a reload (or the URL
       lingering after a new-tab open) never pops the panel open again */
    try{history.replaceState(history.state,'',location.pathname+location.search);}catch(e){}
    const nav=(performance.getEntriesByType&&performance.getEntriesByType('navigation')[0])||{};
    if(nav.type==='reload'||nav.type==='back_forward')return;   /* only a fresh visit jumps */
    if(!inPage&&!inGen)return;                                   /* deleted or elsewhere: stay closed */
    if(!isOpen)open();
    const tab=$(`.tab[data-ctx="${inPage?'page':'general'}"]`);
    if(tab)tab.click();
    setTimeout(()=>gotoComment(id),120);
  }

  /* ================= per-page drafts ================= */
  /* one draft per page/tab: navigating away leaves it on the page it was
     written for, never the new one */
  const draftKey=()=>'dc_draft_'+(ctx==='page'?PAGE:ctx==='general'?'general':ctx);
  function restoreDraft(){
    const d=localStorage.getItem(draftKey())||'';
    if(textEl.value!==d){textEl.value=d;autoGrow();}
  }
  const saveDraft=()=>{
    if(!textEl)return;
    const v=textEl.value;
    try{v.trim()?localStorage.setItem(draftKey(),v):localStorage.removeItem(draftKey());}catch(e){}
  };
  textEl.addEventListener('input',saveDraft);
  /* a refresh or a hard navigation can beat the input handler on the last
     keystroke, so flush on the way out too */
  window.addEventListener('pagehide',saveDraft);
  window.addEventListener('beforeunload',saveDraft);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)saveDraft();});
  restoreDraft();

  /* ================= screenshot annotation ================= */
  const annot=$('.annot'), anCv=$('.ancv'), anCx=anCv.getContext('2d');
  let anImg=null, anShapes=[], anCur=null, anTool='pen', anDone=null;
  const accCol=()=>getComputedStyle(panel).getPropertyValue('--acc1').trim()||'#7fb0d4';
  function anRedraw(){
    anCx.clearRect(0,0,anCv.width,anCv.height);
    if(anImg)anCx.drawImage(anImg,0,0);
    const lw=Math.max(3,anCv.width/280);
    anCx.lineWidth=lw;anCx.lineCap='round';anCx.lineJoin='round';
    anCx.strokeStyle=accCol();anCx.fillStyle=accCol();
    [...anShapes,anCur].filter(Boolean).forEach(sp=>{
      anCx.beginPath();
      if(sp.t==='pen'){
        sp.pts.forEach((pt,i)=>i?anCx.lineTo(pt[0],pt[1]):anCx.moveTo(pt[0],pt[1]));
        anCx.stroke();
      }else if(sp.t==='box'){
        anCx.strokeRect(sp.x1,sp.y1,sp.x2-sp.x1,sp.y2-sp.y1);
      }else{ /* arrow */
        const ang=Math.atan2(sp.y2-sp.y1,sp.x2-sp.x1), hd=lw*4;
        anCx.moveTo(sp.x1,sp.y1);anCx.lineTo(sp.x2,sp.y2);anCx.stroke();
        anCx.beginPath();
        anCx.moveTo(sp.x2,sp.y2);
        anCx.lineTo(sp.x2-hd*Math.cos(ang-.45),sp.y2-hd*Math.sin(ang-.45));
        anCx.lineTo(sp.x2-hd*Math.cos(ang+.45),sp.y2-hd*Math.sin(ang+.45));
        anCx.closePath();anCx.fill();
      }
    });
  }
  const anPt=e=>{
    const r=anCv.getBoundingClientRect();
    return [(e.clientX-r.left)*anCv.width/r.width,(e.clientY-r.top)*anCv.height/r.height];
  };
  anCv.addEventListener('pointerdown',e=>{
    e.preventDefault();anCv.setPointerCapture(e.pointerId);
    const [x,y]=anPt(e);
    anCur=anTool==='pen'?{t:'pen',pts:[[x,y]]}:{t:anTool,x1:x,y1:y,x2:x,y2:y};
  });
  anCv.addEventListener('pointermove',e=>{
    if(!anCur)return;
    const [x,y]=anPt(e);
    if(anCur.t==='pen')anCur.pts.push([x,y]);
    else{anCur.x2=x;anCur.y2=y;}
    anRedraw();
  });
  anCv.addEventListener('pointerup',()=>{
    if(anCur){anShapes.push(anCur);anCur=null;anRedraw();anSync();}
  });
  $$('.antool').forEach(b=>b.onclick=()=>{
    $$('.antool').forEach(x=>x.classList.remove('on'));
    b.classList.add('on');anTool=b.dataset.t;
  });
  const anUndoBtn=$('.anundo');
  const anSync=()=>{anUndoBtn.disabled=!anShapes.length;};
  function closeAnnot(){
    if(!annot.classList.contains('show')||annot.classList.contains('closing'))return;
    annot.classList.add('closing');
    const done=()=>{annot.classList.remove('show','closing');anImg=null;anDone=null;};
    matchMedia('(prefers-reduced-motion:reduce)').matches
      ?done()
      :annot.addEventListener('animationend',done,{once:true});
  }
  anUndoBtn.onclick=()=>{anShapes.pop();anRedraw();anSync();};
  $('.ancancel').onclick=closeAnnot;
  $('.ansave').onclick=()=>{
    if(!anShapes.length){closeAnnot();return;}
    const btn=$('.ansave');btn.textContent='Saving\u2026';btn.disabled=true;
    const b64=anCv.toDataURL('image/png').split(',')[1];
    api('dc_upload',{type:'image/png',data:b64}).then(j=>{
      btn.textContent='Save';btn.disabled=false;
      if(!j.success){alert((j.data&&j.data.msg)||'Upload failed.');return;}
      const cb=anDone;
      closeAnnot();
      if(cb)cb(j.data.url);
    });
  };
  function openAnnot(url,done){
    const im=new Image();
    im.onload=()=>{
      anImg=im;anShapes=[];anCur=null;anDone=done;
      anCv.width=im.naturalWidth;anCv.height=im.naturalHeight;
      anRedraw();anSync();
      annot.classList.remove('closing');annot.classList.add('show');
    };
    im.onerror=()=>toast('Could not load that image for annotation.');
    im.src=url;
  }

  /* ---- who liked / who checked / posted-from: hover popovers ---- */
  const likePop=$('.likepop');
  function popRows(uids){
    return uids.map(uid=>{
      const nm=(USERS[uid]&&USERS[uid].name)||'Deleted account';
      return `<div class="lp-row"><span class="lp-ava" style="${avatarStyle(uid,nm)}">${escHtml(nm[0].toUpperCase())}</span>${escHtml(nm)}</div>`;
    }).join('');
  }
  let popHold=null;   /* just-clicked button: no popover until the mouse leaves it */
  function showLikePop(btn){
    if(btn===popHold)return;
    let html='';
    if(btn.classList.contains('minfo')){
      let m;try{m=JSON.parse(b64d(btn.dataset.m));}catch(e){return;}
      if(!m)return;
      html=`<div class="lp-row">${escHtml(m.b||'Unknown browser')}</div>`
          +`<div class="lp-row">Viewport ${m.w}\u00d7${m.h}${m.z?` @ ${m.z}% zoom`:m.dpr?` @ ${m.dpr}x`:''}</div>`
          +(m.os?`<div class="lp-row">${escHtml(m.os)}</div>`:'');
    }else{
      const rec=(cache[ctx]||[]).find(r=>r.id==btn.dataset.id);
      if(!rec)return;
      const uids=btn.classList.contains('ckb')?(rec.checks||[]):btn.classList.contains('dwn')?(rec.downs||[]):rec.likes;
      if(!uids.length)return;
      html=popRows(uids);
    }
    likePop.innerHTML=html;
    const pr=panel.getBoundingClientRect(), br=btn.getBoundingClientRect();
    likePop.style.left=Math.max(8,Math.min(br.left-pr.left,pr.width-likePop.offsetWidth-8||8))+'px';
    likePop.classList.add('show');
    /* above the button, or below when there is no room */
    const h=likePop.offsetHeight;
    likePop.style.top=(br.top-pr.top-h-6>8?br.top-pr.top-h-6:br.bottom-pr.top+6)+'px';
  }
  const hideLikePop=()=>likePop.classList.remove('show');
  list.addEventListener('mouseover',e=>{
    const btn=e.target.closest&&e.target.closest('.like,.ckb,.dwn,.minfo');
    if(btn)showLikePop(btn);
  });
  list.addEventListener('mouseout',e=>{
    if(e.target.closest&&e.target.closest('.like,.ckb,.dwn,.minfo')){hideLikePop();popHold=null;}
  });
  list.addEventListener('scroll',hideLikePop,{passive:true});

  /* ---- scroll-to-top / scroll-to-bottom ----
     Only one ever shows: at the very bottom you get "top", anywhere else you
     get "bottom", so the button always moves you somewhere. */
  const toTop=$('.totop'), toBot=$('.tobot');
  function placeJump(){
    /* sit just above whatever is at the bottom right now (compose bar, or the
       sign-in box when signed out) */
    const pr=panel.getBoundingClientRect();
    const bar=compose&&compose.style.display!=='none'?compose:authBox;
    const br=bar?bar.getBoundingClientRect():null;
    /* centre it on the divider: half the notch's 22px above the line */
    const gap=br?(pr.bottom-br.top)-11:22;
    toTop.style.bottom=gap+'px';toBot.style.bottom=gap+'px';
  }
  function syncJump(){
    const room=list.scrollHeight-list.clientHeight;
    if(room<200){                       /* nothing worth jumping through */
      toTop.classList.remove('show');toBot.classList.remove('show');return;
    }
    const atBottom=list.scrollTop>=room-24;
    const atTop=list.scrollTop<24;
    placeJump();
    toTop.classList.toggle('show',atBottom);
    toBot.classList.toggle('show',!atBottom&&!(atTop&&room<400));
  }
  const smooth=()=>matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth';
  list.addEventListener('scroll',syncJump,{passive:true});
  toTop.onclick=()=>{list.scrollTo({top:0,behavior:smooth()});toTop.classList.remove('show');};
  toBot.onclick=()=>{list.scrollTo({top:list.scrollHeight,behavior:smooth()});toBot.classList.remove('show');};

  /* ---- moderator confirmation: acting on someone else's comment ---- */
  const modBox=$('.modconfirm'), mcOk=$('.mcok'), mcTitle=$('.mctitle'),
        mcText=$('.mctext'), mcQuote=$('.mcquote');
  let mcGo=null;
  function closeModConfirm(){modBox.classList.remove('show');mcGo=null;}
  /* verb: 'edit' | 'delete'. Runs go() only after an explicit confirm. */
  /* one confirm dialog for every \u201care you sure\u201d in the panel */
  function confirmDialog({title,text,quote,ok,tone,go}){
    mcTitle.textContent=title;
    mcText.textContent=text;
    mcQuote.textContent=quote||'';
    mcQuote.style.display=quote?'':'none';
    mcOk.textContent=ok||'Confirm';
    mcOk.classList.toggle('edit',tone!=='danger');   /* accent unless destructive */
    mcGo=go;
    modBox.classList.add('show');
    setTimeout(()=>mcOk.focus(),0);
  }
  function modConfirm(rec,verb,go){
    const who=nameOf(rec);
    const ta=document.createElement('textarea');ta.innerHTML=rec.content;
    confirmDialog({
      title:verb==='edit'?'Edit someone else\u2019s comment?':'Delete someone else\u2019s comment?',
      text:verb==='edit'
        ?`This comment belongs to ${who}. You are editing it as a moderator \u2014 they will see your changes as their own words.`
        :`This comment belongs to ${who}. Deleting it as a moderator removes it for everyone, including any replies under it.`,
      quote:stripTok(ta.value).replace(/\[img\][^\[]*\[\/img\]/g,' [image] ').replace(/\s+/g,' ').trim().slice(0,180)||'[image]',
      ok:verb==='edit'?'Edit anyway':'Delete it',
      tone:verb==='edit'?'':'danger',
      go
    });
  }
  mcOk.onclick=()=>{const g=mcGo;closeModConfirm();if(g)g();};
  $('.mccancel').onclick=closeModConfirm;
  modBox.addEventListener('click',e=>{if(e.target===modBox)closeModConfirm();});
  document.addEventListener('keydown',e=>{
    if(!modBox.classList.contains('show'))return;
    if(e.key==='Escape')closeModConfirm();
  });
  /* true when this action needs the moderator warning first */
  const needsModOk=rec=>!!(rec&&isMod()&&!isMine(rec));

  /* ---- lightbox: image/GIF popups inside the panel ---- */
  const lb=$('.lightbox'), lbImg=lb.querySelector('img');
  function openLightbox(src){lb.classList.remove('closing');lbImg.src=src;lb.classList.add('show');}
  function closeLightbox(){
    if(!lb.classList.contains('show')||lb.classList.contains('closing'))return;
    lb.classList.add('closing');
    const done=()=>{lb.classList.remove('show','closing');lbImg.src='';};
    matchMedia('(prefers-reduced-motion:reduce)').matches
      ?done()
      :lb.addEventListener('animationend',done,{once:true});
  }
  lb.addEventListener('click',e=>{if(e.target!==lbImg)closeLightbox();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&lb.classList.contains('show'))closeLightbox();});

  const gifSeen=new WeakSet();
  function initGifs(){
    list.querySelectorAll('img').forEach(img=>{
      const src=img.dataset.gif||img.getAttribute('src')||'';
      if(!/\.gif(\?|$)/i.test(src)||gifSeen.has(img))return;
      gifSeen.add(img);
      img.dataset.gif=src;

      /* wrap so the GIF badge can sit on the corner when frozen */
      let wrap=img.parentElement;
      if(!wrap||!wrap.classList.contains('gifwrap')){
        wrap=document.createElement('span');
        wrap.className='gifwrap';
        img.replaceWith(wrap);wrap.appendChild(img);
      }

      captureStill(src);        /* pre-warm: freezing then costs no round trip */
      const alreadyWatched=watchedSet().has(src);
      let timer=null,frozen=false,played=alreadyWatched;
      const freeze=()=>{
        clearTimeout(timer);
        captureStill(src).then(still=>{
          if(!still||!wrap.isConnected)return;
          img.src=still;frozen=true;played=true;wrap.classList.add('paused');
          markWatched(src);
        });
      };
      const play=()=>{
        clearTimeout(timer);
        if(frozen){img.src=src;frozen=false;wrap.classList.remove('paused');}
      };
      const startWindow=()=>{clearTimeout(timer);timer=setTimeout(freeze,GIF_PLAY_MS);};

      wrap.addEventListener('mouseenter',play);
      /* once the opening plays are done, leaving stops it on the spot rather
         than letting it run on for another window */
      wrap.addEventListener('mouseleave',()=>{played?freeze():startWindow();});

      if(alreadyWatched){
        freeze();          /* seen before: straight to the still, hover to replay */
      }else if('IntersectionObserver'in window){
        /* first time: the play window starts when it comes on screen */
        const io=new IntersectionObserver(es=>{
          es.forEach(en=>{
            if(en.isIntersecting){startWindow();io.disconnect();}
          });
        },{root:list,threshold:.25});
        io.observe(wrap);
      }else{startWindow();}
    });
  }

  /* ================= data flow ================= */
  let knownIds=new Set();
  function applyData(data){
    USERS=data.users||{};
    /* whoever just posted is by definition no longer typing — drop them
       from typing state in the same paint their message appears in */
    const newAuthorIds=new Set(data.comments.filter(r=>!knownIds.has(r.id)).map(r=>r.user_id));
    knownIds=new Set(data.comments.map(r=>r.id));
    if(data.typing)for(const k in data.typing){
      data.typing[k]=data.typing[k].filter(p=>!newAuthorIds.has(p.uid));
      if(!data.typing[k].length)delete data.typing[k];
    }
    cache.page=[];cache.general=[];cache.other={};
    data.comments.forEach(r=>{
      if(pendingDel.has(String(r.id)))return;   /* deleted, still inside its undo window */
      if(r.context===PAGE)cache.page.push(r);
      else if(r.context==='general')cache.general.push(r);
      else (cache.other[r.context]=cache.other[r.context]||[]).push(r);
    });
    typingState=data.typing||{};renderTyping();
    if(data.presence)setPresence(data.presence);
    if(isOpen)markRead(ctx);
    setJoinBaseline();   /* first load for this account = the starting line */
    updateBadges();
    notifyFromRows([...(cache.page||[]),...(cache.general||[])]);
    render(cache[ctx]);
    updatePinEye();
    maybeHashGoto();   /* #dc-<id> links, incl. cross-page search results */
    if(ME)tfLinkedSync();   /* chips for tasks linked from comments */
  }

  function loadAll(){
    const seq=++getSeq;
    api('dc_all',{}).then(j=>{
      if(!j.success)return;
      if(inflight)return;       /* a post/delete/like hasn't committed — drop it */
      if(seq!==getSeq)return;   /* an older response arriving late — drop it */
      applyData(j.data);
    });
  }
  const load=loadAll;
  function mutate(action,data){
    inflight++;
    return api(action,data).then(j=>{
      if(!j.success&&j.data&&(j.data.code==='auth'||j.data.code==='team')){TF.signOut(true);setAuthed(null);}
      return j;
    }).finally(()=>{inflight--;load();});
  }

  /* ================= open/close, tabs ================= */
  const pageLabel=()=>PAGE.indexOf('/wp-admin:')===0?adminLabel(PAGE):PAGE;
  /* A native scrollbar always paints above page content, so it cannot be
     covered. While the panel is open it is repainted to match the panel \u2014 same
     background, same thumb as the list's own bar \u2014 so the edge reads as one
     surface. Its width is untouched, so nothing on the page reflows. */
  /* A native scrollbar always paints above page content, so it cannot be
     covered. While the panel is open it is repainted in the panel's own
     background \u2014 track and thumb alike \u2014 so it disappears into the edge. Its
     width is untouched, so nothing on the page reflows. */
  function hidePageBar(){
    if(barStyle)return;
    const bg=getComputedStyle(panel).getPropertyValue('--bg').trim()||'#141416';
    barStyle=document.createElement('style');
    barStyle.setAttribute('data-dc','bar');
    barStyle.textContent=
      'html{scrollbar-color:'+bg+' '+bg+'!important}'
      +'html::-webkit-scrollbar{background:'+bg+'!important}'
      +'html::-webkit-scrollbar-track{background:'+bg+'!important;border:0!important;box-shadow:none!important}'
      +'html::-webkit-scrollbar-thumb{background:'+bg+'!important;border:0!important;box-shadow:none!important}'
      +'html::-webkit-scrollbar-corner,html::-webkit-scrollbar-button{background:'+bg+'!important}';
    document.head.appendChild(barStyle);
  }
  function showPageBar(){
    if(!barStyle)return;
    barStyle.remove();barStyle=null;
  }

  function open(){
    isOpen=true;
    closePinFloat();syncTabPins();syncDock();syncScrollLock();
    hidePageBar();
    hidePinTip();   /* the pins tab and its list stay; they dock to the panel's edge */
    lastSig=null;
    panel.classList.add('open');overlay.classList.add('show');
    if(!panel.classList.contains('settings-open'))sub.textContent=viewTitle();
    divideAt=ME?Math.max(getSeen()[storeKey(ctx)]||0,getJoin()):Infinity;  /* snapshot before marking read */
    markRead(ctx);updateBadges();
    if(cache[ctx])render(cache[ctx],true); /* open at the newest comment */
    loadAll();
    if(ME&&TFS.team&&Date.now()-TFS.at>20000)tfLoadAll();   /* TaskFlow, if it's gone stale */
  }
  function closePanel(){closePinPop();isOpen=false;syncTabPins();showPageBar();panel.classList.remove('open');overlay.classList.remove('show');updatePinEye();syncDock();syncScrollLock();}

  /* scrolling anywhere over the panel stays inside the panel.
     preventDefault kills native page scroll, stopPropagation hides the event
     from the theme's Lenis instance — and we run our own Lenis-style lerp
     so the chat scrolls with the same smooth momentum as the page. */
  const REDUCED=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const spage=$('.spage');
  /* whichever region the cursor is over is the one the wheel drives: the
     innermost scrollable box under the pointer that can still move that way
     (task views, the focus strip, pop-up sheets, textareas), falling back to
     the main area of whatever view is showing */
  const canScroll=(el,dy)=>{
    if(!el||el.nodeType!==1||el.scrollHeight<=el.clientHeight+1)return false;
    const oy=getComputedStyle(el).overflowY;
    if(oy!=='auto'&&oy!=='scroll')return false;
    return dy<0?el.scrollTop>0:el.scrollTop<el.scrollHeight-el.clientHeight-1;
  };
  function scroller(e){
    const dy=e?e.deltaY:0;
    if(e&&e.composedPath){
      for(const n of e.composedPath()){
        if(n===panel)break;
        if(canScroll(n,dy))return n;
      }
    }
    if(panel.classList.contains('settings-open'))return spage;
    if(panel.classList.contains('tf-open'))return tfBody;
    return list;
  }
  let sTarget=0,sCurrent=0,sRaf=null,sEl=null;
  const maxScroll=el=>Math.max(0,el.scrollHeight-el.clientHeight);
  function sFrame(){
    if(!sEl){sRaf=null;return;}
    sTarget=Math.max(0,Math.min(sTarget,maxScroll(sEl)));
    sCurrent+=(sTarget-sCurrent)*0.11;
    if(Math.abs(sTarget-sCurrent)<0.5){sCurrent=sTarget;sEl.scrollTop=sCurrent;sRaf=null;return;}
    sEl.scrollTop=sCurrent;
    sRaf=requestAnimationFrame(sFrame);
  }
  panel.addEventListener('wheel',e=>{
    if(dragging)return;
    e.preventDefault();e.stopPropagation();
    const el=scroller(e);
    const step=(e.deltaMode===1?e.deltaY*32:e.deltaY)/(scale/100);
    if(REDUCED){el.scrollTop+=step;return;}
    if(sRaf===null||sEl!==el){sEl=el;sTarget=sCurrent=el.scrollTop;}
    sTarget+=step;
    if(sRaf===null)sRaf=requestAnimationFrame(sFrame);
  },{passive:false});
  /* any region scrolled another way (scrollbar drag, keys) resyncs the lerp */
  panel.addEventListener('scroll',e=>{
    const el=e.target;if(sRaf===null&&sEl===el){sTarget=sCurrent=el.scrollTop;}
  },{capture:true,passive:true});
  panel.addEventListener('touchmove',e=>e.stopPropagation(),{passive:true});

  /* ---- mobile: follow the visible viewport so the keyboard never covers the composer ---- */
  const vv=window.visualViewport;
  function syncViewport(){
    if(!vv)return;
    /* touch devices only: on desktop a trackpad pinch-zoom must not move the panel */
    if(!matchMedia('(pointer:coarse)').matches){host.style.setProperty('--kb','0px');host.style.setProperty('--vvt','0px');return;}
    const M=hostMap();
    const kb=Math.max(0,innerHeight-(vv.height+vv.offsetTop));
    host.style.setProperty('--kb',Math.round(M.s(kb))+'px');
    host.style.setProperty('--vvt',Math.round(M.s(Math.max(0,vv.offsetTop)))+'px');
  }
  if(vv){vv.addEventListener('resize',syncViewport);vv.addEventListener('scroll',syncViewport);syncViewport();}
  /* phones: the sheet owns the screen, so the page behind stops scrolling */
  const narrow=matchMedia('(max-width:640px)');
  let lockPrev=null;
  function syncScrollLock(){
    const want=isOpen&&narrow.matches, de=document.documentElement;
    if(want&&lockPrev===null){lockPrev=de.style.overflow;de.style.overflow='hidden';}
    else if(!want&&lockPrev!==null){de.style.overflow=lockPrev;lockPrev=null;}
  }
  narrow.addEventListener&&narrow.addEventListener('change',()=>{syncScrollLock();syncDock();});
  /* swipe the panel back toward its edge to close it: direction-locked so
     vertical scrolling is untouched; the rig follows the finger 1:1 and a
     quick flick or a drag past a third of the width closes it */
  let sw=null;
  panel.addEventListener('touchstart',e=>{
    if(!isOpen||e.touches.length!==1)return;
    const t=e.composedPath()[0];
    if(t&&(t.closest?.('textarea,input,select,.gifgrid,.lightbox,.annot,.resizer')||t.isContentEditable))return;
    const p=e.touches[0];
    sw={x:p.clientX,y:p.clientY,t:performance.now(),lock:null,dx:0,W:dockPx||panel.offsetWidth};
  },{passive:true});
  panel.addEventListener('touchmove',e=>{
    if(!sw)return;
    const p=e.touches[0], left=side==='left';
    let dx=p.clientX-sw.x, dy=p.clientY-sw.y;
    if(sw.lock===null){
      if(Math.abs(dx)<8&&Math.abs(dy)<8)return;
      sw.lock=Math.abs(dx)>Math.abs(dy)*1.2&&(left?dx<0:dx>0)?'x':'y';
      if(sw.lock==='x')rig.classList.add('dockfast');
    }
    if(sw.lock!=='x')return;
    e.preventDefault();
    const M=hostMap(), d=Math.max(0,M.s(left?-dx:dx));
    sw.dx=d;sw.lastT=performance.now();
    rig.style.setProperty('--rx',Math.max(0,sw.W-d)+'px');
    overlay.style.opacity=String(Math.max(0,1-d/sw.W));
  },{passive:false});
  function endSwipe(){
    if(!sw)return;
    const s=sw;sw=null;
    if(s.lock!=='x')return;
    const v=s.dx/Math.max(1,performance.now()-s.t);          /* px per ms */
    rig.classList.remove('dockfast');overlay.style.opacity='';
    if(s.dx>s.W*0.33||v>0.45)closePanel();
    else rig.style.setProperty('--rx',s.W+'px');             /* springs back on the drawer curve */
  }
  panel.addEventListener('touchend',endSwipe);
  panel.addEventListener('touchcancel',endSwipe);

  /* Ctrl+/ (or Cmd+/) opens and closes the panel from anywhere on the page */
  window.addEventListener('keydown',e=>{
    if((e.ctrlKey||e.metaKey)&&(e.key==='/'||e.code==='Slash')){
      e.preventDefault();
      /* keyboard toggles are for speed: same motion, a quicker 220ms */
      rig.classList.add('kb');overlay.classList.add('kb');clearTimeout(rig._kb);
      rig._kb=setTimeout(()=>{rig.classList.remove('kb');overlay.classList.remove('kb');},600);
      panel.classList.contains('open')?closePanel():open();
      if(panel.classList.contains('open'))setTimeout(()=>textEl.focus(),120);
    }
    /* the pins list beside the panel takes the first Esc */
    if(e.key==='Escape'&&panel.classList.contains('open')&&!pinMenu.classList.contains('show')
      &&!addMenu.classList.contains('show')&&!ctxBox.classList.contains('show'))closePanel();
  },true);

  $('.toggle').onclick=e=>{
    if(e.composedPath().includes($('.tglpin'))){e.stopPropagation();floatOn?closePinFloat():openPinFloat();return;}
    isOpen?closePanel():open();
  };
  $('.close').onclick=closePanel;
  overlay.onclick=closePanel;

  const pagesTab=$('.pages-tab'), pageMenu=$('.pagemenu');
  pagesTab.onclick=()=>{
    if(pagesView){const t=$('.tab[data-ctx="page"]');if(t)t.click();return;}
    openPagesView();
  };
  panel.addEventListener('click',e=>{
    if(pageMenu.classList.contains('show')&&!e.composedPath().includes(pagesTab)&&!e.composedPath().includes(pageMenu)){
      pagesTab.classList.remove('openm');pageMenu.classList.remove('show');
    }
  });

  $$('.tab[data-ctx]').forEach(t=>t.onclick=e=>{
    const tp=e&&e.composedPath().find(n=>n.classList&&n.classList.contains('tabpin'));
    if(tp){openPinPop(tp.dataset.pw);return;}
    if(view!=='comments')switchView('comments',true);
    $$('.tab[data-ctx]').forEach(x=>x.classList.remove('active'));
    t.classList.add('active');ctx=t.dataset.ctx;
    closeNotifView();closePagesView();
    closePinPop();
    closeSettings();
    sub.textContent=ctx==='page'?pageLabel():'All pages';
    cancelReply();clearPicks();
    if(searchQ)closeSearch();
    closePinsView();
    restoreDraft();
    lastSig=null;
    divideAt=ME?Math.max(getSeen()[storeKey(ctx)]||0,getJoin()):Infinity;  /* snapshot before marking read */
    if(cache[ctx])render(cache[ctx],true); /* instant paint, jump to newest */
    viewIn();
    markRead(ctx);updateBadges();renderTyping();
    load();                                 /* silent refresh behind it */
  });

  /* ================= typing indicator ================= */
  const typingBox=$('.typing'), typingWho=$('.twho');
  let typingHideTimer=null;
  function renderTyping(){
    clearTimeout(typingHideTimer);
    const key=ctx==='page'?PAGE:'general';
    const people=(typingState[key]||[]).filter(p=>!ME||p.uid!==ME.id);
    if(!people.length){typingBox.classList.remove('show');return;}
    const names=people.map(p=>p.name);
    typingWho.textContent=(names.length===1?names[0]+' is':names.join(' and ')+' are')+' typing…';
    typingBox.classList.add('show');
    const ttl=Math.min(...people.map(p=>p.ttl));
    typingHideTimer=setTimeout(()=>typingBox.classList.remove('show'),ttl);
  }
  /* heartbeat every 2s while the field has text; explicit stop when emptied;
     posting clears it server-side so it drops exactly when the message lands */
  let wasTyping=false, sentAt=0;
  function typingTick(){
    if(!ME)return;
    const has=!!textEl.value.trim();
    if(Date.now()-sentAt<1500)return;
    if(has){wasTyping=true;api('dc_typing',{});}
    else if(wasTyping){wasTyping=false;api('dc_typing',{stop:1});}
  }
  textEl.addEventListener('input',()=>{
    if(!ME)return;
    const has=!!textEl.value.trim();
    if(Date.now()-sentAt<1500)return;
    if(has&&!wasTyping){wasTyping=true;api('dc_typing',{});}
    else if(!has&&wasTyping){wasTyping=false;api('dc_typing',{stop:1});}
  });
  setInterval(typingTick,2000);

  /* ================= interactions ================= */
  function cancelReply(){parentId=0;replyBar.style.display='none';}
  replyBar.querySelector('button').onclick=cancelReply;

  list.addEventListener('click',e=>{
    if(!ME)return;
    const like=e.composedPath().find(n=>n.classList&&n.classList.contains('like'));
    if(like){
      const n=parseInt(like.textContent.trim()||'0',10);
      const on=like.classList.toggle('liked');
      like.lastChild.textContent=' '+((on?n+1:n-1)||'');
      like.classList.remove('bump');void like.offsetWidth;like.classList.add('bump');
      hideLikePop();popHold=like;
      mutate('dc_like',{id:like.dataset.id});
    }
    /* collapsed done thread: "Not done" un-dones it for everyone, the row
       itself just peeks it open locally */
    const undo=e.composedPath().find(n=>n.dataset&&n.dataset.undo);
    if(undo){
      e.stopPropagation();
      const id=undo.dataset.undo;
      toggleDone(id);
      undoable('Thread reopened',()=>toggleDone(id));
      return;
    }
    const dg=e.composedPath().find(n=>n.dataset&&n.dataset.dgrp);
    if(dg){
      const k=dg.dataset.dgrp;
      if(openDoneRuns.has(k))openDoneRuns.delete(k);else openDoneRuns.add(k);
      lastSig=null;
      if(cache[ctx])render(cache[ctx]);
      return;
    }
    const coll=e.composedPath().find(n=>n.classList&&n.classList.contains('collapsed'));
    if(coll){
      const cid=coll.dataset.id;
      morphDone(cid,()=>expandedDone.add(String(cid)));
      return;
    }
    const recoll=e.composedPath().find(n=>n.dataset&&n.dataset.collapse);
    if(recoll){
      const rid=recoll.dataset.collapse;
      morphDone(rid,()=>expandedDone.delete(String(rid)));
      return;
    }
    /* moderator pins a comment out of the feed */
    const pc2=e.composedPath().find(n=>n.dataset&&n.dataset.pinc);
    if(pc2){
      const id=pc2.dataset.pinc;
      const on=togglePinC(id);
      undoable(on?'Pinned \u2014 it\u2019s under the pin badge':'Unpinned',()=>togglePinC(id));
      return;
    }
    /* Done: shared collapse for the whole thread, anyone can set or clear */
    const dn=e.composedPath().find(n=>n.dataset&&n.dataset.done);
    if(dn){
      const id=dn.dataset.done;
      const nowDone=toggleDone(id);
      undoable(nowDone?'Marked done':'Thread reopened',()=>toggleDone(id));
      return;
    }
    const dw=e.composedPath().find(n=>n.classList&&n.classList.contains('dwn'));
    if(dw){
      const n=parseInt(dw.textContent.trim()||'0',10);
      const on=dw.classList.toggle('downed');
      dw.lastChild.textContent=' '+((on?n+1:n-1)||'');
      dw.classList.remove('bump');void dw.offsetWidth;dw.classList.add('bump');
      hideLikePop();popHold=dw;
      mutate('dc_down',{id:dw.dataset.id});
      return;
    }
    const ck=e.composedPath().find(n=>n.classList&&n.classList.contains('ckb'));
    if(ck){
      const n=parseInt(ck.textContent.trim()||'0',10);
      const on=ck.classList.toggle('checked');
      ck.lastChild.textContent=' '+((on?n+1:n-1)||'');
      ck.classList.remove('bump');void ck.offsetWidth;ck.classList.add('bump');
      hideLikePop();popHold=ck;
      mutate('dc_check',{id:ck.dataset.id});
    }
    const del=e.composedPath().find(n=>n.classList&&n.classList.contains('del'));
    if(del){
      const drec=(cache[ctx]||[]).find(r=>r.id==del.dataset.id);
      if(needsModOk(drec)&&!del.dataset.ok){
        modConfirm(drec,'delete',()=>{del.dataset.ok='1';del.click();});
        return;
      }
      if(!del.classList.contains('arm')){
        del.classList.add('arm');del.textContent='Sure?';
        setTimeout(()=>{del.classList.remove('arm');del.textContent='Delete';},2500);
        return;
      }
      const row=del.closest('.item'), id=del.dataset.id;
      row.classList.add('gone');
      picked.delete(String(id));syncPicking();
      softDelete(id);
      return;
    }
    const rep=e.composedPath().find(n=>n.classList&&n.classList.contains('do-reply'));
    if(rep){
      parentId=rep.dataset.id;
      replyBar.querySelector('b').textContent=rep.dataset.author;
      replyBar.style.display='flex';textEl.focus();
    }
    const pc=e.composedPath().find(n=>n.classList&&n.classList.contains('pinchip'));
    if(pc){showPin(b64d(pc.dataset.sel),pc.dataset.x,pc.dataset.y,pc.dataset.app||'');return;}
    const im=e.composedPath().find(n=>n.tagName==='IMG'&&n.closest&&n.closest('.content'));
    if(im){openLightbox(im.dataset.gif||im.dataset.full||im.src);return;}
    const q=e.composedPath().find(n=>n.classList&&n.classList.contains('quote'));
    if(q){
      const target=list.querySelector(`.item[data-id="${q.dataset.goto}"]`);
      if(target){
        target.scrollIntoView({block:'center',behavior:'smooth'});
        target.classList.remove('flash');void target.offsetWidth;target.classList.add('flash');
      }
      return;
    }
    const box=e.composedPath().find(n=>n.classList&&n.classList.contains('pick'));
    if(box){togglePick(box.dataset.id);return;}
    const ps=e.composedPath().find(n=>n.classList&&n.classList.contains('pickstart'));
    if(ps){togglePick(ps.dataset.id);return;}
    const tf=e.composedPath().find(n=>n.classList&&n.classList.contains('task'));
    if(tf){
      const rec=(cache[ctx]||[]).find(r=>r.id==tf.dataset.id);
      if(!rec)return;
      /* un-escape the server-escaped body, then split it: pasted screenshots
         go to TaskFlow as attachments, the prose goes in the feedback field */
      const ta=document.createElement('textarea');ta.innerHTML=rec.content;
      const raw=ta.value;
      const imgs=[...raw.matchAll(/\[img\](https?:[^\s\[\]]+)\[\/img\]/g)].map(m=>m[1]);
      const body=raw.replace(/\[img\][^\[]*\[\/img\]/g,'').replace(TOKRE,'').replace(/\n{3,}/g,'\n\n').trim();
      const pageUrl=rec.context==='general'?ORIGIN
        :rec.context.indexOf('/wp-admin:')===0?ORIGIN+adminHref(rec.context)
        :ORIGIN+rec.context;
      /* signed in with TaskFlow: the task is made right here in the sidebar
         and linked back to this comment (Shift-click still builds the URL) */
      if(TF_READY&&ME&&ME.sb_uid&&!e.shiftKey){
        if(rec.task_id){openTaskView(rec.task_id);return;}
        openTaskForm({feedback:body,page:pageUrl,noticed:nameOf(rec),attachments:imgs.slice(0,10),link:[rec.id]});
        return;
      }
      const q=new URLSearchParams({
        new:'1',
        page:pageUrl,
        feedback:body,
        source:'dev-comments'
      });
      if(imgs.length)q.set('attachments',imgs.slice(0,10).join('|'));  /* TaskFlow caps at 10 */
      const url=TASKFLOW+(TASKFLOW.includes('?')?'&':'?')+q.toString();
      api('dc_tasked',{id:rec.id});   /* lets the author be notified */
      /* Shift-click copies the link instead of opening it, so the exact URL
         the button builds can be compared against one pasted by hand. */
      if(e.shiftKey){
        (navigator.clipboard?navigator.clipboard.writeText(url):Promise.reject())
          .then(()=>alert('TaskFlow URL copied to clipboard.'))
          .catch(()=>window.prompt('TaskFlow URL:',url));
        return;
      }
      openTaskflow(url);
      tf.classList.add('sent');
      setTimeout(()=>tf.classList.remove('sent'),1600);
    }
    const tc=e.composedPath().find(n=>n.classList&&n.classList.contains('taskchip'));
    if(tc){openTaskView(tc.dataset.taskid);return;}
    const ed=e.composedPath().find(n=>n.classList&&n.classList.contains('edit'));
    if(ed){
      const row=ed.closest('.item'), body=row.querySelector('.content');
      if(row.querySelector('.editbox'))return;
      const id=ed.dataset.id, ctxRows=cache[ctx]||[];
      const rec=ctxRows.find(r=>r.id==id);
      if(needsModOk(rec)&&!ed.dataset.ok){
        modConfirm(rec,'edit',()=>{ed.dataset.ok='1';ed.click();});
        return;
      }
      delete ed.dataset.ok;
      const t=document.createElement('textarea');t.innerHTML=rec?rec.content:'';
      const orig=t.value;
      /* pin/meta tokens are invisible to readers, so hide them from the editor
         too and stitch them back on save */
      /* the pin is editable; other invisible tokens (meta) ride along as-is */
      let editPin=parsePin(orig);
      const metaToks=(orig.match(TOKRE)||[]).filter(t=>t.indexOf('[meta]')>-1).join('');
      body.style.display='none';
      const box=document.createElement('textarea');box.className='editbox';box.value=stripTok(orig).trim();
      const pinRow=document.createElement('div');pinRow.className='editpinrow';
      const paintPinRow=()=>{
        /* can this pin's target still be snapshotted here? (estimator pins made
           before form capture existed have no state and can be given one) */
        let tgt=null;
        if(editPin){try{tgt=document.querySelector(editPin.sel);}catch(e){}}
        const canCapture=!!(tgt&&captureApp(tgt));
        pinRow.innerHTML=editPin
          ?'<span class="epin"><svg viewBox="0 0 24 24"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>Pinned'
            +(editPin.tag?' \u00b7 '+escHtml(editPin.tag):'')
            +(editPin.app?' \u00b7 form saved':'')+'</span>'
            +(canCapture?`<button class="ecap">${editPin.app?'Update':'Save'} form state</button>`:'')
            +'<button class="erepin">Re-pick</button><button class="eunpin">Remove pin</button>'
          :'<button class="eaddpin"><svg viewBox="0 0 24 24"><path d="M12 21s-7-5.1-7-11a7 7 0 0 1 14 0c0 5.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>Add a pin</button>';
        const repick=()=>startPick(np=>{editPin=np;paintPinRow();});
        if(editPin){
          pinRow.querySelector('.erepin').onclick=repick;
          pinRow.querySelector('.eunpin').onclick=()=>{editPin=null;paintPinRow();};
          const cap=pinRow.querySelector('.ecap');
          /* snapshot the form as it is set up RIGHT NOW onto the existing pin */
          if(cap)cap.onclick=()=>{editPin.app=captureApp(tgt);paintPinRow();};
        }else{
          pinRow.querySelector('.eaddpin').onclick=repick;
        }
      };
      paintPinRow();
      const rowBtns=document.createElement('div');rowBtns.className='editrow';
      rowBtns.innerHTML='<button class="esave">Save</button><button class="ecancel">Cancel</button>';
      body.after(box,pinRow,rowBtns);box.focus();
      const closeEdit=()=>{box.remove();pinRow.remove();rowBtns.remove();body.style.display='';};
      rowBtns.querySelector('.ecancel').onclick=closeEdit;
      rowBtns.querySelector('.esave').onclick=()=>{
        const nc0=box.value.trim();if(!nc0){box.focus();return;}
        const nc=nc0+(editPin?'\n'+pinTok(editPin):'')+metaToks;
        body.innerHTML=rich(escHtml(nc));  /* optimistic */
        closeEdit();
        mutate('dc_edit',{id,content:nc});
      };
      box.addEventListener('keydown',ev=>{
        if(ev.key==='Enter'&&!ev.shiftKey){ev.preventDefault();rowBtns.querySelector('.esave').click();}
        if(ev.key==='Escape')closeEdit();
      });
    }
  });

  /* ---- multi-select: bundle several comments into a single task ---- */
  const pickBar=$('.pickbar'), pickCount=pickBar.querySelector('.pcount b'), pickGo=$('.pgo');
  function syncPicking(){
    panel.classList.toggle('picking',picked.size>0);
    pickCount.textContent=picked.size;
    pickGo.disabled=picked.size===0;
  }
  function togglePick(id){
    id=String(id);
    picked.has(id)?picked.delete(id):picked.add(id);
    const row=list.querySelector(`.item[data-id="${id}"]`);
    if(row){
      row.classList.toggle('picked',picked.has(id));
      const box=row.querySelector('.pick');
      if(box)box.classList.toggle('on',picked.has(id));
    }
    syncPicking();
  }
  function clearPicks(){
    picked.clear();
    list.querySelectorAll('.item.picked').forEach(el=>el.classList.remove('picked'));
    list.querySelectorAll('.pick.on').forEach(el=>el.classList.remove('on'));
    syncPicking();
  }
  $('.pcancel').onclick=clearPicks;

  /* one task from everything selected, in the order it appears in the thread */
  pickGo.onclick=()=>{
    const rows=(cache[ctx]||[]).filter(r=>picked.has(String(r.id)));
    if(!rows.length)return;
    const imgs=[];const parts=[];
    rows.forEach(r=>{
      const ta=document.createElement('textarea');ta.innerHTML=r.content;
      const raw=ta.value;
      [...raw.matchAll(/\[img\](https?:[^\s\[\]]+)\[\/img\]/g)].forEach(m=>imgs.push(m[1]));
      const body=raw.replace(/\[img\][^\[]*\[\/img\]/g,'').replace(TOKRE,'').replace(/\n{3,}/g,'\n\n').trim();
      if(body)parts.push(nameOf(r)+': '+body);
    });
    const first=rows[0];
    const pageUrl=first.context==='general'?ORIGIN
      :first.context.indexOf('/wp-admin:')===0?ORIGIN+adminHref(first.context)
      :ORIGIN+first.context;
    if(TF_READY&&ME&&ME.sb_uid){
      const who=[...new Set(rows.map(nameOf))].join(', ');
      openTaskForm({feedback:parts.join('\n\n'),page:pageUrl,noticed:who,attachments:imgs.slice(0,10),link:rows.map(r=>r.id)});
      clearPicks();
      return;
    }
    const q=new URLSearchParams({
      new:'1',page:pageUrl,feedback:parts.join('\n\n'),source:'dev-comments'
    });
    if(imgs.length)q.set('attachments',imgs.slice(0,10).join('|'));
    openTaskflow(TASKFLOW+(TASKFLOW.includes('?')?'&':'?')+q.toString());
    clearPicks();
  };

  /* Reuse one TaskFlow tab. A kept reference is more reliable than the window
     name alone: the name only matches tabs this page opened, while the handle
     survives for the life of the page. Neither 'noopener' nor 'noreferrer' can
     be used — both force a brand new tab every time. */
  let tfWin=null;
  function openTaskflow(url){
    try{
      if(tfWin&&!tfWin.closed){
        tfWin.location.href=url;   /* full navigation, so the SPA boots fresh */
        tfWin.focus();
        return;
      }
    }catch(_){}                     /* handle went stale: fall through */
    tfWin=window.open(url,'taskflow');
    if(tfWin)try{tfWin.focus();}catch(_){}
  }

  /* auto-grow: the box expands upward as you type instead of scrolling.
     It only starts scrolling once it would eat the whole panel. */
  function autoGrow(){
    textEl.style.height='auto';
    const cap=Math.max(120,panel.clientHeight*0.55);
    const h=textEl.scrollHeight;
    textEl.style.height=Math.min(h,cap)+'px';
    textEl.style.overflowY=h>cap?'auto':'hidden';
  }
  textEl.addEventListener('input',autoGrow);

  /* ---- screenshot paste: upload immediately, show chip, attach on send ---- */
  const chipsBox=$('.chips');
  let pendingImgs=[];
  const syncChips=()=>chipsBox.classList.toggle('show',chipsBox.children.length>0);
  textEl.addEventListener('paste',e=>{
    if(!ME)return;
    const items=[...(e.clipboardData?.items||[])].filter(i=>i.type.startsWith('image/'));
    if(!items.length)return;
    e.preventDefault();
    attachImages(items.map(it=>it.getAsFile()).filter(Boolean));
  });
  const IMG_OK=['image/png','image/jpeg','image/webp','image/gif'];
  function attachImages(files){
    if(!ME)return;
    files.filter(f=>IMG_OK.includes(f.type)).forEach(file=>{
      const chip=document.createElement('div');chip.className='chip loading';chip.textContent='…';
      chipsBox.appendChild(chip);syncChips();
      const fr=new FileReader();
      fr.onload=()=>{
        const b64=fr.result.split(',')[1];
        api('dc_upload',{type:file.type,data:b64}).then(j=>{
          if(!j.success){chip.remove();syncChips();alert((j.data&&j.data.msg)||'Upload failed.');return;}
          const url=j.data.url;
          pendingImgs.push(url);
          chip.classList.remove('loading');
          let cur=url;   /* annotation replaces the pending url in place */
          chip.innerHTML=`<img src="${url}"><button class="x" type="button">✕</button><button class="an" type="button" title="Annotate" aria-label="Annotate">✎</button>`;
          chip.querySelector('.x').onclick=()=>{
            pendingImgs=pendingImgs.filter(u=>u!==cur);chip.remove();syncChips();
          };
          chip.querySelector('.an').onclick=()=>openAnnot(cur,nu=>{
            pendingImgs=pendingImgs.map(u=>u===cur?nu:u);cur=nu;
            chip.querySelector('img').src=nu;
          });
        });
      };
      fr.readAsDataURL(file);
    });
    syncWriting();
  }
  const imgFile=$('.imgfile');
  $('.imgbtn').onclick=()=>imgFile.click();
  imgFile.onchange=()=>{attachImages([...imgFile.files]);imgFile.value='';textEl.focus();};
  /* drag an image onto the panel */
  let dragDepth=0;
  const hasFiles=e=>[...(e.dataTransfer&&e.dataTransfer.types||[])].includes('Files');
  panel.addEventListener('dragenter',e=>{if(!ME||!hasFiles(e))return;e.preventDefault();dragDepth++;panel.classList.add('dragging');});
  panel.addEventListener('dragover',e=>{if(!ME||!hasFiles(e))return;e.preventDefault();e.dataTransfer.dropEffect='copy';});
  panel.addEventListener('dragleave',()=>{if(--dragDepth<=0){dragDepth=0;panel.classList.remove('dragging');}});
  panel.addEventListener('drop',e=>{
    if(!hasFiles(e))return;
    e.preventDefault();dragDepth=0;panel.classList.remove('dragging');
    attachImages([...e.dataTransfer.files]);textEl.focus();
  });

  /* ---- formatting: toolbar, shortcuts ---- */
  const composeEl=$('.compose');
  let composeFocus=false;
  function syncWriting(){
    composeEl.classList.toggle('writing',!!ME&&(composeFocus||!!textEl.value||chipsBox.children.length>0));
  }
  textEl.addEventListener('focus',()=>{composeFocus=true;syncWriting();});
  textEl.addEventListener('blur',()=>{setTimeout(()=>{composeFocus=composeEl.contains(root.activeElement);syncWriting();},120);});
  textEl.addEventListener('input',syncWriting);
  function insertText(txt,selFrom,selTo){
    textEl.focus();
    const a=textEl.selectionStart,b=textEl.selectionEnd;
    if(!document.execCommand||!document.execCommand('insertText',false,txt))textEl.setRangeText(txt,a,b,'end');
    if(selFrom!==undefined)textEl.setSelectionRange(a+selFrom,a+(selTo===undefined?selFrom:selTo));
    textEl.dispatchEvent(new Event('input',{bubbles:true}));
  }
  function wrapSel(l,r){
    const a=textEl.selectionStart,b=textEl.selectionEnd,v=textEl.value.slice(a,b);
    if(v&&v.startsWith(l)&&v.endsWith(r)&&v.length>=l.length+r.length){insertText(v.slice(l.length,v.length-r.length),0,v.length-l.length-r.length);return;}
    insertText(l+v+r,l.length,l.length+v.length);
  }
  function bulletSel(){
    const v=textEl.value,a=textEl.selectionStart,b=textEl.selectionEnd;
    const ls=v.lastIndexOf('\n',a-1)+1;
    textEl.setSelectionRange(ls,b);
    const block=v.slice(ls,b)||'';
    const out=block.split('\n').map(l=>l.startsWith('- ')?l.slice(2):'- '+l).join('\n');
    insertText(out,out.length);
  }
  const FMT={bold:()=>wrapSel('**','**'),italic:()=>wrapSel('*','*'),code:()=>wrapSel('`','`'),list:bulletSel,
    mention:()=>{const a=textEl.selectionStart,pre=textEl.value.slice(0,a);insertText((pre&&!/\s$/.test(pre)?' ':'')+'@');}};
  $('.fmtbar').addEventListener('mousedown',e=>e.preventDefault());   /* keep the selection */
  $('.fmtbar').addEventListener('click',e=>{
    const b=e.composedPath().find(n=>n.dataset&&n.dataset.fmt);if(b)FMT[b.dataset.fmt]();
  });
  textEl.addEventListener('keydown',e=>{
    if(!(e.ctrlKey||e.metaKey)||e.altKey)return;
    const k=e.key.toLowerCase();
    if(k==='b'){e.preventDefault();FMT.bold();}
    else if(k==='i'){e.preventDefault();FMT.italic();}
    else if(k==='e'){e.preventDefault();FMT.code();}
  });

  /* ---- @mention picker ---- */
  const mPop=$('.mentionpop');
  let mState=null;   /* {start,q,items,i} */
  function mentionScan(){
    const a=textEl.selectionStart;
    if(a!==textEl.selectionEnd){closeMention();return;}
    const m=/(^|\s)@([^\s@]{0,24})$/.exec(textEl.value.slice(0,a));
    if(!m){closeMention();return;}
    const q=m[2].toLowerCase();
    const here=new Set(liveOn(PAGE));
    const items=Object.entries(USERS).filter(([id,u])=>u&&u.name&&(!ME||+id!==ME.id))
      .map(([id,u])=>({id:+id,name:u.name,here:here.has(+id)}))
      .filter(u=>!q||u.name.toLowerCase().includes(q))
      .sort((x,y)=>(y.here-x.here)||(x.name.toLowerCase().indexOf(q)-y.name.toLowerCase().indexOf(q))||x.name.localeCompare(y.name))
      .slice(0,6);
    if(!items.length){closeMention();return;}
    mState={start:a-m[2].length-1,q,items,i:mState&&mState.q===q?Math.min(mState.i,items.length-1):0};
    paintMention();
  }
  function paintMention(){
    const {items,i,q}=mState;
    const hl=n=>{const k=q?n.toLowerCase().indexOf(q):-1;return k<0?escHtml(n):escHtml(n.slice(0,k))+'<mark>'+escHtml(n.slice(k,k+q.length))+'</mark>'+escHtml(n.slice(k+q.length));};
    mPop.innerHTML='<div class="mp-h">Mention someone</div>'+items.map((u,j)=>
      `<button type="button" class="mp-it${j===i?' sel':''}" data-j="${j}"><span class="mp-av" style="${avatarStyle(u.id,u.name)}">${avatarUrlOf(u.id)?'':escHtml(u.name[0].toUpperCase())}</span>`
      +`<span class="mp-nm">${hl(u.name)}</span>${u.here?'<em>here now</em>':''}</button>`).join('');
    mPop.classList.add('show');
  }
  function closeMention(){mState=null;mPop.classList.remove('show');}
  function pickMention(j){
    if(!mState)return;
    const u=mState.items[j];if(!u)return;
    const a=textEl.selectionStart;
    textEl.setSelectionRange(mState.start,a);
    closeMention();
    insertText('@'+u.name+' ');
  }
  textEl.addEventListener('input',mentionScan);
  textEl.addEventListener('click',mentionScan);
  textEl.addEventListener('blur',()=>setTimeout(closeMention,150));
  mPop.addEventListener('mousedown',e=>e.preventDefault());
  mPop.addEventListener('click',e=>{const b=e.composedPath().find(n=>n.dataset&&n.dataset.j!==undefined);if(b)pickMention(+b.dataset.j);});
  /* capture: runs before Enter-to-send */
  textEl.addEventListener('keydown',e=>{
    if(!mState)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){
      e.preventDefault();e.stopImmediatePropagation();
      const n=mState.items.length;mState.i=(mState.i+(e.key==='ArrowDown'?1:n-1))%n;paintMention();
    }else if(e.key==='Enter'||e.key==='Tab'){
      e.preventDefault();e.stopImmediatePropagation();pickMention(mState.i);
    }else if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();closeMention();}
  },true);

  /* ---- GIF picker: results come through the server so no key is exposed ---- */
  const gifBtn=$('.gifbtn'), gifPicker=$('.gifpicker'), gifQ=$('.gifq'), gifGrid=$('.gifgrid');
  let gifTimer=null, gifSeq=0, gifLoaded=false;
  if(!HAS_GIFS)gifBtn.style.display='none';

  function gifSearch(q){
    const seq=++gifSeq;
    gifGrid.innerHTML='<div class="gifnote">Searching…</div>';
    api('dc_gif',{q}).then(j=>{
      if(seq!==gifSeq)return;
      if(!j.success){gifGrid.innerHTML='<div class="gifnote">'+((j.data&&j.data.msg)||'Search failed.')+'</div>';return;}
      if(!j.data.length){gifGrid.innerHTML='<div class="gifnote">Nothing found.</div>';return;}
      gifGrid.innerHTML='';
      j.data.forEach((g,i)=>{
        const im=document.createElement('img');
        im.src=g.preview;im.alt=g.alt;im.loading='lazy';
        im.style.animationDelay=Math.min(i,14)*16+'ms';   /* light stagger */
        im.onclick=()=>{addGif(g.url);};
        gifGrid.appendChild(im);
      });
    });
  }
  function addGif(url){
    pendingImgs.push(url);
    const chip=document.createElement('div');
    chip.className='chip';
    chip.innerHTML='<img src="'+url+'"><button class="x" type="button">\u2715</button>';
    chip.querySelector('.x').onclick=()=>{
      pendingImgs=pendingImgs.filter(u=>u!==url);chip.remove();syncChips();
    };
    chipsBox.appendChild(chip);syncChips();
    closeGifs();textEl.focus();
  }
  function openGifs(){
    gifPicker.classList.add('show');gifBtn.classList.add('on');
    setTimeout(()=>gifQ.focus(),0);   /* after the outside-click pass */
    if(!gifLoaded){gifLoaded=true;gifSearch('');}
  }
  function closeGifs(){gifPicker.classList.remove('show');gifBtn.classList.remove('on');}
  gifBtn.onclick=e=>{e.stopPropagation();gifPicker.classList.contains('show')?closeGifs():openGifs();};
  $('.gifclose').onclick=()=>{closeGifs();textEl.focus();};
  /* clicking anywhere outside the picker closes it, including the comment box */
  panel.addEventListener('click',e=>{
    if(!gifPicker.classList.contains('show'))return;
    const p=e.composedPath();
    if(p.includes(gifPicker)||p.includes(gifBtn))return;
    closeGifs();
  },true);
  textEl.addEventListener('focus',closeGifs);
  gifQ.addEventListener('input',()=>{
    clearTimeout(gifTimer);
    gifTimer=setTimeout(()=>gifSearch(gifQ.value.trim()),320);
  });
  gifQ.addEventListener('keydown',e=>{if(e.key==='Escape'){closeGifs();textEl.focus();}});

  /* ================= send (optimistic) ================= */
  /* quote markup for a message that hasn't been saved yet */
  function optimisticQuote(pid){
    const p=(cache[ctx]||[]).find(r=>r.id==pid);
    if(!p)return '';
    const ta=document.createElement('textarea');ta.innerHTML=p.content;
    let txt=ta.value.replace(/\[img\][^\[]*\[\/img\]/g,' <i>[image]</i> ').replace(/\[pin\][^\[]*\[\/pin\]/g,' <i>[pin]</i> ').replace(/\[meta\][^\[]*\[\/meta\]/g,'').trim()||'<i>[image]</i>';
    return `<button class="quote" data-goto="${p.id}">
      <span class="qmeta"><span class="qname">${nameOf(p)}</span>
      <span class="qtime">${timeAgo(p.created_at)}</span></span>
      <span class="qtext">${txt}</span></button>`;
  }

  function send(){
    if(!ME)return;
    let c=textEl.value.trim();
    if(pendingImgs.length)c=(c?c+'\n':'')+pendingImgs.map(u=>'[img]'+u+'[/img]').join('\n');
    if(pendingPin)c=(c?c+'\n':'')+pinTok(pendingPin);
    if(!c){textEl.focus();return;}
    c+='\n[meta]'+b64e(JSON.stringify(metaNow()))+'[/meta]';
    const pid=parentId;

    const sendBtn=$('.send');
    sendBtn.classList.remove('pop');void sendBtn.offsetWidth;sendBtn.classList.add('pop');
    const empty=list.querySelector('.empty');if(empty)empty.remove();
    lastSig=null;                       /* optimistic bubble is not in the data yet */
    const el=document.createElement('div');
    el.className='item anim'+(pid?' reply':'');   /* reply only marks the quote */
    el.dataset.id='tmp';el.dataset.parent=pid;
    const myAv=meAvatar();
    el.innerHTML=`<div class="avatar" style="${myAv?`background-image:url('${myAv}');background-size:cover;background-position:center;color:transparent`:`background:${meColor()};color:${hexOk(ME.color)?inkOn(ME.color):'#101012'}`}">${escHtml(ME.name[0].toUpperCase())}</div>
      <div class="itembody">
        ${pid?optimisticQuote(pid):''}
        <div class="meta"><span class="author${namecolor2?' grad':''}" style="${namecolor?'--nc:'+namecolor+';color:'+namecolor+';':''}${namecolor2?'--nc2:'+namecolor2+';':''}">${escHtml(ME.name)}</span><span class="time">just now</span></div>
        <div class="content">${rich(escHtml(c))}</div>
      </div>`;
    list.appendChild(el);   /* newest last, replies included */
    el.scrollIntoView({block:'end',behavior:'smooth'});

    textEl.value='';autoGrow();cancelReply();textEl.focus();
    wasTyping=false;sentAt=Date.now(); /* dc_post clears our typing entry server-side */
    pendingImgs=[];clearPin();chipsBox.innerHTML='';syncChips();
    localStorage.removeItem(draftKey());
    mutate('dc_post',{content:c,parent_id:pid}).then(j=>{
      if(j.success&&j.data&&j.data.id){el.dataset.id=j.data.id;}
      if(!j.success){el.remove();textEl.value=c;if(!(j.data&&j.data.code==='auth'))alert((j.data&&j.data.msg)||'Could not post.');}
      /* kill any typing ping that raced past dc_post's clear */
      if(ME)api('dc_typing',{stop:1});
    });
  }
  $('.send').onclick=send;
  /* touch keyboards: Return adds a line, the send button sends */
  const coarse=matchMedia('(pointer:coarse)');
  textEl.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!(coarse.matches&&!e.ctrlKey&&!e.metaKey)){e.preventDefault();send();}});
  textEl.setAttribute('enterkeyhint',coarse.matches?'enter':'send');

  /* ================= real-time: long-poll with piggybacked payload ================= */
  let version=null;
  function longPoll(){
    const b=new URLSearchParams({action:'dc_poll',nonce:NONCE,v:version||''});
    fetch(AJAX,{method:'POST',body:b}).then(r=>r.json()).then(j=>{
      if(j&&j.success){
        if(version!==null&&j.data.v!==version&&j.data.data&&!inflight){
          ++getSeq;             /* invalidate any in-flight dc_all */
          applyData(j.data.data);
        }
        version=j.data.v;
        setTimeout(longPoll,30);
      }else{setTimeout(longPoll,3000);}
    }).catch(()=>setTimeout(longPoll,3000));
  }

  /* ================= TaskFlow: Tasks, Go Live, Review =================
     Everything here talks to TaskFlow's own tables through its REST API as
     the signed-in person, so TaskFlow's row-level security is the only
     gatekeeper and nothing new is needed on the TaskFlow side. Lists refresh
     when the panel opens, every 45s while it's open, and after every change. */
  const TFS={team:null,members:[],tasks:null,done:null,extra:{},tried:new Set(),golive:null,
    glHidden:new Set(),reviews:null,defaults:null,queue:null,err:{},busy:{},at:0};
  let view='comments';
  /* team-wide, like the TaskFlow app; the page only seeds new items and is
     linked on every card */
  const tv={scope:'all',status:'active',q:'',open:null,form:null};
  const gv={adding:null,editing:null,showLive:false,showHidden:false};
  const rv={filter:null,submit:null,note:null};   /* null: picked on first paint */
  const tfView=$('.tfview'), tfBar=$('.tfbar'), tfBody=$('.tfscroll'), railEl=$('.rail');
  const VIEW_TITLES={tasks:'Tasks',golive:'Go Live',review:'Ready for review'};
  const HERE_URL=ORIGIN+location.pathname+(PAGE.indexOf('/wp-admin:')===0?location.search:'');
  const ICO={
    plus:'<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    back:'<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>',
    ext:'<svg viewBox="0 0 24 24"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>',
    check:'<svg viewBox="0 0 24 24"><path d="m5 13 4 4L19 7"/></svg>',
    search:'<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
    cal:'<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    list:'<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg>',
    chat:'<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
    users:'<svg viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
  };

  function viewTitle(){
    if(view!=='comments')return VIEW_TITLES[view];
    if(typeof notifView!=='undefined'&&notifView)return 'Notifications';
    if(typeof pagesView!=='undefined'&&pagesView)return 'All pages';
    return ctx==='page'?pageLabel():'All pages';
  }

  /* ---- pages: a task's "page" may be a full URL (dev or live), a path, or
     free text. Anything with a path is matched on the path alone, so a task
     filed against the live site still shows on the same dev page. ---- */
  function pathKey(v){
    let s=String(v||'').trim();if(!s)return '';
    if(!/^https?:\/\//i.test(s)){
      if(s[0]==='/')s=ORIGIN+s;
      else if(/^[\w-]+(\.[\w-]+)+(\/|$)/.test(s))s='https://'+s;
      else return '#'+s.toLowerCase();          /* free text never matches a path */
    }
    try{const u=new URL(s);return (decodeURIComponent(u.pathname).replace(/\/+$/,'')||'/').toLowerCase();}
    catch(e){return '#'+s.toLowerCase();}
  }
  const HERE=pathKey(location.pathname);
  const onPage=v=>pathKey(v)===HERE;
  const pageHrefOf=v=>{const s=String(v||'').trim();return /^https?:\/\//i.test(s)?s:s[0]==='/'?ORIGIN+s:'';};
  function shortPage(v){
    const s=String(v||'').trim();
    if(!/^https?:\/\//i.test(s))return s||'No page';
    try{const u=new URL(s);const p=decodeURIComponent(u.pathname).replace(/\/+$/,'')||'/';
      return u.host===location.host?p:u.host.replace(/^www\./,'')+(p==='/'?'':p);}catch(e){return s;}
  }
  const pageLink=v=>{
    const h=pageHrefOf(v);
    return h?`<a class="tfpage" href="${escHtml(h)}" target="_blank" rel="noopener" title="${escHtml(v)}">${escHtml(shortPage(v))}</a>`
            :`<span class="tfpage" title="${escHtml(v||'')}">${escHtml(shortPage(v))}</span>`;
  };

  /* ---- rich text: TaskFlow stores task descriptions as HTML. It is rebuilt
     here from an allow-list (parsed in an inert document, so nothing in it
     can run) rather than trusted. ---- */
  const SAFE_TAGS=['b','strong','i','em','u','s','strike','code','pre','p','div','span','ul','ol','li','h1','h2','h3','h4','blockquote'];
  function safeHtml(html){
    if(!html)return '';
    const doc=new DOMParser().parseFromString(String(html),'text/html');
    const walk=n=>{
      let out='';
      n.childNodes.forEach(c=>{
        if(c.nodeType===3){out+=escHtml(c.nodeValue);return;}
        if(c.nodeType!==1)return;
        const t=c.tagName.toLowerCase();
        if(t==='br'||t==='hr'){out+='<'+t+'>';return;}
        if(t==='img'){const src=c.getAttribute('src')||'';
          if(/^https:\/\//i.test(src))out+=`<img src="${escHtml(src)}" data-lb="${escHtml(src)}" loading="lazy" alt="">`;return;}
        if(t==='a'){const h=c.getAttribute('href')||'';
          out+=/^https?:\/\//i.test(h)?`<a href="${escHtml(h)}" target="_blank" rel="noopener">${walk(c)}</a>`:walk(c);return;}
        if(t==='script'||t==='style'||t==='iframe')return;
        out+=SAFE_TAGS.includes(t)?`<${t}>${walk(c)}</${t}>`:walk(c);
      });
      return out;
    };
    return walk(doc.body);
  }
  function htmlText(h){
    const src=String(h||'').replace(/<br\s*\/?>/gi,'\n').replace(/<\/(p|div|li|h\d|blockquote)>/gi,'$&\n');
    const d=new DOMParser().parseFromString(src,'text/html');
    return (d.body.textContent||'').replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
  }
  /* same conversion TaskFlow uses for a deep-linked comment: escape, keep breaks */
  const plainToHtml=t=>String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').split(/\r?\n/).join('<br>');
  const clip=(s,n)=>s.length>n?s.slice(0,n-1).trimEnd()+'…':s;
  /* "5m ago", or the clock time when that's the chosen format */
  const ago=s=>{if(!s)return '';const x=timeAgo(String(s));return timefmt==='clock'||x==='just now'?x:x+' ago';};
  const cssUrl=u=>String(u).replace(/["'()\\\s]/g,c=>'%'+c.charCodeAt(0).toString(16).padStart(2,'0'));
  const newSubId=()=>'st_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);
  const asSubs=v=>Array.isArray(v)?v.filter(s=>s&&typeof s==='object').map(s=>({id:s.id||newSubId(),text:String(s.text==null?'':s.text),done:!!s.done})):[];
  /* checked items sink, the same stable order TaskFlow keeps */
  const sortSubs=l=>[...l.filter(s=>!s.done),...l.filter(s=>s.done)];
  const attsOf=t=>Array.isArray(t.attachments)&&t.attachments.length?t.attachments.filter(a=>a&&a.url)
    :(t.png_url?[{url:t.png_url,name:'screenshot.png',kind:'image'}]:[]);
  const isImgAtt=a=>a.kind==='image'||/\.(png|jpe?g|gif|webp|avif)(\?|$)/i.test(a.url||'');
  const attHtml=a=>isImgAtt(a)
    ?`<img src="${escHtml(a.url)}" data-lb="${escHtml(a.url)}" alt="${escHtml(a.name||'')}" loading="lazy">`
    :`<a class="tffile" href="${escHtml(a.url)}" target="_blank" rel="noopener">${escHtml(a.name||'File')}</a>`;

  /* ---- people ---- */
  const fullName=p=>p?(`${p.first_name||''} ${p.last_name||''}`.trim()||'Someone'):'Someone';
  const tfMember=id=>id?TFS.members.find(m=>m.id===id)||null:null;
  function tfAva(p,size){
    if(!p)return '';
    size=size||20;
    const nm=fullName(p), c=hexOk(p.color)?p.color:color(nm);
    const look=p.avatar_url&&/^https:\/\//i.test(p.avatar_url)
      ?`background-image:url('${cssUrl(p.avatar_url)}');color:transparent;`
      :`background:${c};color:${hexOk(c)?inkOn(c):'#101012'};`;
    return `<span class="tfava" title="${escHtml(nm)}" style="width:${size}px;height:${size}px;font-size:${Math.round(size*.44)}px;${look}">${p.avatar_url?'':escHtml((nm[0]||'?').toUpperCase())}</span>`;
  }
  const myTeam=()=>((ME&&ME.teams)||[]).find(t=>t.id===TFS.team)||null;
  const teamAdmin=()=>{const t=myTeam();return !!t&&(t.role==='owner'||t.role==='admin');};

  /* ---- tasks ---- */
  const ST={open:{l:'Open',v:'--st-open'},in_progress:{l:'In progress',v:'--st-inprogress'},
            on_hold:{l:'On hold',v:'--st-onhold'},completed:{l:'Completed',v:'--st-completed'}};
  const ST_ORDER=['in_progress','open','on_hold'];
  const TASK_SEL='id,team_id,status,page,feedback,noticed_by,roi,complexity,attachments,png_url,subtasks,assignee_id,due_date,date_received,date_completed,completed_by,created_by,updated_at';
  function tfTaskById(id){
    if(!id)return null;
    return (TFS.tasks||[]).find(t=>t.id===id)||(TFS.done||[]).find(t=>t.id===id)||TFS.extra[id]||null;
  }
  function tfTaskStatus(id){const t=tfTaskById(id);return t?t.status:'';}
  function taskChip(r){
    if(!r.task_id||!TF_READY||!ME)return '';
    const t=tfTaskById(r.task_id), st=t&&ST[t.status];
    return `<button class="taskchip" data-taskid="${escHtml(r.task_id)}"${st?` style="--c:var(${st.v})"`:''}>`
      +(st?`<i></i>Task · ${st.l}`:`${ICO.check.replace('<svg','<svg aria-hidden="true"')}TaskFlow task`)+'</button>';
  }
  function dueInfo(d,status){
    if(!d)return null;
    const [y,m,dd]=String(d).split('-').map(Number);if(!y)return null;
    const due=new Date(y,m-1,dd), today=new Date();today.setHours(0,0,0,0);
    const days=Math.round((due-today)/864e5);
    const lbl=due.toLocaleDateString([],{month:'short',day:'numeric'});
    if(status==='completed')return {l:'Due '+lbl,late:false};
    if(days<0)return {l:'Overdue · '+lbl,late:true};
    if(days===0)return {l:'Due today',late:true};
    if(days===1)return {l:'Due tomorrow',late:false};
    return {l:'Due '+lbl,late:false};
  }
  const linkedComments=id=>allRows().filter(r=>r.task_id===id);

  /* ================= data ================= */
  const missing=what=>({golive:'Go Live isn’t set up in this TaskFlow yet (supabase-golive-migration.sql).',
    reviews:'Review isn’t set up in this TaskFlow yet (supabase-review-migration.sql).'}[what]);
  async function tfLoad(what){
    const t=TFS.team;if(!t||!ME)return;
    TFS.busy[what]=true;
    try{
      if(what==='members'){
        const r=await TF.rest(`team_members?select=user_id,role,profiles(id,first_name,last_name,color,avatar_url)&team_id=eq.${t}&order=joined_at`);
        TFS.members=(r||[]).filter(x=>x.profiles).map(x=>({...x.profiles,role:x.role}));
      }else if(what==='tasks'){
        TFS.tasks=await TF.rest(`tasks?select=${TASK_SEL}&team_id=eq.${t}&status=neq.completed&order=date_received.desc&limit=500`)||[];
      }else if(what==='queue'){
        TFS.queue=await TF.rest(`queue?select=id,task_id,position&team_id=eq.${t}&order=position`)||[];
      }else if(what==='done'){
        TFS.done=await TF.rest(`tasks?select=${TASK_SEL}&team_id=eq.${t}&status=eq.completed&order=date_completed.desc.nullslast&limit=100`)||[];
      }else if(what==='golive'){
        const [items,hid]=await Promise.all([
          TF.rest(`golive_items?select=*&team_id=eq.${t}&order=created_at.desc&limit=400`),
          TF.rest('golive_hidden?select=item_id').catch(()=>[])]);
        TFS.golive=items||[];TFS.glHidden=new Set((hid||[]).map(h=>h.item_id));
      }else if(what==='reviews'){
        const [posts,revs,cms]=await Promise.all([
          TF.rest(`review_posts?select=*&team_id=eq.${t}&status=neq.live&order=position.asc.nullsfirst,updated_at.desc`),
          TF.rest(`review_reviewers?select=post_id,user_id&team_id=eq.${t}`),
          TF.rest(`review_comments?select=post_id&team_id=eq.${t}`).catch(()=>[])]);
        const by={}, nc={};
        (revs||[]).forEach(r=>(by[r.post_id]=by[r.post_id]||[]).push(r.user_id));
        (cms||[]).forEach(c=>{nc[c.post_id]=(nc[c.post_id]||0)+1;});
        TFS.reviews=(posts||[]).map(p=>({...p,reviewers:by[p.id]||[],ncomments:nc[p.id]||0}));
      }
      TFS.err[what]='';
    }catch(e){
      TFS.err[what]=(e.status===404||/does not exist|schema cache|relation/i.test(e.message||''))&&missing(what)
        ?missing(what):(e.message||'Could not reach TaskFlow.');
    }finally{TFS.busy[what]=false;}
  }
  let tfLoading=null;
  function tfLoadAll(){
    if(!ME||!TFS.team)return Promise.resolve();
    if(tfLoading)return tfLoading;
    TFS.at=Date.now();
    const jobs=['members','tasks','queue','golive','reviews'];
    if(TFS.done!==null||tv.status==='done')jobs.push('done');
    tfLoading=Promise.all(jobs.map(tfLoad)).then(tfLinkedSync).then(tfAfterData).finally(()=>{tfLoading=null;});
    return tfLoading;
  }
  /* tasks linked from comments that aren't in the open list (completed, or
     another team's) are fetched one batch at a time so their chips are right */
  async function tfLinkedSync(){
    if(!ME||!TF_READY)return;
    const want=[...new Set(allRows().map(r=>r.task_id).filter(Boolean))]
      .filter(id=>!tfTaskById(id)&&!TFS.tried.has(id)).slice(0,60);
    if(!want.length)return;
    want.forEach(id=>TFS.tried.add(id));
    try{
      const r=await TF.rest(`tasks?select=${TASK_SEL}&id=in.(${want.join(',')})`);
      (r||[]).forEach(t=>{TFS.extra[t.id]=t;});
      if(r&&r.length&&view==='comments'&&cache[ctx])render(cache[ctx]);
    }catch(e){}
  }
  /* repaint after a refresh, unless someone is mid-way through a form */
  function editing(){
    const a=root.activeElement;
    return !!tv.form||!!gv.adding||!!gv.editing||!!rv.submit||!!rv.note
      ||!!(a&&tfBody.contains(a)&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  }
  function tfAfterData(){
    railBadges();renderFocus();
    if(view!=='comments'&&!editing())renderTf(false);
    if(view==='review'&&rv.open&&!editing())rvLoadThread(rv.open);
    if(view==='comments'&&cache[ctx])render(cache[ctx]);   /* task chips; no-op when unchanged */
    if(panel.classList.contains('settings-open'))paintAccount();
  }
  function railBadges(){
    if(!railEl)return;
    const set=(v,n,tip,warn)=>{
      const b=railEl.querySelector(`[data-view="${v}"]`);if(!b)return;
      const d=b.querySelector('.rdot');
      d.textContent=n>99?'99+':String(n);d.classList.toggle('zero',!n);d.classList.toggle('warn',!!warn);
      b.dataset.tip=tip;
    };
    const uc=ME?unread('page')+unread('general'):0;
    set('comments',uc,uc?`Focus & comments · ${uc} new`:'Focus & comments');
    if(!ME)return;
    const tp=(TFS.tasks||[]).filter(t=>t.assignee_id===ME.sb_uid).length;
    set('tasks',tp,tp?`Tasks · ${tp} assigned to you`:'Tasks');
    const gp=(TFS.golive||[]).filter(i=>i.status!=='live'&&!TFS.glHidden.has(i.id)).length;
    set('golive',gp,gp?`Go Live · ${gp} waiting`:'Go Live');
    const mine=(TFS.reviews||[]).filter(p=>p.status==='pending'&&p.reviewers.includes(ME.sb_uid)).length;
    set('review',mine,mine?`Review · ${mine} waiting on you`:'Review',mine>0);
  }

  async function tfAfterLogin(){
    if(!ME||!ME.sb_uid||!TF_READY)return;
    let prefs=null;
    try{const r=await TF.rest(`user_preferences?select=theme_colors,active_team_id&id=eq.${ME.sb_uid}`);prefs=r&&r[0];}catch(e){}
    if(!ME)return;
    if(prefs&&prefs.theme_colors&&typeof prefs.theme_colors==='object'){
      tfColors=prefs.theme_colors;
      try{localStorage.setItem('dc_tf_look',JSON.stringify(tfColors));}catch(e){}
    }
    applyLook();
    /* TaskFlow's text size is the default until the panel has its own */
    if(!(ME.settings&&ME.settings.scale))applyScale(Math.round((LOOK.fontScale||1)*10)*10);
    const teams=ME.teams||[];
    let saved='';try{saved=localStorage.getItem('dc_tf_team_'+ME.sb_uid)||'';}catch(e){}
    TFS.team=TEAM_LOCK||[saved,prefs&&prefs.active_team_id].find(id=>id&&teams.some(t=>t.id===id))||(teams[0]&&teams[0].id)||null;
    paintAccount();
    gLoad();
    scanConnect();
    await tfLoadAll();
    let v='';try{v=localStorage.getItem('dc_view')||'';}catch(e){}
    if(v&&v!=='comments'&&view==='comments'&&VIEW_TITLES[v])switchView(v,true);
  }
  function tfSwitchTeam(id){
    if(!id||id===TFS.team||!ME)return;
    TFS.team=id;
    try{localStorage.setItem('dc_tf_team_'+ME.sb_uid,id);}catch(e){}
    Object.assign(TFS,{members:[],tasks:null,done:null,golive:null,reviews:null,defaults:null,queue:null,err:{}});rv.filter=null;
    tv.open=tv.form=null;gv.adding=gv.editing=null;rv.submit=rv.note=rv.open=rv.thread=null;
    renderTf(true);tfLoadAll();gLoad();
  }
  function tfReset(){
    Object.assign(TFS,{team:null,members:[],tasks:null,done:null,extra:{},golive:null,reviews:null,defaults:null,queue:null,err:{},at:0});
    TFS.tried=new Set();TFS.glHidden=new Set();
    tv.open=tv.form=null;gv.adding=gv.editing=null;rv.submit=rv.note=rv.open=rv.thread=null;
    if(view!=='comments')switchView('comments',true);
    railBadges();
    scanClose();
    if(typeof gReset==='function')gReset();
    if(typeof renderFocus==='function')renderFocus();
  }

  /* ================= views ================= */
  function switchView(v,quiet){
    if(v!=='comments'&&(!ME||!TF_READY))v='comments';
    const was=view;view=v;
    panel.classList.toggle('tf-open',v!=='comments');
    railEl.querySelectorAll('.rbtn[data-view]').forEach(b=>b.classList.toggle('on',b.dataset.view===v));
    closeSettings();
    if(typeof closePinPop==='function')closePinPop();
    sub.textContent=viewTitle();
    if(v==='comments'){
      renderFocus();
      lastSig=null;
      if(cache[ctx])render(cache[ctx],was!=='comments');
      if(!quiet)viewIn();
    }else{
      tfBar.dataset.sig='';
      renderTf(true);
      if(Date.now()-TFS.at>20000)tfLoadAll();
    }
    if(!quiet)try{localStorage.setItem('dc_view',v);}catch(e){}
  }
  railEl.querySelectorAll('.rbtn[data-view]').forEach(b=>b.onclick=()=>{
    const v=b.dataset.view;
    if(v===view&&!panel.classList.contains('settings-open')){
      /* tapping the current view again backs out of a task or form */
      if(v==='tasks'&&(tv.open||tv.form)){tv.open=tv.form=null;renderTf(true);}
      if(v==='review'&&rv.open){rv.open=rv.thread=rv.note=null;renderTf(true);}
      return;
    }
    switchView(v);
  });
  $('.ropen').href=TF_APP?TF_APP+'/dashboard':'#';
  if(!TF_APP)$('.ropen').style.display='none';

  function setBar(html,sig){
    if(tfBar.dataset.sig===sig)return false;
    tfBar.dataset.sig=sig;tfBar.innerHTML=html;return true;
  }
  function setBody(html,animate){
    const keep=animate?0:tfBody.scrollTop;
    tfBody.classList.toggle('calm',!animate);
    tfBody.innerHTML=html;
    tfBody.scrollTop=keep;
  }
  const spinner='<div class="tfspin" role="status" aria-label="Loading"></div>';
  const errBox=m=>`<div class="tferr">${escHtml(m)}</div>`;
  const seg=(key,opts,cur)=>`<div class="tfseg" data-seg="${key}">`
    +opts.map(([v,l,n])=>`<button data-v="${v}" class="${cur===v?'sel':''}">${l}${n!=null?`<i>${n}</i>`:''}</button>`).join('')+'</div>';
  function renderTf(animate){
    if(view==='comments')return;
    if(!ME){setBar('','x');setBody('');return;}
    if(!TFS.team){
      setBar('','noteam');
      setBody(`<div class="tfgate">${ICO.users}<br>Your TaskFlow account isn’t in a team yet.<br>
        ${TF_APP?`<a class="tfbtn pri" style="margin-top:14px" href="${TF_APP}/onboarding" target="_blank" rel="noopener">Create or join a team</a>`:''}</div>`,true);
      return;
    }
    ({tasks:renderTasks,golive:renderGoLive,review:renderReview})[view](animate);
    if(animate){tfBody.classList.remove('swap');void tfBody.offsetWidth;tfBody.classList.add('swap');}
  }

  /* ---------- Tasks ---------- */
  function taskMatches(t){
    if(tv.scope==='mine'&&t.assignee_id!==ME.sb_uid&&t.created_by!==ME.sb_uid)return false;
    if(tv.q){
      const q=tv.q.toLowerCase();
      if(![htmlText(t.feedback),t.page,t.noticed_by].join(' ').toLowerCase().includes(q))return false;
    }
    return true;
  }
  function taskRow(t,i){
    const st=ST[t.status]||ST.open, m=tfMember(t.assignee_id), subs=asSubs(t.subtasks),
          sd=subs.filter(s=>s.done).length, due=dueInfo(t.due_date,t.status), lc=linkedComments(t.id).length,
          txt=clip(htmlText(t.feedback),240);
    return `<div class="tfcard${t.status==='completed'?' done':''}" data-task="${t.id}" tabindex="0" style="--c:var(${st.v});animation-delay:${Math.min(i,10)*25}ms">
      <button class="tfchk" data-complete="${t.id}" title="${t.status==='completed'?'Reopen':'Mark complete'}" aria-label="${t.status==='completed'?'Reopen task':'Mark task complete'}">${ICO.check}</button>
      <div class="tfc-main">
        <div class="tfc-txt">${txt?escHtml(txt):'<i>No description</i>'}</div>
        <div class="tfmeta">
          <span class="tfst"><i></i>${st.l}</span>
          <span class="tfpill r-${escHtml(t.roi||'medium')}">${escHtml(t.roi||'medium')}</span>
          ${t.page?pageLink(t.page):''}${onPage(t.page)?'<span class="tfhere">This page</span>':''}
          ${subs.length?`<span class="tfprog" title="Checklist"><b style="--p:${Math.round(sd/subs.length*100)}%"></b>${sd}/${subs.length}</span>`:''}
          ${due?`<span class="tfdue${due.late?' late':''}">${due.l}</span>`:''}
          ${lc?`<span title="Linked comments">${ICO.chat} ${lc}</span>`:''}
          <span class="tfflex"></span>${tfAva(m,20)}
        </div>
      </div></div>`;
  }
  function renderTasks(animate){
    if(tv.form)return renderTaskForm(animate);
    if(tv.open)return renderTaskDetail(animate);
    const act=TFS.tasks||[];
    if(setBar(`${seg('scope',[['all','All'],['mine','Mine']],tv.scope)}
        <span class="tfgrow"></span>
        <button class="tfbtn pri" data-act="newtask">${ICO.plus}New task</button>
        <div class="tfrow" style="width:100%">
          <label class="tfsearch">${ICO.search}<input class="tfq" type="text" placeholder="Search tasks" autocomplete="off" value="${escHtml(tv.q)}"></label>
          ${seg('status',[['active','Active'],['done','Done']],tv.status)}
        </div>`,'tasks|'+tv.scope+'|'+tv.status)){
      tfBar.querySelector('.tfq').oninput=e=>{tv.q=e.target.value.trim();renderTasks(false);};
    }
    if(tv.status==='done'&&TFS.done===null){
      setBody(TFS.err.done?errBox(TFS.err.done):spinner,animate);
      if(!TFS.busy.done&&!TFS.err.done)tfLoad('done').then(()=>{if(view==='tasks')renderTasks(false);});
      return;
    }
    if(TFS.tasks===null){setBody(TFS.err.tasks?errBox(TFS.err.tasks):spinner,animate);return;}
    const rows=(tv.status==='done'?TFS.done:act).filter(taskMatches);
    let h=TFS.err.tasks?errBox(TFS.err.tasks):'';
    if(!rows.length){
      h+=`<div class="empty">${ICO.list.replace('<svg','<svg fill="none" stroke-width="1.6"')}
        ${tv.q?'No tasks match that search.':tv.status==='done'?'Nothing completed yet.':tv.scope==='mine'?'Nothing assigned to you.':'No open tasks. Nice.'}
        ${tv.status==='active'&&!tv.q?`<button class="tfbtn pri" data-act="newtask">${ICO.plus}New task</button>`:''}</div>`;
    }else if(tv.status==='done'){
      h+=rows.map(taskRow).join('');
    }else{
      let i=0;
      ST_ORDER.forEach(k=>{
        const g=rows.filter(t=>t.status===k);if(!g.length)return;
        h+=`<div class="tfgh" style="--c:var(${ST[k].v})"><i></i>${ST[k].l} <b>${g.length}</b></div>`+g.map(t=>taskRow(t,i++)).join('');
      });
    }
    setBody(h,animate);
  }
  function renderTaskDetail(animate){
    const id=tv.open, t=tfTaskById(id);
    setBar(`<button class="tfbtn ghost sm" data-act="back">${ICO.back}Tasks</button><span class="tfgrow"></span>
      ${TF_APP?`<a class="tfbtn sm" href="${TF_APP}/tasks/${encodeURIComponent(id)}" target="_blank" rel="noopener">Open in TaskFlow ${ICO.ext}</a>`:''}`,'tdetail|'+id);
    if(!t){
      if(TFS.extra[id]===false){
        setBody(`<div class="tfgate">This task isn’t in TaskFlow any more, or it belongs to a team you’re not in.
          ${linkedComments(id).length?`<br><button class="tfbtn sm" style="margin-top:14px" data-act="unlink">Unlink it from the comments</button>`:''}</div>`,animate);
        return;
      }
      setBody(spinner,animate);
      TF.rest(`tasks?select=${TASK_SEL}&id=eq.${encodeURIComponent(id)}`).then(r=>{
        TFS.extra[id]=(r&&r[0])||false;
        if(view==='tasks'&&tv.open===id)renderTaskDetail(false);
      }).catch(()=>{TFS.extra[id]=false;if(view==='tasks'&&tv.open===id)renderTaskDetail(false);});
      return;
    }
    const subs=sortSubs(asSubs(t.subtasks)), sd=subs.filter(s=>s.done).length, atts=attsOf(t), lc=linkedComments(id);
    const opt=(list,cur)=>list.map(v=>`<option value="${v}"${v===cur?' selected':''}>${v[0].toUpperCase()+v.slice(1)}</option>`).join('');
    const foreign=!!(t.team_id&&TFS.team&&t.team_id!==TFS.team);
    setBody(`
      ${seg('tstatus',['open','in_progress','on_hold','completed'].map(k=>[k,ST[k].l]),t.status).replace('class="tfseg"','class="tfseg full"')}
      <div class="tfd-fb" style="margin-top:16px">${safeHtml(t.feedback)||'<span class="tfnote">No description.</span>'}</div>
      <div class="tfd-line">
        ${pageLink(t.page)}
        ${t.noticed_by?`<span>Noticed by <b>${escHtml(t.noticed_by)}</b></span>`:''}
        ${t.date_received?`<span>${ago(t.date_received)}</span>`:''}
        ${t.status==='completed'&&t.completed_by?`<span>Completed by <b>${escHtml(t.completed_by)}</b></span>`:''}
      </div>
      ${foreign?'<div class="tfnote" style="margin-top:10px">This task is outside the team you’re viewing.</div>':''}
      <div class="tfd-sec"><div class="tfgrid">
        <label><span class="tflabel">ROI</span><select class="tfin" data-tfield="roi">${opt(['critical','high','medium','low'],t.roi)}</select></label>
        <label><span class="tflabel">Complexity</span><select class="tfin" data-tfield="complexity">${opt(['high','medium','low'],t.complexity)}</select></label>
        <label><span class="tflabel">Assignee</span><select class="tfin" data-tfield="assignee_id"><option value="">Unassigned</option>
          ${TFS.members.map(m=>`<option value="${m.id}"${m.id===t.assignee_id?' selected':''}>${escHtml(fullName(m))}</option>`).join('')}</select></label>
        <label><span class="tflabel">Due date</span><input class="tfin" type="date" data-tfield="due_date" value="${escHtml(t.due_date||'')}"></label>
      </div></div>
      <div class="tfd-sec"><h5><span>Checklist</span>${subs.length?`${sd}/${subs.length}`:''}</h5>
        ${subs.map(s=>`<div class="tfsub${s.done?' on':''}"><button class="tfbox" data-subtoggle="${escHtml(s.id)}" aria-label="${s.done?'Untick':'Tick'} ${escHtml(s.text)}">${ICO.check}</button>
          <span>${escHtml(s.text)||'<i>(untitled)</i>'}</span><button class="tfx" data-subdel="${escHtml(s.id)}" aria-label="Remove">✕</button></div>`).join('')}
        <div class="tfrow" style="margin-top:8px"><input class="tfin tfgrow tfsubnew" type="text" placeholder="Add an item…" autocomplete="off">
          <button class="tfbtn sm" data-act="subadd">Add</button></div>
      </div>
      ${atts.length?`<div class="tfd-sec"><h5><span>Attachments</span>${atts.length}</h5><div class="tfatt">${atts.map(attHtml).join('')}</div></div>`:''}
      ${lc.length?`<div class="tfd-sec"><h5><span>From comments</span>${lc.length}</h5>${lc.map(r=>{
        const ta=document.createElement('textarea');ta.innerHTML=r.content;
        const txt=stripTok(ta.value).replace(/\[img\][^\[]*\[\/img\]/g,' [image] ').replace(/\s+/g,' ').trim()||'[image]';
        return `<button class="tflinked" data-gocomment="${r.id}" data-ctx="${escHtml(r.context)}">
          <span class="avatar" style="width:24px;height:24px;font-size:10.5px;${avatarStyle(r.user_id,nameOf(r))}">${escHtml(nameOf(r)[0].toUpperCase())}</span>
          <span><b>${escHtml(nameOf(r))} · ${escHtml(ctxLabel(r.context))}</b>${escHtml(clip(txt,160))}</span></button>`;}).join('')}</div>`:''}
      <div class="tfd-sec tfrow">
        ${t.status!=='completed'&&!foreign?(inQueue(id)?`<button class="tfbtn sm" data-act="unqueue">Remove from queue</button>`
          :`<button class="tfbtn sm" data-act="queue">${ICO.plus}Add to queue</button>`):''}
        <button class="tfbtn sm bad" data-act="deltask">Delete task</button>
        ${lc.length?'<button class="tfbtn sm ghost" data-act="unlink">Unlink from comments</button>':''}
      </div>`,animate);
  }
  function openTaskView(id){
    if(!ME||!TF_READY||!id)return;
    tv.form=null;tv.open=id;
    if(!isOpen)open();
    if(view!=='tasks')switchView('tasks');else{tfBar.dataset.sig='';renderTf(true);}
  }
  function openTaskForm(pre){
    if(!ME||!TF_READY)return;
    pre=pre||{};
    tv.open=null;
    tv.form={feedback:pre.feedback||'',page:pre.page||HERE_URL,noticed:pre.noticed||ME.name,
      roi:'medium',complexity:'medium',assignee:'',due:'',checklist:'',queue:!!pre.queue,
      atts:(pre.attachments||[]).slice(0,10),link:(pre.link||[]).map(String),err:'',busy:false,up:0};
    if(!isOpen)open();
    if(view!=='tasks')switchView('tasks');else{tfBar.dataset.sig='';renderTf(true);}
    setTimeout(()=>{const f=tfBody.querySelector('[data-ff="feedback"]');if(f&&!pre.feedback)f.focus();},80);
  }
  function renderTaskForm(animate){
    const f=tv.form, team=myTeam();
    setBar(`<button class="tfbtn ghost sm" data-act="cancelform">${ICO.back}Tasks</button><span class="tfgrow"></span>
      ${team?`<span class="tfteam"><i></i>${escHtml(team.name)}</span>`:''}`,'tform');
    const segs=(key,list)=>`<div class="tfseg full" data-fseg="${key}">`
      +list.map(v=>`<button type="button" data-v="${v}" class="${f[key]===v?'sel':''}">${v[0].toUpperCase()+v.slice(1)}</button>`).join('')+'</div>';
    setBody(`<div class="tfform">
      <span class="tflabel">What needs doing?</span>
      <textarea class="tfin" data-ff="feedback" rows="5" placeholder="Describe the change or the problem…">${escHtml(f.feedback)}</textarea>
      <span class="tflabel">Page</span>
      <input class="tfin" data-ff="page" type="text" value="${escHtml(f.page)}">
      <span class="tflabel">Noticed by</span>
      <input class="tfin" data-ff="noticed" type="text" value="${escHtml(f.noticed)}">
      <span class="tflabel">ROI</span>${segs('roi',['critical','high','medium','low'])}
      <span class="tflabel">Complexity</span>${segs('complexity',['high','medium','low'])}
      <div class="tfgrid" style="margin-top:14px">
        <label><span class="tflabel">Assignee</span><select class="tfin" data-ff="assignee"><option value="">Unassigned</option>
          ${TFS.members.map(m=>`<option value="${m.id}"${m.id===f.assignee?' selected':''}>${escHtml(fullName(m))}</option>`).join('')}</select></label>
        <label><span class="tflabel">Due date</span><input class="tfin" type="date" data-ff="due" value="${escHtml(f.due)}"></label>
      </div>
      <span class="tflabel">Checklist <span class="tfnote">· optional, one item per line</span></span>
      <textarea class="tfin" data-ff="checklist" rows="3" placeholder="Check mobile layout&#10;Update copy">${escHtml(f.checklist)}</textarea>
      <span class="tflabel">Images</span>
      <div class="tfatt">${f.atts.map((u,i)=>`<span class="tfachip"><img src="${escHtml(u)}" data-lb="${escHtml(u)}" alt=""><button type="button" data-attdel="${i}" aria-label="Remove">✕</button></span>`).join('')}
        ${f.atts.length<10?`<button type="button" class="tfbtn sm" data-act="attadd"${f.up?' disabled':''}>${f.up?'Uploading…':ICO.plus+'Image'}</button>`:''}</div>
      <input class="tfattfile" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
      ${f.link.length?`<div class="tfnote" style="margin-top:12px">Linked to ${f.link.length} comment${f.link.length===1?'':'s'} — ${f.link.length===1?'it':'they'}’ll show this task’s status.</div>`:''}
      <label class="tflookrow" style="margin-top:14px"><span class="tfgrow">Add to the focus queue</span>
        <span class="tfswitch"><input type="checkbox" data-ffq${f.queue?' checked':''}><span></span></span></label>
      ${f.err?errBox(f.err):''}
      <div class="tfacts"><button type="button" class="tfbtn" data-act="cancelform">Cancel</button>
        <button type="button" class="tfbtn pri" data-act="createtask"${f.busy?' disabled':''}>${f.busy?'Creating…':'Create task'}</button></div>
    </div>`,animate);
  }
  async function createTask(){
    const f=tv.form;if(!f||f.busy)return;
    if(!f.feedback.trim()){f.err='Add a description first.';renderTaskForm(false);return;}
    f.busy=true;f.err='';renderTaskForm(false);
    const now=new Date().toISOString();
    const atts=f.atts.map(u=>({url:u,name:decodeURIComponent(u.split('/').pop().split('?')[0]||'image'),kind:'image'}));
    const payload={
      team_id:TFS.team,status:'open',page:(f.page.trim()||HERE_URL),feedback:plainToHtml(f.feedback.trim()),
      noticed_by:f.noticed.trim()||ME.name,roi:f.roi,complexity:f.complexity,
      assignee_id:f.assignee||null,due_date:f.due||null,
      subtasks:f.checklist.split('\n').map(x=>x.trim()).filter(Boolean).map(text=>({id:newSubId(),text,done:false})),
      attachments:atts,png_url:atts[0]?atts[0].url:null,
      date_received:now,updated_at:now,created_by:ME.sb_uid
    };
    try{
      const r=await TF.rest('tasks?select='+TASK_SEL,{method:'POST',body:payload,prefer:'return=representation'});
      const t=r&&r[0];if(!t)throw new Error('TaskFlow didn’t send the new task back.');
      (TFS.tasks=TFS.tasks||[]).unshift(t);
      awardCreated();bumpStreak();
      if(f.queue)await queueAdd(t.id,true);
      if(f.link.length){
        await api('dc_tasklink',{ids:f.link.join(','),task_id:t.id});
        allRows().forEach(c=>{if(f.link.includes(String(c.id)))c.task_id=t.id;});
        f.link.forEach(id=>api('dc_tasked',{id}));   /* lets each author know */
        lastSig=null;
      }
      tv.form=null;tv.open=t.id;
      renderTf(true);railBadges();
      toast('Task created in TaskFlow.');
    }catch(e){
      f.busy=false;f.err=e.message||'Could not create the task.';renderTaskForm(false);
    }
  }
  /* TaskFlow's own rules on a status change: completing drops it from the
     queue, and leaving "in progress" promotes the next queued task */
  async function promoteQueue(){
    try{
      const q=await TF.rest(`queue?select=id,task_id&team_id=eq.${TFS.team}&order=position&limit=1`);
      if(q&&q[0]){
        const now=new Date().toISOString();
        await Promise.all([
          TF.rest(`tasks?id=eq.${q[0].task_id}`,{method:'PATCH',body:{status:'in_progress',updated_at:now}}),
          TF.rest(`queue?id=eq.${q[0].id}`,{method:'DELETE'})]);
        await tfLoad('tasks');
      }
    }catch(e){}
  }
  /* after a change, a task sits in whichever list it now belongs to; one
     from another team (or a completed one with Done not loaded) waits in extra */
  function placeTask(t){
    TFS.tasks=(TFS.tasks||[]).filter(x=>x!==t);
    if(TFS.done)TFS.done=TFS.done.filter(x=>x!==t);
    const ours=t.team_id===TFS.team;
    if(ours&&t.status!=='completed'){
      delete TFS.extra[t.id];
      TFS.tasks.push(t);TFS.tasks.sort((a,b)=>String(b.date_received).localeCompare(String(a.date_received)));
    }else if(ours&&TFS.done){delete TFS.extra[t.id];TFS.done.unshift(t);}
    else TFS.extra[t.id]=t;
  }
  async function tfUpdateTask(id,patch){
    const t=tfTaskById(id);if(!t)return false;
    const before={...t}, now=new Date().toISOString(), p={...patch,updated_at:now};
    if(p.status==='completed'&&t.status!=='completed'){p.date_completed=now;p.completed_by=ME.name;}
    Object.assign(t,p);placeTask(t);
    railBadges();tfRepaint();
    try{
      await TF.rest(`tasks?id=eq.${encodeURIComponent(id)}`,{method:'PATCH',body:p});
      if(p.status&&p.status!==before.status){
        if(p.status==='completed'){awardCompleted(before);bumpStreak();
          if(TFS.queue)TFS.queue=TFS.queue.filter(q=>q.task_id!==id);}
        if(p.status==='completed')await TF.rest(`queue?task_id=eq.${encodeURIComponent(id)}`,{method:'DELETE'}).catch(()=>{});
        if(before.status==='in_progress'&&p.status!=='in_progress'){await promoteQueue();await tfLoad('queue');tfAfterData();}
        else if(p.status==='completed')renderFocus();
      }
      return true;
    }catch(e){
      Object.keys(p).forEach(k=>{t[k]=before[k];});placeTask(t);
      railBadges();tfRepaint();
      toast('Couldn’t save to TaskFlow: '+e.message);
      return false;
    }
  }
  function tfRepaint(){
    renderFocus();
    if(view!=='comments')renderTf(false);
    else if(cache[ctx])render(cache[ctx]);
  }
  function setTaskStatus(id,status){
    const t=tfTaskById(id);if(!t||t.status===status)return;
    const prev=t.status;
    tfUpdateTask(id,{status}).then(ok=>{
      if(ok)undoable(status==='completed'?'Task completed':'Moved to '+ST[status].l,()=>tfUpdateTask(id,{status:prev}));
    });
  }
  function setSubs(id,subs){
    const t=tfTaskById(id);if(!t)return;
    tfUpdateTask(id,{subtasks:sortSubs(subs).filter(s=>s.text.trim())});
  }
  function unlinkTask(id){
    const ids=linkedComments(id).map(r=>r.id);
    if(!ids.length)return;
    api('dc_tasklink',{ids:ids.join(','),task_id:''}).then(()=>{
      allRows().forEach(r=>{if(r.task_id===id)r.task_id='';});
      lastSig=null;renderTf(false);toast('Unlinked.');
    });
  }

  /* ---------- Go Live ---------- */
  function glList(live){
    return (TFS.golive||[]).filter(i=>(live?i.status==='live':i.status!=='live')
      &&(live||gv.showHidden||!TFS.glHidden.has(i.id)))
      .sort(live?(a,b)=>String(b.went_live_at||'').localeCompare(String(a.went_live_at||''))
        :(a,b)=>((a.position==null?1e9:a.position)-(b.position==null?1e9:b.position))||String(b.created_at).localeCompare(String(a.created_at)));
  }
  const glForm=(d,key,label)=>`<div class="tfform" data-glform="${key}">
      <span class="tflabel">Page</span><input class="tfin" data-gf="page" type="text" value="${escHtml(d.page)}" placeholder="Which page is this on?">
      <span class="tflabel">What changed</span><textarea class="tfin" data-gf="description" rows="3" placeholder="What has to go live">${escHtml(d.description)}</textarea>
      <span class="tflabel">Files to push <span class="tfnote">· one per line</span></span>
      <textarea class="tfin mono" data-gf="files" rows="3" placeholder="wp-content/themes/palmer/header.php">${escHtml(d.files)}</textarea>
      ${d.err?errBox(d.err):''}
      <div class="tfacts"><button class="tfbtn" data-act="glcancel">Cancel</button><button class="tfbtn pri" data-act="glsave"${d.busy?' disabled':''}>${label}</button></div>
    </div>`;
  function glCard(i,n,live){
    const a=tfMember(i.created_by), hid=TFS.glHidden.has(i.id);
    if(!live&&gv.editing&&gv.editing.id===i.id)return glForm(gv.editing,'edit','Save');
    return `<div class="tfcard static${live?' done':''}" data-gl="${i.id}" style="animation-delay:${Math.min(n,10)*25}ms">
      <div class="tfc-main">
        <div class="tfc-title">${pageLink(i.page)}${onPage(i.page)?' <span class="tfhere" style="font-size:11px">· This page</span>':''}</div>
        ${i.description?`<div class="tfc-desc">${escHtml(i.description)}</div>`:''}
        ${i.files?`<div class="tffiles">${escHtml(i.files)}</div>`:''}
        <div class="tfmeta">${tfAva(a,18)}<span>${escHtml(a?fullName(a):'Someone')}</span>
          <span>${live&&i.went_live_at?'Live '+ago(i.went_live_at):ago(i.created_at)}</span>${hid?'<span>Hidden for you</span>':''}</div>
        <div class="tfacts">${live
          ?`<button class="tfbtn sm" data-glundo="${i.id}">Undo — not live yet</button>`
          :`<button class="tfbtn sm ok" data-gllive="${i.id}">${ICO.check}Mark live</button>
            <button class="tfbtn sm ghost" data-gledit="${i.id}">Edit</button>
            <button class="tfbtn sm ghost" data-glhide="${i.id}">${hid?'Unhide':'Hide for me'}</button>
            <button class="tfbtn sm ghost bad" data-gldel="${i.id}">Delete</button>`}</div>
      </div></div>`;
  }
  function renderGoLive(animate){
    const all=(TFS.golive||[]).filter(i=>i.status!=='live'&&!TFS.glHidden.has(i.id));
    setBar(`<span class="tfteam"><i></i>${all.length} waiting to go live</span>
      <span class="tfgrow"></span><button class="tfbtn pri" data-act="gladd">${ICO.plus}Add</button>`,'gl|'+all.length);
    if(TFS.golive===null){setBody(TFS.err.golive?errBox(TFS.err.golive):spinner,animate);return;}
    const items=glList(false), live=glList(true).slice(0,25);
    const hiddenN=(TFS.golive||[]).filter(i=>i.status!=='live'&&TFS.glHidden.has(i.id)).length;
    let h=TFS.err.golive?errBox(TFS.err.golive):'';
    if(gv.adding)h+=glForm(gv.adding,'add','Add to Go Live');
    if(!items.length&&!gv.adding)h+=`<div class="empty">${ICO.check.replace('<svg','<svg fill="none" stroke-width="1.6"')}
      Nothing waiting to go live.
      <button class="tfbtn pri" data-act="gladd">${ICO.plus}Add a change</button></div>`;
    h+=items.map((i,n)=>glCard(i,n,false)).join('');
    if(hiddenN)h+=`<button class="tfmore" data-act="glhidden">${gv.showHidden?'Hide':'Show'} ${hiddenN} hidden</button>`;
    if(live.length){
      h+=`<button class="tfmore" data-act="gllivelist">${gv.showLive?'Hide':'Show'} what went live (${live.length})</button>`;
      if(gv.showLive)h+='<div style="margin-top:12px">'+live.map((i,n)=>glCard(i,n,true)).join('')+'</div>';
    }
    setBody(h,animate);
  }
  async function glSave(){
    const d=gv.adding||gv.editing;if(!d||d.busy)return;
    if(!d.page.trim()){d.err='Add the page first — it’s how this is found later.';renderGoLive(false);return;}
    d.busy=true;d.err='';renderGoLive(false);
    const now=new Date().toISOString();
    try{
      if(gv.adding){
        const pend=(TFS.golive||[]).filter(i=>i.status!=='live');
        const r=await TF.rest('golive_items?select=*',{method:'POST',prefer:'return=representation',body:{
          team_id:TFS.team,created_by:ME.sb_uid,page:d.page.trim(),description:d.description.trim(),files:d.files.trim(),
          position:pend.length?Math.min(...pend.map(i=>i.position==null?0:i.position))-1:0}});
        if(r&&r[0])(TFS.golive=TFS.golive||[]).unshift(r[0]);
        gv.adding=null;toast('Added to Go Live.');
      }else{
        const patch={page:d.page.trim(),description:d.description.trim(),files:d.files.trim(),updated_at:now};
        await TF.rest(`golive_items?id=eq.${d.id}`,{method:'PATCH',body:patch});
        const it=(TFS.golive||[]).find(i=>i.id===d.id);if(it)Object.assign(it,patch);
        gv.editing=null;
      }
      railBadges();renderGoLive(false);
    }catch(e){d.busy=false;d.err=e.message;renderGoLive(false);}
  }
  async function glPatch(id,patch,undoMsg,undoPatch){
    const it=(TFS.golive||[]).find(i=>i.id===id);if(!it)return;
    const before={...it};Object.assign(it,patch,{updated_at:new Date().toISOString()});
    railBadges();renderGoLive(false);
    try{
      await TF.rest(`golive_items?id=eq.${id}`,{method:'PATCH',body:{...patch,updated_at:it.updated_at}});
      if(undoMsg)undoable(undoMsg,()=>glPatch(id,undoPatch));
    }catch(e){Object.assign(it,before);railBadges();renderGoLive(false);toast('Couldn’t update Go Live: '+e.message);}
  }
  async function glHide(id){
    const hid=TFS.glHidden.has(id);
    hid?TFS.glHidden.delete(id):TFS.glHidden.add(id);
    railBadges();renderGoLive(false);
    try{
      if(hid)await TF.rest(`golive_hidden?item_id=eq.${id}&user_id=eq.${ME.sb_uid}`,{method:'DELETE'});
      else{await TF.rest('golive_hidden',{method:'POST',body:{item_id:id}});undoable('Hidden for you',()=>glHide(id));}
    }catch(e){hid?TFS.glHidden.add(id):TFS.glHidden.delete(id);railBadges();renderGoLive(false);toast('Couldn’t hide: '+e.message);}
  }

  /* ---------- Review ---------- */
  const RV={pending:{l:'Waiting for review',v:'--st-open'},approved:{l:'Ready for live',v:'--st-completed'},
            needs_work:{l:'Needs work',v:'--st-critical'},live:{l:'Live',v:'--st-onhold'}};
  /* verdict buttons, or the note box when one is being written */
  function rvActs(p){
    const me=ME.sb_uid, isRev=p.reviewers.includes(me), manage=p.created_by===me||teamAdmin();
    const note=rv.note&&rv.note.id===p.id?rv.note:null;
    let acts='';
    if(note){
      acts=`<div class="tfnotebox" style="width:100%"><textarea class="tfin" data-rnote rows="3" placeholder="${note.kind==='needs_work'?'What needs work? (required)':'What changed? (optional)'}">${escHtml(note.text)}</textarea>
        ${note.err?errBox(note.err):''}
        <div class="tfacts"><button class="tfbtn sm" data-act="rvnotecancel">Cancel</button>
        <button class="tfbtn sm pri" data-act="rvnotesend"${note.busy?' disabled':''}>${note.kind==='needs_work'?'Send back':'Resubmit'}</button></div></div>`;
    }else{
      if(isRev&&p.status==='pending')acts+=`<button class="tfbtn sm ok" data-rvact="approve" data-id="${p.id}">${ICO.check}Approve</button>
        <button class="tfbtn sm bad" data-rvact="needs_work" data-id="${p.id}">Needs work</button>`;
      if(manage&&p.status==='needs_work')acts+=`<button class="tfbtn sm pri" data-rvact="resubmit" data-id="${p.id}">Resubmit</button>`;
      if(p.status==='approved'&&(isRev||manage))acts+=`<button class="tfbtn sm ok" data-rvact="live" data-id="${p.id}">Mark live</button>`;
      if((isRev||manage)&&(p.status==='approved'||p.status==='needs_work'))acts+=`<button class="tfbtn sm ghost" data-rvact="reopen" data-id="${p.id}">Undo verdict</button>`;
    }
    return acts;
  }
  function rvCard(p,n){
    const a=tfMember(p.created_by), st=RV[p.status]||RV.pending, acts=rvActs(p);
    const shots=(p.screenshots||[]).filter(u=>/^https:\/\//i.test(u)).slice(0,4);
    return `<div class="tfcard rvcard" data-rv="${p.id}" tabindex="0" title="Open the full review" style="--c:var(${st.v});animation-delay:${Math.min(n,10)*25}ms">
      <div class="tfc-main">
        <div class="tfrow"><span class="tfc-title tfgrow">${escHtml(p.title)}</span><span class="tfpill">${st.l}</span></div>
        ${p.url?`<div style="margin-top:3px">${pageLink(p.url)}${onPage(p.url)?' <span class="tfhere" style="font-size:11px">· This page</span>':''}</div>`:''}
        ${p.description?`<div class="tfc-desc">${escHtml(p.description)}</div>`:''}
        ${shots.length?`<div class="tfatt" style="margin-top:8px">${shots.map(u=>`<img src="${escHtml(u)}" data-lb="${escHtml(u)}" alt="">`).join('')}</div>`:''}
        <div class="tfmeta">${tfAva(a,18)}<span>${escHtml(a?fullName(a):'Someone')}</span>
          ${p.round>1?`<span>Round ${p.round}</span>`:''}<span>${ago(p.updated_at||p.created_at)}</span>
          ${p.ncomments?`<span title="Comments">${ICO.chat} ${p.ncomments}</span>`:''}
          <span class="tfflex"></span><span class="tfavas" title="Reviewers">${p.reviewers.slice(0,5).map(id=>tfAva(tfMember(id),18)).join('')}</span></div>
        <div class="tfacts">${acts}</div>
      </div></div>`;
  }
  /* ---- one review, opened: details, verdicts, history and comments ---- */
  const RV_EV={submitted:()=>'posted this for review',resubmitted:e=>`resubmitted it for review · round ${e.round}`,
    approved:()=>'marked it reviewed — ready for live',needs_work:()=>'marked it reviewed — needs work',
    reopened:()=>'undid the decision',went_live:()=>'marked it live',live_undone:()=>'undid going live'};
  const RV_EVC={approved:'--st-completed',needs_work:'--st-critical',went_live:'--st-onhold'};
  const rvPost=id=>(TFS.reviews||[]).find(p=>p.id===id)||(rv.thread&&rv.thread.id===id&&rv.thread.post)||null;
  function openReview(id){
    rv.open=id;rv.note=null;rv.submit=null;
    if(rv.thread&&rv.thread.id!==id)rv.thread=null;
    renderReview(true);tfBody.scrollTop=0;
    rvLoadThread(id);
  }
  async function rvLoadThread(id){
    if(!rv.thread||rv.thread.id!==id)rv.thread={id,events:null,comments:null,post:null,text:'',err:'',loadErr:'',sending:false};
    const th=rv.thread, q=encodeURIComponent(id);
    try{
      const [ev,cm,post]=await Promise.all([
        TF.rest(`review_events?select=*&post_id=eq.${q}&order=created_at`),
        TF.rest(`review_comments?select=*&post_id=eq.${q}&order=created_at`),
        /* a post that's gone live isn't in the list any more: fetch it */
        (TFS.reviews||[]).some(p=>p.id===id)?null:Promise.all([
          TF.rest(`review_posts?select=*&id=eq.${q}`),
          TF.rest(`review_reviewers?select=user_id&post_id=eq.${q}`)])]);
      th.events=ev||[];th.comments=cm||[];th.loadErr='';
      if(post){const p=post[0]&&post[0][0];th.post=p?{...p,reviewers:(post[1]||[]).map(r=>r.user_id),ncomments:th.comments.length}:false;}
      else th.post=null;
    }catch(e){
      th.loadErr=e.message||'Couldn’t load the conversation.';
      if(th.events===null){th.events=[];th.comments=[];}
    }
    if(view==='review'&&rv.open===id&&rv.thread===th)renderReview(false);
  }
  function renderReviewDetail(animate){
    const id=rv.open, p=rvPost(id), th=rv.thread&&rv.thread.id===id?rv.thread:null;
    setBar(`<button class="tfbtn ghost sm" data-act="rvback">${ICO.back}Review</button><span class="tfgrow"></span>
      ${TF_APP?`<a class="tfbtn sm" href="${TF_APP}/review?post=${encodeURIComponent(id)}" target="_blank" rel="noopener">Open in TaskFlow ${ICO.ext}</a>`:''}`,'rvd|'+id);
    if(!p){
      setBody(th&&th.post===false?'<div class="tfgate">This review isn’t in TaskFlow any more.</div>':spinner,animate);
      return;
    }
    const focused=!!(root.activeElement&&root.activeElement.dataset&&root.activeElement.dataset.rcomment!=null);
    const st=RV[p.status]||RV.pending, a=tfMember(p.created_by);
    const shots=(p.screenshots||[]).filter(u=>/^https:\/\//i.test(u));
    const who=uid=>{const m=tfMember(uid);return m?fullName(m):'Someone';};
    const tl=th&&th.events?[...th.events.map(e=>({t:e.created_at,e})),...th.comments.map(c=>({t:c.created_at,c}))]
      .sort((x,y)=>String(x.t).localeCompare(String(y.t))):null;
    const item=x=>{
      if(x.e){
        const e=x.e;
        return `<div class="rv-ev" style="--c:var(${RV_EVC[e.kind]||'--st-open'})"><i></i><div>
          <b>${escHtml(who(e.actor))}</b> ${escHtml((RV_EV[e.kind]||(()=>e.kind))(e))} <span class="rv-when">· ${ago(e.created_at)}</span>
          ${e.note?`<div class="rv-note">${escHtml(e.note)}</div>`:''}</div></div>`;
      }
      const c=x.c;
      return `<div class="rv-cm">${tfAva(tfMember(c.user_id),26)}<div class="rv-cmb">
        <div class="rv-cmh"><b>${escHtml(who(c.user_id))}</b><span class="rv-when">${ago(c.created_at)}${c.edited_at?' · edited':''}</span>
          ${c.user_id===ME.sb_uid?`<button class="rv-x" data-rvcdel="${escHtml(String(c.id))}" aria-label="Delete comment">✕</button>`:''}</div>
        <div class="rv-cmt">${escHtml(c.content||'')}</div></div></div>`;
    };
    const nc=th&&th.comments?th.comments.length:(p.ncomments||0);
    setBody(`<div class="rvd">
      <div class="tfrow"><span class="tfpill" style="--c:var(${st.v})">${st.l}</span>${p.round>1?`<span class="tfnote">Round ${p.round}</span>`:''}</div>
      <h3 class="rvd-title">${escHtml(p.title)}</h3>
      ${p.url?`<div>${pageLink(p.url)}${onPage(p.url)?' <span class="tfhere" style="font-size:11px">· This page</span>':''}</div>`:''}
      <div class="tfmeta">${tfAva(a,18)}<span>${escHtml(who(p.created_by))}</span><span>posted ${ago(p.created_at)}</span></div>
      ${p.description?`<div class="rvd-desc">${escHtml(p.description)}</div>`:''}
      ${shots.length?`<div class="tfd-sec"><h5><span>Screenshots</span>${shots.length}</h5><div class="tfatt rvd-shots">${shots.map(u=>`<img src="${escHtml(u)}" data-lb="${escHtml(u)}" alt="" loading="lazy">`).join('')}</div></div>`:''}
      <div class="tfd-sec"><h5><span>Reviewers</span>${p.reviewers.length||''}</h5>
        <div class="tfrow">${p.reviewers.map(uid=>`<span class="rvd-who">${tfAva(tfMember(uid),20)}${escHtml(who(uid))}</span>`).join('')||'<span class="tfnote">No reviewers picked.</span>'}</div>
        <div class="tfacts">${rvActs(p)}</div></div>
      <div class="tfd-sec"><h5><span>Activity &amp; comments</span>${nc||''}</h5>
        ${th&&th.loadErr?errBox(th.loadErr):''}
        ${tl===null?spinner:tl.length?`<div class="rv-tl">${tl.map(item).join('')}</div>`:'<div class="tfnote">No activity yet.</div>'}
        <div class="rv-compose">
          <textarea class="tfin" data-rcomment rows="2" placeholder="Write a comment…">${escHtml(th?th.text:'')}</textarea>
          ${th&&th.err?errBox(th.err):''}
          <div class="tfacts"><span class="tfnote tfgrow">Ctrl+Enter to post</span>
            <button class="tfbtn sm pri" data-act="rvcomment"${th&&th.sending?' disabled':''}>${th&&th.sending?'Posting…':'Comment'}</button></div>
        </div></div></div>`,animate);
    if(focused){const n=tfBody.querySelector('[data-rcomment]');if(n){n.focus();n.setSelectionRange(n.value.length,n.value.length);}}
  }
  async function rvComment(){
    const th=rv.thread;if(!th||th.sending)return;
    const text=(th.text||'').trim(), p=rvPost(th.id);
    if(!text||!p)return;
    th.sending=true;th.err='';renderReview(false);
    try{
      const r=await TF.rest('review_comments?select=*',{method:'POST',prefer:'return=representation',
        body:{post_id:th.id,team_id:p.team_id,user_id:ME.sb_uid,content:text}});
      th.text='';
      (th.comments=th.comments||[]).push((r&&r[0])||{id:'tmp'+Date.now(),user_id:ME.sb_uid,content:text,created_at:new Date().toISOString()});
      p.ncomments=(p.ncomments||0)+1;
    }catch(e){th.err=e.message||'Couldn’t post the comment.';}
    th.sending=false;
    if(rv.thread===th&&rv.open===th.id){
      renderReview(false);
      const n=tfBody.querySelector('[data-rcomment]');if(n)n.focus();
    }
  }
  function renderReview(animate){
    if(rv.open)return renderReviewDetail(animate);
    const posts=TFS.reviews||[];
    const waiting=posts.filter(p=>p.status==='pending'&&p.reviewers.includes(ME.sb_uid)).length;
    const cnt=k=>posts.filter(p=>p.status===k).length;
    const here=posts.filter(p=>onPage(p.url)).length;
    /* a page with something out for review opens on just that page */
    if(rv.filter===null&&TFS.reviews!==null)rv.filter=here?'page':'all';
    const tabs=[...(here?[['page','This page',here]]:[]),['all','All',posts.length],['needs_work','Needs work',cnt('needs_work')],
      ['pending','Ready for review',cnt('pending')],['approved','Ready for live',cnt('approved')]];
    if(rv.filter!==null&&!tabs.some(t=>t[0]===rv.filter))rv.filter='all';
    setBar(`<span class="tfteam"><i></i>${waiting?waiting+' waiting on you':posts.length+' open'}</span>
      <span class="tfgrow"></span><button class="tfbtn pri" data-act="rvnew">${ICO.plus}Submit this page</button>
      ${seg('rvf',tabs,rv.filter).replace('class="tfseg"','class="tfseg rvf"')}`,
      'rv|'+rv.filter+'|'+waiting+'|'+tabs.map(t=>t[2]).join('.'));
    if(TFS.reviews===null){setBody(TFS.err.reviews?errBox(TFS.err.reviews):spinner,animate);return;}
    let h=TFS.err.reviews?errBox(TFS.err.reviews):'';
    if(rv.submit){
      const s=rv.submit;
      h+=`<div class="tfform">
        <span class="tflabel">Title</span><input class="tfin" data-rf="title" type="text" value="${escHtml(s.title)}">
        <span class="tflabel">Link</span><input class="tfin" data-rf="url" type="text" value="${escHtml(s.url)}">
        <span class="tflabel">What to look at</span><textarea class="tfin" data-rf="description" rows="3" placeholder="What changed, what to check">${escHtml(s.description)}</textarea>
        <span class="tflabel">Reviewers</span>
        <div class="tfpick">${TFS.members.map(m=>`<button type="button" class="${s.reviewers.includes(m.id)?'sel':''}" data-rvpick="${m.id}">${tfAva(m,20)}${escHtml(fullName(m))}</button>`).join('')||'<span class="tfnote">Loading people…</span>'}</div>
        ${s.err?errBox(s.err):''}
        <div class="tfacts"><button class="tfbtn" data-act="rvcancel">Cancel</button>
          <button class="tfbtn pri" data-act="rvsubmit"${s.busy?' disabled':''}>${s.busy?'Submitting…':'Submit'}</button></div></div>`;
    }
    const list=rv.filter==='page'?posts.filter(p=>onPage(p.url)):rv.filter==='all'||!rv.filter?posts:posts.filter(p=>p.status===rv.filter), me=ME.sb_uid;
    const groups=[
      ['Waiting on you','--st-critical',list.filter(p=>p.status==='pending'&&p.reviewers.includes(me))],
      ['Waiting for review','--st-open',list.filter(p=>p.status==='pending'&&!p.reviewers.includes(me))],
      ['Needs work','--st-critical',list.filter(p=>p.status==='needs_work')],
      ['Ready for live','--st-completed',list.filter(p=>p.status==='approved')]];
    let n=0;
    groups.forEach(([l,v,g])=>{if(g.length)h+=`<div class="tfgh" style="--c:var(${v})"><i></i>${l} <b>${g.length}</b></div>`+g.map(p=>rvCard(p,n++)).join('');});
    if(!list.length&&!rv.submit)h+=`<div class="empty">${ICO.check.replace('<svg','<svg fill="none" stroke-width="1.6"')}
      ${{page:'Nothing from this page is out for review.',all:'Nothing is out for review.',needs_work:'Nothing needs work.',pending:'Nothing is waiting for review.',approved:'Nothing is ready for live.'}[rv.filter]}
      ${rv.filter!=='needs_work'&&rv.filter!=='approved'?`<button class="tfbtn pri" data-act="rvnew">${ICO.plus}Submit this page</button>`:''}</div>`;
    setBody(h,animate);
  }
  async function rvOpenSubmit(){
    rv.open=rv.thread=null;
    rv.submit={title:(document.title||'').split(/\s[|–—-]\s/)[0].trim()||shortPage(HERE_URL),
      url:HERE_URL,description:'',reviewers:[],err:'',busy:false};
    renderReview(false);
    if(TFS.defaults===null){
      try{const r=await TF.rest(`review_settings?select=default_reviewers&team_id=eq.${TFS.team}`);TFS.defaults=(r&&r[0]&&r[0].default_reviewers)||[];}
      catch(e){TFS.defaults=[];}
    }
    if(rv.submit&&!rv.submit.reviewers.length){rv.submit.reviewers=TFS.defaults.slice();renderReview(false);}
  }
  async function rvRpc(name,args,ok){
    try{await TF.rpc(name,args);if(ok)toast(ok);await tfLoad('reviews');}
    catch(e){toast(e.message||'TaskFlow said no.');}
    railBadges();renderReview(false);
    if(rv.open)rvLoadThread(rv.open);
  }

  /* ---------- one set of listeners for every view ---------- */
  tfBar.addEventListener('click',e=>{
    const b=e.target.closest('button');if(!b)return;
    const sg=b.closest('[data-seg]');
    if(sg&&b.dataset.v){
      const k=sg.dataset.seg, v=b.dataset.v;
      if(k==='scope')tv.scope=v;else if(k==='status')tv.status=v;
      else if(k==='rvf')rv.filter=v;
      renderTf(true);return;
    }
    tfAct(b.dataset.act,b,e);
  });
  tfBody.addEventListener('click',e=>{
    const t=e.target;
    const lb=t.closest('[data-lb]');if(lb&&lb.tagName==='IMG'){openLightbox(lb.dataset.lb);return;}
    if(t.closest('a'))return;                                   /* real links just open */
    const b=t.closest('button');
    if(b){
      const d=b.dataset;
      if(d.complete){e.stopPropagation();const tk=tfTaskById(d.complete);if(tk)setTaskStatus(tk.id,tk.status==='completed'?'open':'completed');return;}
      if(d.subtoggle||d.subdel){
        const tk=tfTaskById(tv.open);if(!tk)return;
        let subs=asSubs(tk.subtasks);
        subs=d.subdel?subs.filter(s=>s.id!==d.subdel):subs.map(s=>s.id===d.subtoggle?{...s,done:!s.done}:s);
        setSubs(tk.id,subs);return;
      }
      if(d.v&&b.closest('[data-seg="tstatus"]')){setTaskStatus(tv.open,d.v);return;}
      if(d.v&&b.closest('[data-fseg]')){
        const k=b.closest('[data-fseg]').dataset.fseg;
        if(tv.form)tv.form[k]=d.v;
        b.parentNode.querySelectorAll('button').forEach(x=>x.classList.toggle('sel',x===b));
        return;
      }
      if(d.attdel!=null&&tv.form){tv.form.atts.splice(+d.attdel,1);renderTaskForm(false);return;}
      if(d.gocomment){
        const c=d.ctx, id=d.gocomment;
        if(c===PAGE||c==='general'){
          switchView('comments');
          const tab=$(`.tab[data-ctx="${c===PAGE?'page':'general'}"]`);if(tab)tab.click();
          setTimeout(()=>gotoComment(id),120);
        }else openPage(c,id);
        return;
      }
      if(d.scopeTo){tv.scope=d.scopeTo;renderTf(true);return;}
      if(d.gllive){glPatch(d.gllive,{status:'live',went_live_at:new Date().toISOString()},'Marked live',{status:'pending',went_live_at:null});return;}
      if(d.glundo){glPatch(d.glundo,{status:'pending',went_live_at:null});return;}
      if(d.glhide){glHide(d.glhide);return;}
      if(d.gledit){
        const it=(TFS.golive||[]).find(i=>i.id===d.gledit);
        if(it){gv.adding=null;gv.editing={id:it.id,page:it.page||'',description:it.description||'',files:it.files||'',err:'',busy:false};renderGoLive(false);}
        return;
      }
      if(d.gldel){
        const it=(TFS.golive||[]).find(i=>i.id===d.gldel);if(!it)return;
        confirmDialog({title:'Delete this Go Live item?',text:'It’s removed from Go Live for the whole team.',
          quote:shortPage(it.page)+(it.description?' — '+it.description:''),ok:'Delete',tone:'danger',
          go:async()=>{
            try{await TF.rest(`golive_items?id=eq.${it.id}`,{method:'DELETE'});TFS.golive=TFS.golive.filter(i=>i!==it);railBadges();renderGoLive(false);}
            catch(err){toast('Couldn’t delete: '+err.message);}
          }});
        return;
      }
      if(d.rvpick&&rv.submit){
        const s=rv.submit, id=d.rvpick;
        s.reviewers=s.reviewers.includes(id)?s.reviewers.filter(x=>x!==id):[...s.reviewers,id];
        b.classList.toggle('sel',s.reviewers.includes(id));return;
      }
      if(d.rvcdel){
        const th=rv.thread, c=th&&(th.comments||[]).find(x=>String(x.id)===d.rvcdel);if(!c)return;
        confirmDialog({title:'Delete this comment?',text:'It’s removed from the review for everyone.',
          quote:clip(c.content||'',180),ok:'Delete',tone:'danger',
          go:async()=>{
            try{
              await TF.rest(`review_comments?id=eq.${encodeURIComponent(c.id)}`,{method:'DELETE'});
              th.comments=th.comments.filter(x=>x!==c);
              const p=rvPost(th.id);if(p&&p.ncomments)p.ncomments--;
              renderReview(false);
            }catch(err){toast('Couldn’t delete: '+err.message);}
          }});
        return;
      }
      if(d.rvact){
        const id=d.id;
        if(d.rvact==='approve')rvRpc('review_decide',{p_post_id:id,p_verdict:'approved',p_note:''},'Approved — ready for live.');
        else if(d.rvact==='needs_work'||d.rvact==='resubmit'){rv.note={id,kind:d.rvact,text:'',err:'',busy:false};renderReview(false);
          setTimeout(()=>{const n=tfBody.querySelector('[data-rnote]');if(n)n.focus();},30);}
        else if(d.rvact==='live')rvRpc('review_mark_live',{p_post_id:id},'Marked live.');
        else if(d.rvact==='reopen')rvRpc('review_reopen',{p_post_id:id},'Back to waiting for review.');
        return;
      }
      if(d.act){tfAct(d.act,b,e);return;}
      return;
    }
    const card=t.closest('[data-task]');
    if(card){tv.open=card.dataset.task;renderTf(true);tfBody.scrollTop=0;return;}
    const rc=t.closest('[data-rv]');
    if(rc&&view==='review'&&!rv.open&&!t.closest('textarea,input,select,.tfnotebox'))openReview(rc.dataset.rv);
  });
  tfBody.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&e.target.dataset&&e.target.dataset.task){tv.open=e.target.dataset.task;renderTf(true);return;}
    if(e.key==='Enter'&&e.target.dataset&&e.target.dataset.rv&&view==='review'){openReview(e.target.dataset.rv);return;}
    if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&e.target.dataset&&e.target.dataset.rcomment!=null){e.preventDefault();rvComment();return;}
    if(e.key==='Enter'&&e.target.classList.contains('tfsubnew')){e.preventDefault();tfAct('subadd');}
    if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){
      if(tv.form)createTask();else if(gv.adding||gv.editing)glSave();else if(rv.submit)tfAct('rvsubmit');
    }
  });
  tfBody.addEventListener('input',e=>{
    const d=e.target.dataset;
    if(d.ff&&tv.form)tv.form[d.ff]=e.target.value;
    if(d.gf){const g=gv.adding||gv.editing;if(g)g[d.gf]=e.target.value;}
    if(d.rf&&rv.submit)rv.submit[d.rf]=e.target.value;
    if(d.rnote!=null&&rv.note)rv.note.text=e.target.value;
    if(d.rcomment!=null&&rv.thread)rv.thread.text=e.target.value;
  });
  tfBody.addEventListener('change',e=>{
    const t=e.target;
    if(t.dataset.ff&&tv.form)tv.form[t.dataset.ff]=t.value;
    if(t.dataset.ffq!=null&&tv.form)tv.form.queue=t.checked;
    if(t.dataset.tfield&&tv.open)tfUpdateTask(tv.open,{[t.dataset.tfield]:t.value||null});
    if(t.classList.contains('tfattfile')&&tv.form){
      const files=[...t.files].filter(f=>/^image\/(png|jpeg|webp|gif)$/.test(f.type)).slice(0,10-tv.form.atts.length);
      t.value='';
      if(!files.length)return;
      const f=tv.form;f.up+=files.length;renderTaskForm(false);
      files.forEach(file=>{
        const fr=new FileReader();
        fr.onload=()=>api('dc_upload',{type:file.type,data:String(fr.result).split(',')[1]}).then(j=>{
          f.up--;
          if(j.success)f.atts.push(j.data.url);else f.err=(j.data&&j.data.msg)||'Upload failed.';
          if(tv.form===f)renderTaskForm(false);
        }).catch(()=>{f.up--;if(tv.form===f)renderTaskForm(false);});
        fr.readAsDataURL(file);
      });
    }
  });
  function tfAct(act,b,e){
    switch(act){
      case 'newtask':openTaskForm({page:HERE_URL});break;
      case 'back':tv.open=null;renderTf(true);break;
      case 'cancelform':{
        const f=tv.form;tv.form=null;
        tv.open=null;renderTf(true);
        if(f&&f.feedback.trim()&&!f.link.length)undoable('Draft discarded',()=>{f.busy=false;tv.form=f;renderTf(true);});
        break;
      }
      case 'createtask':createTask();break;
      case 'attadd':{const i=tfBody.querySelector('.tfattfile');if(i)i.click();break;}
      case 'subadd':{
        const inp=tfBody.querySelector('.tfsubnew'), tk=tfTaskById(tv.open);
        if(!inp||!tk||!inp.value.trim())break;
        setSubs(tk.id,[...asSubs(tk.subtasks),{id:newSubId(),text:inp.value.trim(),done:false}]);
        setTimeout(()=>{const n=tfBody.querySelector('.tfsubnew');if(n)n.focus();},20);
        break;
      }
      case 'deltask':{
        const tk=tfTaskById(tv.open);if(!tk)break;
        confirmDialog({title:'Delete this task?',text:'It’s deleted from TaskFlow for the whole team. This can’t be undone.',
          quote:clip(htmlText(tk.feedback),180),ok:'Delete task',tone:'danger',
          go:async()=>{
            try{
              await TF.rest(`tasks?id=eq.${encodeURIComponent(tk.id)}`,{method:'DELETE'});
              await TF.rest(`queue?task_id=eq.${encodeURIComponent(tk.id)}`,{method:'DELETE'}).catch(()=>{});
              if(linkedComments(tk.id).length)unlinkTask(tk.id);
              TFS.tasks=(TFS.tasks||[]).filter(x=>x!==tk);if(TFS.done)TFS.done=TFS.done.filter(x=>x!==tk);delete TFS.extra[tk.id];
              tv.open=null;railBadges();renderTf(true);toast('Task deleted.');
            }catch(err){toast('Couldn’t delete: '+err.message);}
          }});
        break;
      }
      case 'unlink':unlinkTask(tv.open);break;
      case 'queue':queueAdd(tv.open);break;
      case 'unqueue':{const q=(TFS.queue||[]).find(x=>x.task_id===tv.open);if(q)queueRemove(q.id);break;}
      case 'gladd':gv.editing=null;gv.adding={page:HERE_URL,description:'',files:'',err:'',busy:false};renderGoLive(false);tfBody.scrollTop=0;
        setTimeout(()=>{const n=tfBody.querySelector('[data-gf="description"]');if(n)n.focus();},40);break;
      case 'glcancel':gv.adding=gv.editing=null;renderGoLive(false);break;
      case 'glsave':glSave();break;
      case 'glhidden':gv.showHidden=!gv.showHidden;renderGoLive(false);break;
      case 'gllivelist':gv.showLive=!gv.showLive;renderGoLive(false);break;
      case 'rvnew':rvOpenSubmit();tfBody.scrollTop=0;break;
      case 'rvcancel':rv.submit=null;renderReview(false);break;
      case 'rvsubmit':{
        const s=rv.submit;if(!s||s.busy)break;
        if(!s.title.trim()){s.err='Give it a title.';renderReview(false);break;}
        if(!s.reviewers.length){s.err='Pick at least one reviewer.';renderReview(false);break;}
        s.busy=true;s.err='';renderReview(false);
        TF.rpc('review_create',{p_team_id:TFS.team,p_title:s.title.trim(),p_url:s.url.trim(),p_description:s.description.trim(),
            p_screenshots:[],p_reviewers:s.reviewers})
          .then(async()=>{rv.submit=null;toast('Submitted for review.');await tfLoad('reviews');railBadges();renderReview(false);})
          .catch(err=>{s.busy=false;s.err=err.message;renderReview(false);});
        break;
      }
      case 'rvnotecancel':rv.note=null;renderReview(false);break;
      case 'rvback':rv.open=rv.thread=rv.note=null;renderTf(true);break;
      case 'rvcomment':rvComment();break;
      case 'rvnotesend':{
        const n=rv.note;if(!n||n.busy)break;
        if(n.kind==='needs_work'&&!n.text.trim()){n.err='Say what needs work.';renderReview(false);break;}
        n.busy=true;renderReview(false);
        const go=n.kind==='needs_work'
          ?TF.rpc('review_decide',{p_post_id:n.id,p_verdict:'needs_work',p_note:n.text.trim()})
          :TF.rpc('review_resubmit',{p_post_id:n.id,p_note:n.text.trim()});
        go.then(async()=>{rv.note=null;toast(n.kind==='needs_work'?'Sent back with your note.':'Resubmitted.');await tfLoad('reviews');railBadges();renderReview(false);if(rv.open)rvLoadThread(rv.open);})
          .catch(err=>{n.busy=false;n.err=err.message;renderReview(false);});
        break;
      }
    }
  }
  /* ================= focus: now + up next, above the comments =================
     TaskFlow's Current Focus: tasks in progress first, then the team queue in
     its own order, no repeats. Ticking one completes it with TaskFlow's rules
     (XP, queue clean-up, the next queued task promoted). */
  const focusEl=$('.focusbar'), focusBody=$('.fc-body');
  const inQueue=id=>(TFS.queue||[]).some(q=>q.task_id===id);
  try{focusEl.classList.toggle('shut',localStorage.getItem('dc_focus_shut')==='1');}catch(e){}
  focusEl.querySelector('.fc-head').setAttribute('aria-expanded',String(!focusEl.classList.contains('shut')));
  function focusItems(){
    const open=TFS.tasks||[], byId=Object.fromEntries(open.map(t=>[t.id,t])), seen=new Set(), out=[];
    open.filter(t=>t.status==='in_progress').forEach(t=>{seen.add(t.id);out.push({t,now:true});});
    (TFS.queue||[]).forEach(q=>{const t=byId[q.task_id];if(t&&!seen.has(t.id)){seen.add(t.id);out.push({t,q});}});
    return out;
  }
  function renderFocus(){
    const show=!!(ME&&TF_READY&&TFS.team);
    focusEl.hidden=!show;
    if(!show)return;
    const items=focusItems(), loading=TFS.tasks===null||TFS.queue===null;
    focusEl.querySelector('.fc-count').textContent=items.length?String(items.length):'';
    const sig=(loading?'l':'')+items.map(x=>x.t.id+x.t.status+(x.q?x.q.id:'')+htmlText(x.t.feedback).length+(x.t.assignee_id||'')).join(',');
    if(focusBody.dataset.sig===sig)return;
    focusBody.dataset.sig=sig;
    if(loading){focusBody.innerHTML='<div class="fc-empty">Loading your focus…</div>';return;}
    if(!items.length){
      focusBody.innerHTML='<div class="fc-empty">Nothing in focus. Start a task, or <button type="button" data-fcgo="tasks">queue one from Tasks</button>.</div>';
      return;
    }
    let n=0, h='';
    const row=x=>{
      const t=x.t, st=ST[t.status]||ST.open, m=tfMember(t.assignee_id), txt=clip(htmlText(t.feedback),160);
      return `<div class="fcrow" data-fctask="${t.id}" tabindex="0" style="--c:var(${st.v})">
        ${x.now?`<button class="tfchk" data-fcdone="${t.id}" title="Mark complete" aria-label="Mark task complete">${ICO.check}</button>`
               :`<span class="fc-n">${++n}</span>`}
        <div class="fc-main"><div class="fc-txt">${txt?escHtml(txt):'<i>No description</i>'}</div>
          <div class="fc-meta">${x.now?`<span class="tfst"><i></i>${st.l}</span>`:`<span class="tfpill r-${escHtml(t.roi||'medium')}">${escHtml(t.roi||'medium')}</span>`}
            ${t.page?pageLink(t.page):''}${onPage(t.page)?'<span class="tfhere">This page</span>':''}${m?tfAva(m,16):''}</div></div>
        ${x.q?`<button class="fc-x" data-fcunq="${x.q.id}" title="Remove from queue" aria-label="Remove from queue">✕</button>`:''}
      </div>`;
    };
    const now=items.filter(x=>x.now), next=items.filter(x=>!x.now);
    if(now.length)h+='<div class="fc-lbl">Now</div>'+now.map(row).join('');
    if(next.length)h+='<div class="fc-lbl">Up next</div>'+next.map(row).join('');
    focusBody.innerHTML=h;
  }
  let fcOpenT=null;
  focusEl.querySelector('.fc-head').onclick=()=>{
    const shut=focusEl.classList.toggle('shut');
    clearTimeout(fcOpenT);focusEl.classList.remove('opening');
    if(!shut){
      /* stagger the rows in as the strip unfolds */
      focusBody.querySelectorAll('.fc-lbl,.fcrow,.fc-empty').forEach((el,i)=>el.style.animationDelay=(60+Math.min(i,8)*35)+'ms');
      void focusEl.offsetWidth;focusEl.classList.add('opening');
      fcOpenT=setTimeout(()=>focusEl.classList.remove('opening'),800);
    }
    focusEl.querySelector('.fc-head').setAttribute('aria-expanded',String(!shut));
    try{localStorage.setItem('dc_focus_shut',shut?'1':'0');}catch(e){}
  };
  focusBody.addEventListener('click',e=>{
    const t=e.target;
    if(t.closest('a'))return;
    const b=t.closest('button');
    if(b&&b.dataset.fcdone){setTaskStatus(b.dataset.fcdone,'completed');return;}
    if(b&&b.dataset.fcunq){queueRemove(b.dataset.fcunq);return;}
    if(b&&b.dataset.fcgo){switchView(b.dataset.fcgo);return;}
    const r=t.closest('[data-fctask]');if(r)openTaskView(r.dataset.fctask);
  });
  focusBody.addEventListener('keydown',e=>{
    if(e.key==='Enter'&&e.target.dataset&&e.target.dataset.fctask)openTaskView(e.target.dataset.fctask);
  });
  async function queueAdd(id,quiet){
    if(!id||!TFS.team||inQueue(id))return;
    const pos=Math.max(0,...(TFS.queue||[]).map(q=>q.position||0))+1;
    try{
      const r=await TF.rest('queue?select=id,task_id,position',{method:'POST',prefer:'return=representation',
        body:{task_id:id,team_id:TFS.team,position:pos}});
      (TFS.queue=TFS.queue||[]).push((r&&r[0])||{id:'tmp'+Date.now(),task_id:id,position:pos});
      if(!quiet)toast('Added to the focus queue.');
    }catch(e){toast('Couldn’t queue it: '+e.message);}
    tfRepaint();
  }
  async function queueRemove(qid){
    const q=(TFS.queue||[]).find(x=>x.id===qid);if(!q)return;
    TFS.queue=TFS.queue.filter(x=>x!==q);tfRepaint();
    try{
      await TF.rest(`queue?id=eq.${encodeURIComponent(qid)}`,{method:'DELETE'});
      undoable('Removed from queue',()=>queueAdd(q.task_id,true));
    }catch(e){TFS.queue.push(q);TFS.queue.sort((a,b)=>a.position-b.position);tfRepaint();toast('Couldn’t update the queue: '+e.message);}
  }

  /* ================= levels, XP and ranks =================
     The same rules and tables as TaskFlow (src/lib/xp.js, streak.js and
     petBadges.js): XP and level live in user_levels (each person may update
     their own row), the team streak goes through bump_streak, and ranks are
     worked out from level, account age, tasks completed and four special
     achievements. Rank artwork is served by the TaskFlow app. */
  const XP_CREATE=5, XP_DONE={low:10,medium:20,high:35},
        XP_BONUS={critical:15,queue:10,firstOfDay:15,streakPerDay:5,streakMax:60};
  const xpToNext=l=>100+(l-1)*20;
  const ymdLocal=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const rankImg=f=>TF_APP?TF_APP+'/ranks/'+f:'';
  const LEVEL_BADGES=[[5,'Bronze'],[10,'Silver'],[20,'Gold'],[30,'Platinum'],[40,'Diamond'],[50,'Champion'],[70,'Grand Champ'],[100,'Supreme']]
    .map(([n,name])=>({key:'lvl'+n,target:n,name,img:rankImg(`lvl${n}-Photoroom.png`),req:'Lv '+n}));
  const TASK_BADGES=[5,15,30,50,100,125,150,175,200,250,300,400,500,700,1000]
    .map(n=>({key:'task'+n,target:n,name:n+' Tasks',img:rankImg(`${n}t-Photoroom.png`),req:n+' done'}));
  const AGE_BADGES=[[1,'Newcomer','1 day','1d'],[5,'Rookie','5 days','5d'],[14,'Regular','2 weeks','2w'],[21,'Familiar','3 weeks','3w'],
    [30,'Member','1 month','1m'],[60,'Established','2 months','2m'],[90,'Seasoned','3 months','3m'],[120,'Committed','4 months','4m'],
    [150,'Dedicated','5 months','5m'],[180,'Devoted','6 months','6m'],[210,'Trusted','7 months','7m'],[240,'Reliable','8 months','8m'],
    [270,'Stalwart','9 months','9m'],[300,'Steadfast','10 months','10m'],[330,'Loyal','11 months','11m'],[365,'Veteran','1 year','1y'],
    [540,'Senior','18 months','18m'],[730,'Elder','2 years','2y'],[900,'Distinguished','30 months','30m'],[1095,'Venerable','3 years','3y'],
    [1260,'Luminary','42 months','42m'],[1460,'Sage','4 years','4y'],[1620,'Icon','54 months','54m'],[1825,'Legend','5 years','5y']]
    .map(([d,name,req,f])=>({key:'age'+d,target:d,name,req,img:rankImg(f==='5y'?'5y-Photoroom%20(1).png':`${f}-Photoroom.png`)}));
  const SPECIAL_BADGES=[['firefighter','Firefighter','Clear 25 critical tasks'],['century','Century','100 done in one month'],
    ['speed-runner','Speed Runner','Finish within 10 min'],['clean-sweep','Clean Sweep','Zero open & in-progress']]
    .map(([key,name,req])=>({key,name,req,img:rankImg(`${key}-Photoroom.png`)}));
  const GAME={row:null,teamOn:true,created:'',special:{},specialAt:0};
  const gameOn=()=>!!(ME&&GAME.row&&GAME.row.gamification_enabled!==false&&GAME.teamOn);
  function ranks(){
    const r=GAME.row||{}, lvl=r.level||1, done=r.tasks_completed||0;
    const days=GAME.created?Math.max(0,Math.floor((Date.now()-new Date(GAME.created).getTime())/864e5)):0;
    const mk=(list,cur,unit)=>list.map(b=>({...b,cur,unit,earned:cur>=b.target}));
    return {lvl,done,days,level:mk(LEVEL_BADGES,lvl,''),task:mk(TASK_BADGES,done,''),age:mk(AGE_BADGES,days,'d'),
      special:SPECIAL_BADGES.map(b=>({...b,earned:!!GAME.special[b.key]}))};
  }
  /* the top-bar rule from TaskFlow: highest earned per track, plus specials */
  function shownRanks(R){
    const top=l=>[...l].reverse().find(b=>b.earned);
    return [top(R.level),top(R.age),top(R.task),...R.special.filter(b=>b.earned)].filter(Boolean);
  }
  const earnedKeys=()=>{const R=ranks();return [...R.level,...R.task,...R.age,...R.special].filter(b=>b.earned).map(b=>b.key);};

  async function gLoad(){
    if(!ME||!ME.sb_uid||!TF_READY)return;
    const uid=ME.sb_uid;
    try{
      const [lv,prof,team]=await Promise.all([
        TF.rest(`user_levels?select=*&user_id=eq.${uid}`),
        TF.rest(`profiles?select=start_date&id=eq.${uid}`).catch(()=>[]),
        TFS.team?TF.rest(`teams?select=gamification_enabled&id=eq.${TFS.team}`).catch(()=>[]):Promise.resolve([])]);
      if(!ME||ME.sb_uid!==uid)return;
      GAME.row=(lv&&lv[0])||null;
      GAME.teamOn=!(team&&team[0]&&team[0].gamification_enabled===false);
      GAME.created=(prof&&prof[0]&&prof[0].start_date)||await TF.created();
    }catch(e){GAME.row=null;}
    try{GAME.special=Object.fromEntries((JSON.parse(localStorage.getItem('dc_special_'+uid))||[]).map(k=>[k,true]));}catch(e){}
    paintGame();
    gSpecial();
  }
  /* special achievements, worked out like SpecialBadgesContext; once earned
     they're kept, so a momentary one (Clean Sweep) never blinks off */
  async function gSpecial(force){
    if(!ME||!ME.sb_uid||(!force&&Date.now()-GAME.specialAt<600000))return;
    GAME.specialAt=Date.now();
    const uid=ME.sb_uid, name=encodeURIComponent('*'+(ME.name||'').replace(/[*,()]/g,'')+'*'), live={};
    try{
      if(ME.name){
        const crit=await TF.rest(`tasks?select=id&status=eq.completed&roi=eq.critical&completed_by=ilike.${name}&limit=25`);
        live.firefighter=(crit||[]).length>=25;
        const comp=await TF.rest(`tasks?select=date_completed&status=eq.completed&completed_by=ilike.${name}&date_completed=not.is.null&limit=5000`);
        const by={};(comp||[]).forEach(t=>{const k=String(t.date_completed).slice(0,7);by[k]=(by[k]||0)+1;});
        live.century=Object.values(by).some(n=>n>=100);
      }
      const mine=await TF.rest(`tasks?select=created_at,date_completed&created_by=eq.${uid}&status=eq.completed&date_completed=not.is.null&limit=5000`);
      live['speed-runner']=(mine||[]).some(t=>{const a=new Date(t.created_at).getTime(),b=new Date(t.date_completed).getTime();return b>a&&b-a<=600000;});
      const sweeps=await Promise.all((ME.teams||[]).map(async t=>{
        const [open,any]=await Promise.all([
          TF.rest(`tasks?select=id&team_id=eq.${t.id}&status=in.(open,in_progress)&limit=1`),
          TF.rest(`tasks?select=id&team_id=eq.${t.id}&limit=1`)]);
        return (any||[]).length>0&&!(open||[]).length;
      }));
      live['clean-sweep']=sweeps.some(Boolean);
    }catch(e){}
    if(!ME||ME.sb_uid!==uid)return;
    const before=earnedKeys();
    Object.entries(live).forEach(([k,v])=>{if(v)GAME.special[k]=true;});
    try{localStorage.setItem('dc_special_'+uid,JSON.stringify(Object.keys(GAME.special)));}catch(e){}
    if(force)announceRanks(before);
    paintGame();
  }
  function gReset(){GAME.row=null;GAME.teamOn=true;GAME.created='';GAME.special={};GAME.specialAt=0;paintGame();}

  const lvlBtn=$('.rlvl'), ranksEl=$('.rranks');
  function paintGame(){
    const on=gameOn();
    lvlBtn.hidden=!on;ranksEl.hidden=!on||!TF_APP;$('.rlsep').hidden=!on;
    const grp=$('.tfranksgrp');
    if(!on){
      grp.querySelector('.tfranks').innerHTML=ME&&GAME.row?'<div class="tfnote">Levels and ranks are turned off — for you, or for this team — in TaskFlow.</div>':'';
      grp.querySelector('.tfrk-count').textContent='';
      grp.classList.toggle("gameoff",!(ME&&GAME.row));
      return;
    }
    grp.classList.remove("gameoff");
    const R=ranks(), row=GAME.row, need=xpToNext(R.lvl), xp=Math.round(row.xp||0), pct=Math.max(0,Math.min(1,xp/need));
    lvlBtn.querySelector('.rl-num').textContent=R.lvl;
    lvlBtn.querySelector('.rl-fill').style.strokeDashoffset=String(91.1*(1-pct));
    lvlBtn.dataset.tip=`Level ${R.lvl} · ${xp}/${need} XP`+(row.streak?` · ${row.streak}-day streak`:'');
    const shown=shownRanks(R).slice(0,4);
    const sig=shown.map(b=>b.key).join(',');
    if(ranksEl.dataset.sig!==sig){
      ranksEl.dataset.sig=sig;
      ranksEl.innerHTML=shown.map(b=>`<span class="rbtn rrank" data-tip="${escHtml(b.name)} · ${escHtml(b.req)}" role="img" aria-label="${escHtml(b.name)}"><img src="${escHtml(b.img)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></span>`).join('');
    }
    /* settings: progress to the next level, then every rank */
    const all=[...R.level,...R.task,...R.age,...R.special];
    grp.querySelector('.tfrk-count').textContent=`${all.filter(b=>b.earned).length} of ${all.length}`;
    const cell=b=>`<div class="tfrk ${b.earned?'earned':'locked'}" title="${escHtml(b.name)} · ${b.earned?'earned':'reach '+escHtml(b.req)}">
        <div class="tfrk-art">${b.img?`<img src="${escHtml(b.img)}" alt="" loading="lazy">`:''}</div><b>${escHtml(b.name)}</b>
        <span>${b.earned||b.target==null?escHtml(b.req):Math.min(b.cur,b.target)+'/'+b.target+(b.unit||'')}</span></div>`;
    const sec=(l,list)=>`<div class="tfrk-sec">${l}</div><div class="tfrk-grid">${list.map(cell).join('')}</div>`;
    grp.querySelector('.tfranks').innerHTML=`<div class="tfrk-bar"><b>Level ${R.lvl}</b>
        <span class="tfrk-track"><i style="width:${Math.round(pct*100)}%"></i></span><span>${xp}/${need} XP</span></div>
      <div class="tfnote" style="margin:-6px 0 4px">${R.done} task${R.done===1?'':'s'} completed${row.streak?` · ${row.streak}-day streak`:''}</div>`
      +sec('Level',R.level)+sec('Tasks',R.task)+sec('Age',R.age)+sec('Special',R.special);
  }
  lvlBtn.onclick=()=>{
    openSettings();
    setTimeout(()=>{const g=$('.tfranksgrp');if(g)g.scrollIntoView({block:'start',behavior:'smooth'});},60);
  };
  ranksEl.onclick=()=>lvlBtn.click();
  function announceRanks(before){
    const now=earnedKeys().filter(k=>!before.includes(k));
    if(!now.length||!gameOn())return;
    const all=[...LEVEL_BADGES,...TASK_BADGES,...AGE_BADGES,...SPECIAL_BADGES];
    const names=now.map(k=>(all.find(b=>b.key===k)||{}).name).filter(Boolean);
    if(names.length)setTimeout(()=>toast('New rank: '+names.join(', ')),1500);
  }
  function xpLanded(gain,levelsUp,bonuses){
    paintGame();
    if(!gameOn())return;
    const pop=lvlBtn.querySelector('.xppop');
    pop.textContent='+'+gain+' XP';
    pop.classList.remove('go');void pop.offsetWidth;pop.classList.add('go');
    lvlBtn.classList.remove('pulse');void lvlBtn.offsetWidth;lvlBtn.classList.add('pulse');
    if(levelsUp)toast(`Level up — you’re level ${GAME.row.level}!`);
    else if(bonuses&&bonuses.length)toast(`+${gain} XP · `+bonuses.map(b=>b.label).join(' · '));
  }
  /* one award at a time, each from a fresh row, so two quick completions
     can't both start from the same XP */
  let xpChain=Promise.resolve();
  const xpQueue=fn=>{xpChain=xpChain.then(fn).catch(()=>{});return xpChain;};
  async function levelRow(){
    const r=await TF.rest(`user_levels?select=*&user_id=eq.${ME.sb_uid}`);
    return r&&r[0];
  }
  function gainLevels(row,gain){
    let l=row.level||1,x=(row.xp||0)+gain,up=0;
    while(x>=xpToNext(l)){x-=xpToNext(l);l++;up++;}
    return {level:l,xp:x,up};
  }
  function awardCreated(){
    if(!ME||!ME.sb_uid)return;
    xpQueue(async()=>{
      const row=await levelRow();
      if(!row||row.gamification_enabled===false)return;
      const before=earnedKeys(), r=gainLevels(row,XP_CREATE);
      const patch={level:r.level,xp:r.xp,updated_at:new Date().toISOString()};
      await TF.rest(`user_levels?user_id=eq.${ME.sb_uid}`,{method:'PATCH',body:patch});
      GAME.row={...row,...patch};
      xpLanded(XP_CREATE,r.up,[]);announceRanks(before);
    });
  }
  /* base XP by complexity, plus TaskFlow's bonuses: critical cleared, queue
     (in-progress) completion, first of the day and the personal streak */
  function awardCompleted(task){
    if(!ME||!ME.sb_uid||!task)return;
    xpQueue(async()=>{
      const row=await levelRow();
      if(!row||row.gamification_enabled===false)return;
      const today=ymdLocal(new Date()), y=new Date();y.setDate(y.getDate()-1);
      const bonuses=[];let bonus=0;
      const add=(label,xp)=>{bonus+=xp;bonuses.push({label,xp});};
      if(task.roi==='critical'||task.status==='critical')add('Critical cleared',XP_BONUS.critical);
      if(task.status==='in_progress')add('Queue completion',XP_BONUS.queue);
      let streak=row.streak||0, last=row.last_completed_date||null;
      if(row.last_completed_date!==today){
        add('First task of the day',XP_BONUS.firstOfDay);
        streak=row.last_completed_date===ymdLocal(y)?(row.streak||0)+1:1;
        add(`${streak}-day streak`,Math.min(XP_BONUS.streakMax,streak*XP_BONUS.streakPerDay));
        last=today;
      }
      const gain=(XP_DONE[task.complexity]||XP_DONE.medium)+bonus;
      const before=earnedKeys(), r=gainLevels(row,gain);
      const patch={level:r.level,xp:r.xp,last_completed_date:last,streak,
        tasks_completed:(row.tasks_completed||0)+1,updated_at:new Date().toISOString()};
      await TF.rest(`user_levels?user_id=eq.${ME.sb_uid}`,{method:'PATCH',body:patch});
      GAME.row={...row,...patch};
      xpLanded(gain,r.up,bonuses);announceRanks(before);
      gSpecial(true);
    });
  }
  /* the team activity streak: create or complete, counted once a day server-side */
  function bumpStreak(){
    if(!TFS.team)return;
    TF.rpc('bump_streak',{p_team_id:TFS.team,p_today:ymdLocal(new Date())}).catch(()=>{});
  }

  /* ================= the + button: add anything ================= */
  const addBtn=$('.radd'), addMenu=$('.addmenu');
  function openAddMenu(){
    if(typeof closeMeMenu==='function')closeMeMenu();
    addMenu.classList.add('show');addBtn.classList.add('openm');addBtn.setAttribute('aria-expanded','true');
    setTimeout(()=>{const f=addMenu.querySelector('.am-it');if(f&&matchMedia('(pointer:fine)').matches)f.focus({preventScroll:true});},30);
  }
  function closeAddMenu(){
    addMenu.classList.remove('show');addBtn.classList.remove('openm');addBtn.setAttribute('aria-expanded','false');
  }
  addBtn.onclick=e=>{e.stopPropagation();addMenu.classList.contains('show')?closeAddMenu():openAddMenu();};
  panel.addEventListener('click',e=>{
    const p=e.composedPath();
    if(addMenu.classList.contains('show')&&!p.includes(addMenu)&&!p.includes(addBtn))closeAddMenu();
  });
  document.addEventListener('keydown',e=>{
    if(e.key!=='Escape')return;
    if(addMenu.classList.contains('show')){closeAddMenu();addBtn.focus();e.stopImmediatePropagation();}
  },true);
  addMenu.addEventListener('click',e=>{
    const it=e.composedPath().find(n=>n.dataset&&n.dataset.add);if(!it)return;
    closeAddMenu();
    if(!ME||!TF_READY)return;
    const kind=it.dataset.add;
    if(kind==='task'){openTaskForm({page:HERE_URL});return;}
    if(kind==='context'){openContext();return;}
    if(view!==kind)switchView(kind);
    tfBody.scrollTop=0;
    if(kind==='golive'){
      gv.editing=null;gv.adding={page:HERE_URL,description:'',files:'',err:'',busy:false};renderGoLive(false);
      setTimeout(()=>{const n=tfBody.querySelector('[data-gf="description"]');if(n)n.focus();},60);
    }else if(kind==='review'){rv.note=null;rvOpenSubmit();}
  });

  /* ---- save context: TaskFlow's quick "something worth remembering" ---- */
  const ctxBox=$('.ctxsheet'), ctxSub=$('.ctxsub'), ctxDesc=$('.ctxdesc'), ctxErr=$('.ctxerr'), ctxSave=$('.ctxsave');
  function openContext(){
    if(!ME||!TFS.team){toast('Join a TaskFlow team first.');return;}
    ctxSub.value='';ctxDesc.value='';ctxErr.hidden=true;
    ctxSave.disabled=false;ctxSave.textContent='Save';
    if(!isOpen)open();
    ctxBox.classList.add('show');
    setTimeout(()=>ctxSub.focus(),40);
  }
  const closeContext=()=>ctxBox.classList.remove('show');
  async function saveContext(){
    const subject=ctxSub.value.trim();
    if(!subject){ctxErr.textContent='Give it a subject so it can be found later.';ctxErr.hidden=false;ctxSub.focus();return;}
    if(ctxSave.disabled)return;
    ctxSave.disabled=true;ctxSave.textContent='Saving…';ctxErr.hidden=true;
    try{
      await TF.rest('context_entries',{method:'POST',body:{team_id:TFS.team,created_by:ME.sb_uid,subject,
        description:ctxDesc.value.trim(),updated_at:new Date().toISOString()}});
      closeContext();toast('Saved to Context in TaskFlow.');
    }catch(e){
      ctxSave.disabled=false;ctxSave.textContent='Save';
      ctxErr.textContent=e.status===404||/does not exist|schema cache|relation/i.test(e.message||'')
        ?'Context isn’t set up in this TaskFlow yet (supabase-context-migration.sql).'
        :(e.message||'Could not save to TaskFlow.');
      ctxErr.hidden=false;
    }
  }
  ctxSave.onclick=saveContext;
  $('.ctxcancel').onclick=closeContext;
  ctxBox.addEventListener('click',e=>{if(e.target===ctxBox)closeContext();});
  ctxSub.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();saveContext();}});
  ctxDesc.addEventListener('keydown',e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))saveContext();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&ctxBox.classList.contains('show'))closeContext();});

  /* ================= scans from the phone =================
     When a notebook scan is logged in TaskFlow on a phone, TaskFlow
     broadcasts it on the person's own Realtime channel (scan-<user id>,
     src/lib/scanBroadcast.js there). The panel listens on a plain websocket
     (there's no supabase-js here), shows a notice even with the panel shut,
     and refreshes tasks and XP behind it. */
  const SCAN={ws:null,uid:'',ref:0,beat:null,retry:null,tries:0};
  const scanEl=$('.scannote');
  let scanHide=null;
  function scanClose(){
    clearTimeout(SCAN.retry);clearInterval(SCAN.beat);
    const ws=SCAN.ws;SCAN.ws=null;SCAN.uid='';
    if(ws)try{ws.close();}catch(e){}
  }
  function scanConnect(){
    scanClose();
    if(!ME||!ME.sb_uid||!TF_READY||typeof WebSocket!=='function')return;
    const uid=SCAN.uid=ME.sb_uid, topic='realtime:scan-'+uid;
    TF.fresh().then(tok=>{
      if(!tok||SCAN.uid!==uid||SCAN.ws)return;
      let ws;
      try{ws=new WebSocket(SB_URL.replace(/^http/,'ws')+'/realtime/v1/websocket?apikey='+encodeURIComponent(SB_ANON)+'&vsn=1.0.0');}
      catch(e){return;}
      SCAN.ws=ws;
      const send=(t,event,payload)=>{
        try{ws.send(JSON.stringify({topic:t,event,payload,ref:String(++SCAN.ref),join_ref:t===topic?'1':undefined}));}catch(e){}
      };
      ws.onopen=()=>{
        SCAN.tries=0;
        send(topic,'phx_join',{config:{broadcast:{ack:false,self:false},presence:{key:''},postgres_changes:[],private:false},access_token:tok});
        /* heartbeat, and hand over a refreshed token before the old one lapses */
        SCAN.beat=setInterval(()=>{
          send('phoenix','heartbeat',{});
          TF.fresh().then(t=>{if(t&&t!==tok){tok=t;send(topic,'access_token',{access_token:t});}}).catch(()=>{});
        },25000);
      };
      ws.onmessage=e=>{
        let m;try{m=JSON.parse(e.data);}catch(_){return;}
        if(!m||m.topic!==topic)return;
        if(m.event==='broadcast'&&m.payload&&m.payload.event==='scanned')onScan(m.payload.payload);
        else if(m.event==='phx_reply'&&m.payload&&m.payload.status==='error')try{ws.close();}catch(_){}
      };
      ws.onclose=()=>{
        clearInterval(SCAN.beat);
        if(SCAN.ws!==ws)return;   /* closed on purpose */
        SCAN.ws=null;
        if(ME&&ME.sb_uid===uid)SCAN.retry=setTimeout(scanConnect,Math.min(60000,2000*Math.pow(2,SCAN.tries++)));
      };
    }).catch(()=>{});
  }
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&ME&&ME.sb_uid&&!SCAN.ws)scanConnect();
  });
  const hideScanNote=()=>{clearTimeout(scanHide);scanEl.classList.remove('show');};
  function onScan(p){
    const n=p?+p.count:0;
    if(!(n>0))return;
    const sample=(Array.isArray(p.sample)?p.sample:[]).map(s=>String(s)).slice(0,3), more=n-sample.length;
    const title=`Scan added ${n} task${n===1?'':'s'}`;
    scanEl.innerHTML=`<span class="sn-ico"><svg viewBox="0 0 24 24"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></span>`
      +`<span class="sn-body"><b>${escHtml(title)}</b>${sample.length?`<span class="sn-sub">${escHtml(sample.join(' · '))}${more>0?` · +${more} more`:''}</span>`:''}</span>`
      +`<button class="sn-view" type="button">View</button>`
      +`<button class="sn-x" type="button" aria-label="Dismiss"><svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button>`;
    scanEl.classList.remove('show');void scanEl.offsetWidth;scanEl.classList.add('show');
    const arm=()=>{clearTimeout(scanHide);scanHide=setTimeout(hideScanNote,9000);};
    arm();
    scanEl.onmouseenter=()=>clearTimeout(scanHide);
    scanEl.onmouseleave=arm;
    scanEl.querySelector('.sn-x').onclick=hideScanNote;
    /* View: the panel's Tasks, on Done, where the scanned lines now sit */
    scanEl.querySelector('.sn-view').onclick=()=>{
      hideScanNote();
      if(!isOpen)open();
      tv.open=tv.form=null;tv.status='done';TFS.done=null;tfBar.dataset.sig='';
      if(view==='tasks')renderTf(true);else switchView('tasks');
    };
    if(document.hidden&&notif().on)showBrowserNotif(title,sample.join(' · '),'');
    if(TFS.team)tfLoadAll();
    setTimeout(gLoad,2000);   /* the phone awards the XP in the background */
  }

  /* keep TaskFlow fresh: while the panel is open, and every few minutes otherwise */
  setInterval(()=>{
    if(ME&&TFS.team&&!document.hidden&&(isOpen||Date.now()-TFS.at>180000))tfLoadAll();
  },45000);
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden&&ME&&TFS.team&&Date.now()-TFS.at>30000)tfLoadAll();
  });

  /* ================= boot ================= */
  applyLook();   /* the cached TaskFlow look, before anything paints */
  setAuthed(null);
  if(TF.has()){
    /* fresh: re-read the TaskFlow profile so a new name or photo shows at once */
    api('dc_me',{fresh:1}).then(j=>{
      if(j&&j.success){setAuthed(j.data.user);tfAfterLogin();}
      else if(j&&j.data&&(j.data.code==='auth'||j.data.code==='team')){
        TF.signOut(true);
        if(j.data.code==='team')toast(j.data.msg);
      }
    }).catch(()=>{}).finally(loadAll);
  }else{
    loadAll();
  }
  longPoll();
  setInterval(loadAll,30000); /* safety net */
})();
</script>
        <?php
    }

    /* ==================== WP admin screen ==================== */

    public static function admin_menu() {
        add_menu_page(
            'Dev Comments', 'Dev Comments', 'manage_options', 'dev-comments',
            [__CLASS__, 'admin_page'], 'dashicons-format-chat', 26
        );
    }

    /* The dashboard wears the panel's design in a light theme: same type,
       spacing, rounded surfaces and accent, so the two read as one product. */
    public static function admin_styles() {
        $screen = function_exists('get_current_screen') ? get_current_screen() : null;
        if (!$screen || strpos($screen->id, 'dev-comments') === false) return;
        ?>
<style id="dc-admin-skin">
/* full-bleed: WP's wrap gutters and the admin notice column are removed so the
   screen reads as its own app rather than a page inside the dashboard */
#wpcontent{padding-left:0!important}
#wpbody-content{padding-bottom:0!important}
#wpfooter{display:none}
.dc-skin .notice,.dc-skin .updated,.dc-skin .error{display:none!important}
#wpbody-content>.notice,#wpbody-content>.updated,#wpbody-content>.error{display:none!important}
.dc-skin{
  --ink:#16181b; --ink-soft:#3f454c; --dim:#697079; --faint:#949aa2;
  --line:#e6e9ec; --line-strong:#d4d9de; --surface:#fff; --surface2:#f3f5f7;
  --bg:#f5f6f8; --acc:#1f6f43; --acc-soft:#eaf6ef; --heart:#c2483f;
  --r-sm:7px; --r-md:10px; --r-lg:14px;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
  color:var(--ink); margin:0!important; width:100%; max-width:none;
  background:var(--bg); min-height:calc(100vh - 32px);
  display:flex; flex-direction:column;
}
.dc-skin *{box-sizing:border-box}
.dc-skin a{text-decoration:none}

/* sticky app header, same shape as the panel's */
.dc-skin .dc-top{position:sticky;top:32px;z-index:20;background:rgba(255,255,255,.86);
  backdrop-filter:blur(14px) saturate(1.1);border-bottom:1px solid var(--line);
  padding:16px 28px 0}
.dc-skin .dc-topin{display:flex;align-items:center;gap:14px;flex-wrap:wrap}
.dc-skin h1.dc-title{display:flex;align-items:center;gap:11px;margin:0;padding:0;
  font-size:20px;font-weight:650;letter-spacing:-.015em;color:var(--ink)}
.dc-skin h1.dc-title .dc-logo{width:30px;height:30px;border-radius:9px;display:flex;
  align-items:center;justify-content:center;background:var(--ink);color:#fff;flex:none}
.dc-skin h1.dc-title .dc-logo svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2}
.dc-skin .dc-sub{margin:0;font-size:12.5px;color:var(--dim)}
.dc-skin .dc-spacer{flex:1}
.dc-skin .dc-tabs{display:inline-flex;gap:2px;padding:3px;margin:14px 0 0;
  background:var(--surface2);border:1px solid var(--line);border-radius:var(--r-md)}
.dc-skin .dc-tabs a{padding:7px 20px;border-radius:calc(var(--r-md) - 3px);
  font-size:12.5px;font-weight:600;color:var(--dim);transition:color .15s,background-color .15s}
.dc-skin .dc-tabs a:hover{color:var(--ink-soft)}
.dc-skin .dc-tabs a.on{color:var(--ink);background:var(--surface);box-shadow:0 1px 3px rgba(0,0,0,.1)}

/* body */
.dc-skin .dc-body{flex:1;padding:22px 28px 40px}
.dc-skin .dc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));
  gap:12px;margin:0 0 20px}
.dc-skin .dc-stat{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-md);
  padding:14px 16px}
.dc-skin .dc-stat b{display:block;font-size:22px;font-weight:650;letter-spacing:-.02em;line-height:1.2}
.dc-skin .dc-stat span{font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)}

.dc-skin .dc-card{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);
  box-shadow:0 1px 2px rgba(16,24,40,.05);overflow:hidden;margin:0 0 18px}
.dc-skin .dc-card-head{display:flex;align-items:center;gap:12px;padding:14px 18px;
  border-bottom:1px solid var(--line);background:linear-gradient(#fff,#fcfcfd)}
.dc-skin .dc-card-head h2{flex:1;margin:0;padding:0;font-size:13.5px;font-weight:650;color:var(--ink)}
.dc-skin .dc-count{font-size:11px;font-weight:600;color:var(--dim);background:var(--surface2);
  border:1px solid var(--line);padding:2px 9px;border-radius:9px}
.dc-skin .dc-card-body{padding:18px}

/* tables fill the card */
.dc-skin table.dc-table{width:100%;border-collapse:collapse;font-size:13px;table-layout:auto}
.dc-skin table.dc-table th{text-align:left;padding:10px 18px;font-size:10.5px;font-weight:650;
  letter-spacing:.06em;text-transform:uppercase;color:var(--faint);
  background:var(--surface2);border-bottom:1px solid var(--line);white-space:nowrap}
.dc-skin table.dc-table td{padding:13px 18px;border-bottom:1px solid var(--line);
  color:var(--ink-soft);vertical-align:middle}
.dc-skin table.dc-table tr:last-child td{border-bottom:0}
.dc-skin table.dc-table tbody tr{transition:background-color .12s}
.dc-skin table.dc-table tbody tr:hover{background:#fafbfc}
.dc-skin .dc-name{font-weight:600;color:var(--ink)}
.dc-skin .dc-muted{color:var(--faint)}
.dc-skin .dc-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px}
.dc-skin .dc-body-cell{max-width:none;line-height:1.55;color:var(--ink-soft)}

.dc-skin .dc-pill{display:inline-block;padding:2px 9px;border-radius:9px;font-size:11px;font-weight:600}
.dc-skin .dc-pill.mod{color:#14602f;background:var(--acc-soft);border:1px solid #c3e5d1}
.dc-skin .dc-pill.member{color:var(--dim);background:var(--surface2);border:1px solid var(--line)}

.dc-skin .button,.dc-skin button.button{border-radius:var(--r-sm)!important;
  border:1px solid var(--line-strong)!important;background:var(--surface)!important;
  color:var(--ink-soft)!important;font-size:12px!important;font-weight:500!important;
  height:auto!important;padding:6px 12px!important;line-height:1.4!important;
  box-shadow:none!important;transition:background-color .15s,border-color .15s,color .15s}
.dc-skin .button:hover{background:var(--surface2)!important;color:var(--ink)!important;border-color:var(--dim)!important}
.dc-skin .button-primary{background:var(--ink)!important;border-color:var(--ink)!important;color:#fff!important}
.dc-skin .button-primary:hover{background:#000!important;color:#fff!important;border-color:#000!important}
.dc-skin .dc-danger .button:hover{color:var(--heart)!important;border-color:var(--heart)!important;background:#fdf3f2!important}
.dc-skin form{display:inline}
.dc-skin .dc-actions{display:flex;flex-wrap:wrap;gap:6px;align-items:center}

.dc-skin input[type=text],.dc-skin input[type=email],.dc-skin input[type=url],
.dc-skin input[type=password],.dc-skin select,.dc-skin textarea{
  border-radius:var(--r-sm);border:1px solid var(--line-strong);padding:7px 10px;font-size:13px;
  color:var(--ink);background:var(--surface);box-shadow:none;min-height:0;width:100%}
.dc-skin input:focus,.dc-skin select:focus,.dc-skin textarea:focus{
  border-color:var(--ink);box-shadow:0 0 0 3px rgba(22,24,27,.08);outline:0}
.dc-skin .dc-field{display:flex;flex-direction:column;gap:5px;min-width:190px}
.dc-skin .dc-field label{font-size:11px;font-weight:600;color:var(--dim)}
.dc-skin .dc-row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}

.dc-skin .dc-note{display:flex;align-items:center;gap:9px;padding:11px 14px;margin:0 0 18px;
  font-size:13px;color:#14602f;background:var(--acc-soft);border:1px solid #c3e5d1;border-radius:var(--r-md)}
.dc-skin .dc-ava{width:30px;height:30px;border-radius:9px;object-fit:cover;display:block;border:1px solid var(--line)}
.dc-skin .dc-ava-fallback{width:30px;height:30px;border-radius:9px;display:flex;align-items:center;
  justify-content:center;font-size:12px;font-weight:650;color:#fff;background:var(--dim)}
.dc-skin .dc-empty{padding:34px 0;text-align:center;color:var(--faint);font-size:13px}
.dc-skin .description{color:var(--faint);font-size:12px}
@media (max-width:782px){.dc-skin .dc-top{top:46px;padding:14px 16px 0}.dc-skin .dc-body{padding:18px 16px 32px}}
</style>
        <?php
    }

    private static function admin_redirect($notice) {
        wp_safe_redirect(add_query_arg([
            'page'    => 'dev-comments',
            'tab'     => sanitize_key($_POST['tab'] ?? 'comments'),
            'dc_note' => rawurlencode($notice),
        ], admin_url('admin.php')));
        exit;
    }

    public static function admin_handle() {
        if (!current_user_can('manage_options')) wp_die('Not allowed.');
        check_admin_referer('dc_admin');
        global $wpdb;
        $do = sanitize_key($_POST['do'] ?? '');

        if ($do === 'toggle_mod') {
            $id = absint($_POST['id'] ?? 0);
            $cur = $wpdb->get_var($wpdb->prepare("SELECT is_admin FROM " . self::$users . " WHERE id = %d", $id));
            if ($cur === null) self::admin_redirect('Account not found.');
            $new = $cur ? 0 : 1;
            $wpdb->update(self::$users, ['is_admin' => $new], ['id' => $id]);
            $name = $wpdb->get_var($wpdb->prepare("SELECT name FROM " . self::$users . " WHERE id = %d", $id));
            self::admin_redirect($new
                ? $name . ' is now a moderator and can edit or delete any comment.'
                : $name . ' is no longer a moderator.');
        }

        /* TaskFlow connection: Supabase project URL + public (anon) key, the
           team this site belongs to, and where the TaskFlow app lives */
        if ($do === 'tf_connect') {
            $url  = rtrim(esc_url_raw(trim((string) wp_unslash($_POST['sb_url'] ?? ''))), '/');
            $anon = preg_replace('/\s+/', '', (string) wp_unslash($_POST['sb_anon'] ?? ''));
            if ($url !== '' && strpos($url, 'https://') !== 0) self::admin_redirect('The Supabase URL must start with https://');
            if ($anon !== '') {
                if (!preg_match('/^[A-Za-z0-9\-_\.]+$/', $anon)) self::admin_redirect('That key has characters a Supabase key never has.');
                /* this key is printed into every page, so a secret one would hand
                   out full database access: refuse it outright */
                $role = '';
                $parts = explode('.', $anon);
                if (count($parts) === 3) {
                    $b = strtr($parts[1], '-_', '+/');
                    $j = json_decode((string) base64_decode($b . str_repeat('=', (4 - strlen($b) % 4) % 4)), true);
                    $role = is_array($j) ? (string) ($j['role'] ?? '') : '';
                }
                if ($role === 'service_role' || strpos($anon, 'sb_secret_') === 0)
                    self::admin_redirect('That is the SECRET service key. Use the anon / publishable key — this one is visible in the page source.');
            }
            $team = preg_replace('/[^a-f0-9\-]/i', '', (string) wp_unslash($_POST['sb_team_manual'] ?? ''));
            if ($team === '') $team = preg_replace('/[^a-f0-9\-]/i', '', (string) wp_unslash($_POST['sb_team'] ?? ''));
            $app = trim((string) wp_unslash($_POST['tf_url'] ?? ''));
            update_option('dc_sb_url', $url);
            update_option('dc_sb_anon', $anon);
            update_option('dc_sb_team', $team);
            update_option('dc_taskflow_url', $app === '' ? '' : esc_url_raw($app));
            self::admin_redirect(self::sb_ready() ? 'TaskFlow connection saved.' : 'Saved. Add both the URL and the key to switch sign-in on.');
        }

        if ($do === 'tf_test') {
            if (!self::sb_ready()) self::admin_redirect('Add the Supabase URL and key first.');
            $res = wp_remote_get(self::sb_url() . '/auth/v1/settings', ['timeout' => 8, 'headers' => ['apikey' => self::sb_anon()]]);
            if (is_wp_error($res)) self::admin_redirect('Couldn\'t reach Supabase: ' . $res->get_error_message());
            $code = (int) wp_remote_retrieve_response_code($res);
            self::admin_redirect($code === 200
                ? 'Connected. TaskFlow accounts can sign in to the panel.'
                : 'Supabase answered ' . $code . ' — check the URL and that the key is this project\'s anon key.');
        }

        if ($do === 'del_user') {
            $id = absint($_POST['id'] ?? 0);
            if ($id) {
                $wpdb->delete(self::$users, ['id' => $id]);
                if (!empty($_POST['wipe'])) $wpdb->delete(self::$table, ['user_id' => $id]);
                self::bump_version();
            }
            self::admin_redirect('Account deleted.');
        }


        if ($do === 'del_comment') {
            $id = absint($_POST['id'] ?? 0);
            $wpdb->delete(self::$table, ['id' => $id]);
            self::bump_version();
            self::admin_redirect('Comment deleted.');
        }

        if ($do === 'tenor') {
            update_option('dc_klipy_key', sanitize_text_field(wp_unslash($_POST['key'] ?? '')));
            self::admin_redirect('GIF key saved.');
        }


        if ($do === 'del_context') {
            $ctx = sanitize_text_field(wp_unslash($_POST['context'] ?? ''));
            $wpdb->delete(self::$table, ['context' => $ctx]);
            self::bump_version();
            self::admin_redirect('All comments on ' . $ctx . ' deleted.');
        }

        self::admin_redirect('Nothing to do.');
    }

    private static function admin_form($fields, $label, $class = '', $confirm = '') {
        $out  = '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '" style="display:inline">';
        $out .= wp_nonce_field('dc_admin', '_wpnonce', true, false);
        $out .= '<input type="hidden" name="action" value="dc_admin">';
        foreach ($fields as $k => $v)
            $out .= '<input type="hidden" name="' . esc_attr($k) . '" value="' . esc_attr($v) . '">';
        $out .= '<button class="button ' . esc_attr($class) . '"'
              . ($confirm ? ' onclick="return confirm(\'' . esc_attr($confirm) . '\')"' : '')
              . '>' . esc_html($label) . '</button></form>';
        return $out;
    }

    public static function admin_page() {
        if (!current_user_can('manage_options')) return;
        global $wpdb;
        $tab = sanitize_key($_GET['tab'] ?? 'comments');

        $users = [];
        foreach ($wpdb->get_results("SELECT * FROM " . self::$users . " ORDER BY created_at ASC", ARRAY_A) as $u)
            $users[(int) $u['id']] = $u;
        $n_comments = (int) $wpdb->get_var("SELECT COUNT(*) FROM " . self::$table);
        $n_places   = (int) $wpdb->get_var("SELECT COUNT(DISTINCT context) FROM " . self::$table);
        $n_pins     = (int) $wpdb->get_var("SELECT COUNT(*) FROM " . self::$table . " WHERE content LIKE '%[pin]%'");

        echo '<div class="wrap dc-skin">';
        echo '<div class="dc-top"><div class="dc-topin">'
           . '<h1 class="dc-title"><span class="dc-logo">'
           . '<svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>'
           . '</span>Dev Comments</h1>'
           . '<span class="dc-spacer"></span>'
           . '<p class="dc-sub">TaskFlow on the dev site: comments, tasks, Go Live and review.</p>'
           . '</div>';

        $tabs = ['comments' => 'Comments', 'users' => 'People', 'taskflow' => 'TaskFlow'];
        echo '<div class="dc-tabs">';
        foreach ($tabs as $k => $label)
            printf('<a href="%s" class="%s">%s</a>',
                esc_url(admin_url('admin.php?page=dev-comments&tab=' . $k)),
                $tab === $k ? 'on' : '', esc_html($label));
        echo '</div></div>';

        echo '<div class="dc-body">';
        if (!empty($_GET['dc_note']))
            echo '<div class="dc-note">'
               . '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 13 4 4L19 7"/></svg>'
               . esc_html(rawurldecode($_GET['dc_note'])) . '</div>';

        echo '<div class="dc-stats">'
           . '<div class="dc-stat"><b>' . $n_comments . '</b><span>Comments</span></div>'
           . '<div class="dc-stat"><b>' . $n_places . '</b><span>Pages with feedback</span></div>'
           . '<div class="dc-stat"><b>' . $n_pins . '</b><span>Pinned to an element</span></div>'
           . '<div class="dc-stat"><b>' . count($users) . '</b><span>Accounts</span></div>'
           . '</div>';

        if (!self::sb_ready() && $tab !== 'taskflow')
            echo '<div class="dc-note" style="color:#8a5a00;background:#fff7e6;border-color:#f3d9a4">'
               . 'TaskFlow isn\'t connected, so nobody can sign in to the panel yet. '
               . '<a href="' . esc_url(admin_url('admin.php?page=dev-comments&tab=taskflow')) . '">Add the Supabase keys</a>.</div>';

        if ($tab === 'users') self::admin_users_tab($users);
        elseif ($tab === 'taskflow') self::admin_taskflow_tab();
        else self::admin_comments_tab($users);

        echo '</div></div>';
    }

    private static function admin_users_tab($users) {
        global $wpdb;
        $counts = [];
        foreach ($wpdb->get_results("SELECT user_id, COUNT(*) c FROM " . self::$table . " GROUP BY user_id", ARRAY_A) as $r)
            $counts[(int) $r['user_id']] = (int) $r['c'];

        echo '<div class="dc-card"><div class="dc-card-head"><h2>People</h2>'
           . '<span class="dc-count">' . count($users) . '</span></div>';
        echo '<div class="dc-card-body" style="padding:12px 18px;border-bottom:1px solid var(--line)"><p class="description" style="margin:0">'
           . 'Everyone signs in with their TaskFlow account; a row appears here the first time they do. '
           . 'Names and photos come from TaskFlow. Owners and admins of the site\'s TaskFlow team moderate automatically; '
           . 'you can also make anyone a moderator here.</p></div>';
        echo '<table class="dc-table"><thead><tr>'
           . '<th style="width:60px"></th><th>Name</th><th>Email</th>'
           . '<th style="width:110px">TaskFlow</th><th style="width:80px">Comments</th>'
           . '<th style="width:150px">Role</th><th style="width:150px">First seen</th>'
           . '<th style="width:250px">Actions</th></tr></thead><tbody>';

        foreach ($users as $u) {
            $st  = json_decode($u['settings'], true) ?: [];
            $tf  = json_decode($u['tf_profile'] ?? '', true) ?: [];
            $av  = !empty($st['avatar']) ? $st['avatar'] : ($tf['avatar'] ?? '');
            $col = !empty($tf['color']) ? $tf['color'] : '#888888';
            $linked = !empty($u['sb_uid']);
            $wpmod  = !empty($u['is_admin']);
            $tfrole = $u['tf_role'] ?? '';
            echo '<tr>';
            echo '<td>' . ($av
                ? '<img class="dc-ava" src="' . esc_url($av) . '" alt="">'
                : '<span class="dc-ava-fallback" style="background:' . esc_attr($col) . '">'
                  . esc_html(mb_strtoupper(mb_substr($u['name'], 0, 1))) . '</span>') . '</td>';
            echo '<td><span class="dc-name">' . esc_html($u['name']) . '</span><br><span class="dc-muted">ID ' . (int) $u['id'] . '</span></td>';
            echo '<td>' . esc_html(strpos($u['email'], 'replaced-') === 0 || strpos($u['email'], 'sb-') === 0 ? '—' : $u['email']) . '</td>';
            echo '<td>' . ($linked
                ? '<span class="dc-pill mod">Linked</span>'
                : '<span class="dc-pill member" title="An account from before TaskFlow sign-in. It is adopted automatically when someone signs in with the same email.">Old account</span>') . '</td>';
            echo '<td>' . (int) ($counts[(int) $u['id']] ?? 0) . '</td>';
            echo '<td>';
            if (in_array($tfrole, ['owner', 'admin'], true)) echo '<span class="dc-pill mod">TaskFlow ' . esc_html($tfrole) . '</span> ';
            if ($wpmod) echo '<span class="dc-pill mod">Moderator</span>';
            if (!$wpmod && !in_array($tfrole, ['owner', 'admin'], true)) echo '<span class="dc-pill member">Member</span>';
            echo '</td>';
            echo '<td>' . esc_html(mysql2date('M j, Y g:ia', $u['created_at'])) . '</td>';
            echo '<td><div class="dc-actions">'
               . self::admin_form(
                   ['do' => 'toggle_mod', 'id' => $u['id'], 'tab' => 'users'],
                   $wpmod ? 'Revoke moderator' : 'Make moderator',
                   $wpmod ? '' : 'button-primary',
                   $wpmod ? '' : 'Moderators can edit and delete anyone\'s comments. Continue?')
               . '<span class="dc-danger">'
               . self::admin_form(['do' => 'del_user', 'id' => $u['id'], 'wipe' => 1, 'tab' => 'users'], 'Remove + comments', '',
                   'Remove this person and ALL of their comments here? Their TaskFlow account is not touched, and they can still sign in again.')
               . '</span></div></td></tr>';
        }
        if (!$users) echo '<tr><td colspan="8"><div class="dc-empty">Nobody has signed in yet.</div></td></tr>';
        echo '</tbody></table></div>';
    }

    private static function admin_taskflow_tab() {
        $seen = get_option('dc_sb_teams_seen', []);
        if (!is_array($seen)) $seen = [];
        $lock = self::team_lock();
        $anon = self::sb_anon();

        echo '<div class="dc-card"><div class="dc-card-head"><h2>Connection</h2>'
           . (self::sb_ready() ? '<span class="dc-pill mod">Connected</span>' : '<span class="dc-pill member">Not connected</span>')
           . '</div><div class="dc-card-body">';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('dc_admin');
        echo '<input type="hidden" name="action" value="dc_admin"><input type="hidden" name="do" value="tf_connect">'
           . '<input type="hidden" name="tab" value="taskflow">'
           . '<div class="dc-row">'
           . '<div class="dc-field" style="flex:1;min-width:300px"><label>Supabase project URL</label>'
           . '<input type="url" name="sb_url" value="' . esc_attr(self::sb_url()) . '" placeholder="https://abcdefgh.supabase.co"></div>'
           . '</div><div class="dc-row" style="margin-top:12px">'
           . '<div class="dc-field" style="flex:1;min-width:300px"><label>Supabase anon / publishable key</label>'
           . '<input type="text" name="sb_anon" value="' . esc_attr($anon) . '" placeholder="eyJhbGciOi… or sb_publishable_…" autocomplete="off" spellcheck="false" class="dc-mono"></div>'
           . '</div>'
           . '<p class="description" style="margin:8px 0 0">Both are in Supabase under <b>Project Settings → API</b> — the same values as '
           . '<code>REACT_APP_SUPABASE_URL</code> and <code>REACT_APP_SUPABASE_ANON_KEY</code> in TaskFlow\'s <code>.env</code>. '
           . 'Use the <b>anon</b> key, never the service_role / secret key: this one is sent to every visitor\'s browser, which is safe '
           . 'because TaskFlow\'s row-level security only lets each person see their own team\'s data.</p>';

        echo '<div class="dc-row" style="margin-top:18px">'
           . '<div class="dc-field" style="min-width:260px"><label>Team this site belongs to</label><select name="sb_team">'
           . '<option value="">Any team (each person uses their own)</option>';
        foreach ($seen as $id => $name)
            echo '<option value="' . esc_attr($id) . '"' . selected($lock, $id, false) . '>' . esc_html($name) . '</option>';
        if ($lock !== '' && !isset($seen[$lock]))
            echo '<option value="' . esc_attr($lock) . '" selected>' . esc_html($lock) . '</option>';
        echo '</select></div>'
           . '<div class="dc-field" style="flex:1;min-width:260px"><label>…or paste a team ID</label>'
           . '<input type="text" name="sb_team_manual" value="" placeholder="uuid from the teams table" class="dc-mono"></div></div>'
           . '<p class="description" style="margin:8px 0 0">Locking to a team means only its members can sign in here, tasks and Go Live go to that team, '
           . 'and its owners/admins moderate comments. Teams appear in the list once one of their members has signed in.</p>';

        echo '<div class="dc-row" style="margin-top:18px"><div class="dc-field" style="flex:1;min-width:320px">'
           . '<label>TaskFlow app URL</label>'
           . '<input type="url" name="tf_url" value="' . esc_attr(self::taskflow_url()) . '" placeholder="' . esc_attr(self::TASKFLOW_DEFAULT) . '"></div></div>'
           . '<p class="description" style="margin:8px 0 0">Used for “Open in TaskFlow”, the sign-up link and, when someone isn\'t signed in, the Task button\'s old open-in-a-new-tab behaviour. Leave blank to hide those links.</p>';

        echo '<div class="dc-row" style="margin-top:18px"><button class="button button-primary">Save</button></div></form>';
        echo '<div style="margin-top:10px">' . self::admin_form(['do' => 'tf_test', 'tab' => 'taskflow'], 'Test connection') . '</div>';
        echo '</div></div>';

        echo '<div class="dc-card"><div class="dc-card-head"><h2>GIF search</h2></div><div class="dc-card-body">';
        echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
        wp_nonce_field('dc_admin');
        echo '<input type="hidden" name="action" value="dc_admin"><input type="hidden" name="do" value="tenor">'
           . '<input type="hidden" name="tab" value="taskflow">'
           . '<div class="dc-row"><div class="dc-field" style="flex:1;min-width:320px">'
           . '<label>KLIPY API key</label>'
           . '<input type="text" name="key" value="' . esc_attr(get_option('dc_klipy_key', ''))
           . '" placeholder="Paste a KLIPY key"></div>'
           . '<button class="button button-primary">Save</button></div>'
           . '<p class="description" style="margin:10px 0 0">Free key from <a href="https://partner.klipy.com" target="_blank">partner.klipy.com</a>. '
           . 'With a key set, a GIF button appears in the comment box; leave blank to hide it. '
           . '(Google shut the Tenor API down on 30 June 2026, so KLIPY is the provider here.)</p>'
           . '</form></div></div>';
    }

    private static function admin_comments_tab($users) {
        global $wpdb;
        $rows = $wpdb->get_results("SELECT * FROM " . self::$table . " ORDER BY context ASC, created_at ASC", ARRAY_A);
        $by_ctx = [];
        foreach ($rows as $r) $by_ctx[$r['context']][] = $r;

        if (!$rows) { echo '<div class="dc-card"><div class="dc-empty">No comments yet.</div></div>'; return; }

        foreach ($by_ctx as $ctx => $list) {
            $label = $ctx === 'general' ? 'General chat' : $ctx;
            echo '<div class="dc-card"><div class="dc-card-head">'
               . '<h2>' . esc_html($label) . '</h2>'
               . '<span class="dc-count">' . count($list) . '</span>'
               . '<div class="dc-actions">';
            if ($ctx !== 'general')
                echo '<a href="' . esc_url(home_url($ctx)) . '" target="_blank" class="button">View page</a>';
            echo '<span class="dc-danger">'
               . self::admin_form(['do' => 'del_context', 'context' => $ctx, 'tab' => 'comments'],
                   'Delete all here', '', 'Delete every comment on ' . $ctx . '?')
               . '</span></div></div>';

            echo '<table class="dc-table"><thead><tr>'
               . '<th style="width:150px">Author</th><th>Comment</th>'
               . '<th style="width:70px">Likes</th><th style="width:70px">Type</th>'
               . '<th style="width:150px">Posted</th><th style="width:90px"></th></tr></thead><tbody>';
            foreach ($list as $r) {
                $uid  = (int) $r['user_id'];
                $name = $users[$uid]['name'] ?? $r['author'];
                $likes = json_decode($r['likes'], true) ?: [];
                $body = esc_html($r['content']);
                $body = preg_replace('#\[img\](https?://[^\s\[\]]+)\[/img\]#',
                    '<a href="$1" target="_blank"><img src="$1" style="max-width:120px;max-height:90px;border-radius:6px;vertical-align:middle"></a>', $body);
                echo '<tr>';
                echo '<td><span class="dc-name">' . esc_html($name) . '</span><br><span class="dc-muted dc-mono">'
                   . esc_html($users[$uid]['email'] ?? 'deleted account') . '</span></td>';
                echo '<td class="dc-body-cell">' . $body . '</td>';
                echo '<td>' . count($likes) . '</td>';
                echo '<td>' . ((int) $r['parent_id'] ? 'Reply' : 'Comment') . '</td>';
                echo '<td>' . esc_html(mysql2date('M j, Y g:ia', $r['created_at'])) . '</td>';
                echo '<td><span class="dc-danger">' . self::admin_form(['do' => 'del_comment', 'id' => $r['id'], 'tab' => 'comments'],
                    'Delete', '', 'Delete this comment?') . '</span></td>';
                echo '</tr>';
            }
            echo '</tbody></table></div>';
        }
    }
}
DevComments::init();