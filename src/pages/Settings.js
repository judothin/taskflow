import React, { useState, useRef, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePets } from '../context/PetContext';
import Avatar from '../components/Avatar';
import AvatarCrop from '../components/AvatarCrop';
import RankBadges from '../components/PetBadges';
import AccountStatsCard from '../components/AccountStatsCard';
import SubtaskPresetsCard from '../components/SubtaskPresetsCard';
import TeamSettings from '../components/TeamSettings';
import { SettingRow, Toggle } from '../components/SettingsControls';
import { getRankBadges } from '../lib/petBadges';
import { useSpecialBadges } from '../context/SpecialBadgesContext';
import { loadShownBadges, saveShownBadges } from '../lib/badgePrefs';
import ModalPortal from '../components/ModalPortal';
import { useThemeCustomization } from '../context/ThemeCustomizationContext';
import {
  THEME_FIELDS, STATUS_FIELDS, FONT_SCALES,
  DEFAULT_BG_TINT, MAX_BG_TINT_OPACITY,
} from '../lib/themeColors';
import { SETTINGS_SECTIONS as SECTIONS, resolveSettingsSection } from '../lib/settingsSections';
import './Dashboard.css';
import './Auth.css';

const PRESET_COLORS = [
  '#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6',
  '#8b5cf6','#ef4444','#06b6d4','#84cc16','#f97316'
];

function Icon({ d, size = 17 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((seg, i) => <path key={i} d={i === 0 ? seg : `M${seg}`} />)}
    </svg>
  );
}

// Module-level so its identity is stable — if it were defined inside Settings,
// every color change would re-render Settings, remount the <input type="color">,
// and close the native picker mid-drag. Group/SettingRow live out here for the
// same reason: they wrap those inputs.
function ColorRow({ field, value, custom, onChange, onReset }) {
  return (
    <div className="theme-color-row">
      <input
        type="color"
        className="theme-color-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        title={field.label}
      />
      <div className="settings-row-text">
        <div className="settings-row-label">{field.label}</div>
        {field.desc && <div className="settings-row-desc">{field.desc}</div>}
      </div>
      <span className="theme-color-hex">{value}</span>
      {custom && (
        <button type="button" className="theme-color-reset" onClick={onReset}>Reset</button>
      )}
    </div>
  );
}

// Collapsible sub-group inside a card, so long panels stay scannable.
function Group({ title, count, defaultOpen = true, children }) {
  return (
    <details className="settings-group" open={defaultOpen}>
      <summary className="settings-group-summary">
        <svg className="settings-group-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18l6-6-6-6" />
        </svg>
        <span className="settings-group-title">{title}</span>
        {count != null && <span className="settings-group-count">{count}</span>}
      </summary>
      <div className="settings-group-body">{children}</div>
    </details>
  );
}

export default function Settings() {
  const { profile, refreshProfile, user } = useAuth();
  const { userGamificationEnabled, setGamificationEnabled, userLevel } = usePets();
  const { specialFlags } = useSpecialBadges();
  const [shownBadges, setShownBadges] = useState(() => loadShownBadges(user?.id));
  const {
    getColor, setColor, setColorValues, resetColor, resetAll, isCustom, colors,
    backgrounds, maxBackgrounds, setBackground, uploadBackground, deleteBackground,
    savedThemes, saveTheme, applyTheme, deleteTheme, themesUsingBackground,
  } = useThemeCustomization();
  const avatarRef = useRef();
  const bgInputRef = useRef();
  const logoChoice = colors.logo || 'auto';
  const [savingGamification, setSavingGamification] = useState(false);

  // The open section lives in the URL (?section=appearance) so it survives a
  // refresh, works with the back button, and can be linked to directly.
  const [searchParams, setSearchParams] = useSearchParams();
  const section = resolveSettingsSection(searchParams.get('section'));
  const activeSection = useMemo(() => SECTIONS.find(s => s.id === section), [section]);
  const goTo = (id) => {
    const next = new URLSearchParams(searchParams);
    next.set('section', id);
    setSearchParams(next, { replace: true });
  };

  const handleToggleGamification = async () => {
    setSavingGamification(true);
    try {
      await setGamificationEnabled(!userGamificationEnabled);
    } finally {
      setSavingGamification(false);
    }
  };

  const [bgError, setBgError]   = useState('');
  const [bgBusy, setBgBusy]     = useState(false);
  const [themeName, setThemeName] = useState('');
  const [confirmDeleteBg, setConfirmDeleteBg] = useState(null); // { bg, themes }

  const handleBgUpload = async (e) => {
    const file = e.target.files?.[0];
    if (bgInputRef.current) bgInputRef.current.value = '';
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setBgError('Image must be 5 MB or smaller.'); return; }
    setBgError(''); setBgBusy(true);
    try {
      const url = await uploadBackground(file);
      if (url) setBackground(url);
    } catch (err) { setBgError(err.message || 'Upload failed.'); }
    finally { setBgBusy(false); }
  };

  const requestDeleteBg = (bg) => {
    const themes = themesUsingBackground(bg.url);
    if (themes.length) setConfirmDeleteBg({ bg, themes });
    else deleteBackground(bg);
  };

  const handleSaveTheme = async () => {
    if (!themeName.trim()) return;
    await saveTheme(themeName);
    setThemeName('');
  };

  const [form, setForm] = useState({
    first_name: profile?.first_name || '',
    last_name:  profile?.last_name  || '',
    color:      profile?.color      || '#6366f1',
    start_date: profile?.start_date || '',
  });

  // Avatar state
  const [avatarFile,     setAvatarFile]     = useState(null);
  const [avatarPreview,  setAvatarPreview]  = useState(profile?.avatar_url || null);
  const [avatarError,    setAvatarError]    = useState('');
  const [cropSrc,        setCropSrc]        = useState(null); // raw file src waiting for crop

  const [pwForm,   setPwForm]   = useState({ next: '', confirm: '' });
  const [saving,   setSaving]   = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [msg,      setMsg]      = useState('');
  const [pwMsg,    setPwMsg]    = useState('');
  const [error,    setError]    = useState('');
  const [pwError,  setPwError]  = useState('');

  const set   = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const setPw = (k) => (e) => setPwForm(f => ({ ...f, [k]: e.target.value }));

  // Tenure badges run off the editable start date (e.g. hire date), falling
  // back to the account creation date.
  const effectiveStart = profile?.start_date || user?.created_at;
  const daysSince = (d) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 86400000)) : 0);
  const todayStr = new Date().toISOString().slice(0, 10);

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) {
      setAvatarError('Image must be 4 MB or smaller.');
      avatarRef.current.value = '';
      return;
    }
    setAvatarError('');
    // Open crop UI instead of using the file directly
    setCropSrc(URL.createObjectURL(file));
    if (avatarRef.current) avatarRef.current.value = '';
  };

  const handleCropConfirm = (blob) => {
    setCropSrc(null);
    const croppedFile = new File([blob], 'avatar.jpg', { type: 'image/jpeg' });
    setAvatarFile(croppedFile);
    setAvatarPreview(URL.createObjectURL(blob));
  };

  const handleCropCancel = () => {
    setCropSrc(null);
  };

  const removeAvatar = (e) => {
    e.stopPropagation();
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarError('');
    if (avatarRef.current) avatarRef.current.value = '';
  };

  const uploadAvatar = async () => {
    if (!avatarFile) {
      // null means removed; otherwise return existing URL unchanged
      return avatarPreview;
    }
    // Always store as .jpg (crop always outputs JPEG)
    const path = `avatars/${profile.id}.jpg`;
    const { error: uploadError } = await supabase.storage
      .from('task-images')
      .upload(path, avatarFile, { upsert: true, contentType: 'image/jpeg' });
    if (uploadError) throw uploadError;
    // Bust the CDN cache so the new image shows immediately
    const { data } = supabase.storage.from('task-images').getPublicUrl(path);
    return `${data.publicUrl}?t=${Date.now()}`;
  };

  const handleProfileSave = async (e) => {
    e.preventDefault();
    setError(''); setMsg('');
    setSaving(true);
    try {
      const avatar_url = await uploadAvatar();
      const { error } = await supabase
        .from('profiles')
        .update({ first_name: form.first_name, last_name: form.last_name, color: form.color, avatar_url, start_date: form.start_date || null })
        .eq('id', profile.id);
      if (error) throw error;
      setAvatarFile(null);
      await refreshProfile();
      setMsg('Profile updated successfully!');
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePasswordChange = async (e) => {
    e.preventDefault();
    setPwError(''); setPwMsg('');
    if (pwForm.next !== pwForm.confirm) { setPwError('Passwords do not match'); return; }
    if (pwForm.next.length < 6)         { setPwError('Password must be at least 6 characters'); return; }
    setPwSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pwForm.next });
      if (error) throw error;
      setPwMsg('Password updated!');
      setPwForm({ next: '', confirm: '' });
    } catch (err) {
      setPwError(err.message);
    } finally {
      setPwSaving(false);
    }
  };

  const initials = `${form.first_name[0] || ''}${form.last_name[0] || ''}`.toUpperCase();

  // Which badges show in the top bar. Default (uncustomized) = the highest
  // earned per track; toggling a badge makes the selection explicit.
  const rb = getRankBadges(userLevel?.level, effectiveStart, userLevel?.tasks_completed, specialFlags);
  const autoKeys = [
    [...rb.levelBadges].reverse().find(b => b.earned)?.key,
    [...rb.taskBadges].reverse().find(b => b.earned)?.key,
    [...rb.ageBadges].reverse().find(b => b.earned)?.key,
    ...rb.specialBadges.filter(b => b.earned).map(b => b.key),
  ].filter(Boolean);
  const effectiveShown = shownBadges ?? autoKeys;
  const toggleBadge = (key) => {
    const base = shownBadges ?? autoKeys;
    const next = base.includes(key) ? base.filter(k => k !== key) : [...base, key];
    setShownBadges(next);
    saveShownBadges(user?.id, next);
  };

  // How many colors the user has overridden — shown on the "Reset all" button
  // so it's obvious whether there's anything to reset.
  const customCount = [...THEME_FIELDS, ...STATUS_FIELDS].filter(f => isCustom(f.key)).length;

  // Background tint — a color wash over the image. Strength 0 means off, so
  // picking a color while it sits at 0 would look like nothing happened; give
  // it a visible starting strength in that case (both keys in one commit, or
  // the second write would read a stale colors ref and drop the first).
  const tintColor = colors.bgTint || DEFAULT_BG_TINT;
  const tintOpacity = Math.min(Math.max(Number(colors.bgTintOpacity) || 0, 0), MAX_BG_TINT_OPACITY);
  const handleTintColor = (hex) => {
    if (tintOpacity > 0) setColor('bgTint', hex);
    else setColorValues({ bgTint: hex, bgTintOpacity: 0.3 });
  };

  return (
    <div className="dashboard fade-in settings-page">
      <div className="settings-shell">

        {/* ── Section nav ───────────────────────────────────── */}
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              type="button"
              className={`settings-nav-item ${section === s.id ? 'settings-nav-item-active' : ''}`}
              onClick={() => goTo(s.id)}
              aria-current={section === s.id ? 'page' : undefined}
            >
              <span className="settings-nav-icon"><Icon d={s.icon} /></span>
              <span className="settings-nav-label">{s.label}</span>
            </button>
          ))}
        </nav>

        {/* ── Active section ────────────────────────────────── */}
        <div className="settings-panel">
          <header className="settings-panel-head">
            <h1 className="settings-panel-title">{activeSection.label}</h1>
            <p className="settings-panel-sub">{activeSection.blurb}</p>
          </header>

          {/* ─────────────────────────────── Profile ────────── */}
          {section === 'profile' && (
            <>
              <div className="card">
                <div className="settings-identity">
                  <div
                    className="avatar-upload-zone"
                    onClick={() => avatarRef.current?.click()}
                    title="Click to change photo"
                  >
                    <Avatar src={avatarPreview} color={form.color} initials={initials || '?'} size={64} />
                    <div className="avatar-upload-overlay">
                      <Icon d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z M16 13a4 4 0 11-8 0 4 4 0 018 0z" size={18} />
                    </div>
                    {avatarPreview && (
                      <button className="avatar-remove-btn" onClick={removeAvatar} title="Remove photo">✕</button>
                    )}
                  </div>
                  <input
                    ref={avatarRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleAvatarChange}
                    style={{ display: 'none' }}
                  />

                  <div className="settings-identity-text">
                    <div className="settings-identity-name">{form.first_name} {form.last_name}</div>
                    <div className="settings-identity-email">{profile?.email}</div>
                    <div className="settings-identity-hint">
                      {avatarPreview
                        ? (avatarFile ? 'New photo selected — save below to apply' : 'Click the photo to replace it, ✕ to remove')
                        : 'Click the circle to add a photo — PNG, JPG, WebP or GIF, max 4 MB'}
                    </div>
                    {avatarError && <div className="settings-identity-err">⚠ {avatarError}</div>}
                  </div>
                </div>
              </div>

              <div className="card">
                <h2 className="settings-card-title">Details</h2>
                <form onSubmit={handleProfileSave} className="form-grid">
                  <div className="form-grid form-grid-2">
                    <div className="form-group">
                      <label className="label">First Name</label>
                      <input className="input" value={form.first_name} onChange={set('first_name')} required />
                    </div>
                    <div className="form-group">
                      <label className="label">Last Name</label>
                      <input className="input" value={form.last_name} onChange={set('last_name')} required />
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="label">
                      Start Date
                      <span className="label-note"> — e.g. your hire date; sets your tenure badges</span>
                    </label>
                    <input type="date" className="input" value={form.start_date} onChange={set('start_date')} max={todayStr} />
                    <div className="form-hint">
                      {form.start_date
                        ? <>Day <strong>{daysSince(form.start_date) + 1}</strong> — {daysSince(form.start_date).toLocaleString()} day{daysSince(form.start_date) !== 1 ? 's' : ''} as a member.</>
                        : <>No start date set — using your account creation date ({daysSince(user?.created_at).toLocaleString()} days).</>}
                    </div>
                  </div>

                  <div className="form-group">
                    <label className="label">Fallback / Chart Color</label>
                    <p className="form-hint form-hint-top">Shown when no photo is set, and used on the activity chart.</p>
                    <div className="color-picker-row">
                      {PRESET_COLORS.map(c => (
                        <button key={c} type="button"
                          className={`color-swatch ${form.color === c ? 'color-swatch-active' : ''}`}
                          style={{ background: c }}
                          onClick={() => setForm(f => ({ ...f, color: c }))}
                        />
                      ))}
                      <input type="color" value={form.color} onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                        className="color-custom-input" title="Custom color" />
                    </div>
                  </div>

                  {msg   && <div className="success-msg">✓ {msg}</div>}
                  {error && <div className="error-msg">⚠ {error}</div>}

                  <button type="submit" className="btn btn-primary settings-submit" disabled={saving}>
                    {saving ? 'Saving...' : 'Save Changes'}
                  </button>
                </form>
              </div>
            </>
          )}

          {/* ─────────────────────────────── Account ────────── */}
          {section === 'account' && (
            <>
              <AccountStatsCard userId={user?.id} tasksCompleted={userLevel?.tasks_completed} />

              <div className="card">
                <h2 className="settings-card-title">Sign-in</h2>
                <SettingRow label="Email" desc="The address you sign in with.">
                  <span className="settings-row-value">{profile?.email}</span>
                </SettingRow>
              </div>

              <div className="card">
                <h2 className="settings-card-title">Change Password</h2>
                <form onSubmit={handlePasswordChange} className="form-grid">
                  <div className="form-grid form-grid-2">
                    <div className="form-group">
                      <label className="label">New Password</label>
                      <input type="password" className="input" placeholder="Min. 6 characters" value={pwForm.next} onChange={setPw('next')} required />
                    </div>
                    <div className="form-group">
                      <label className="label">Confirm New Password</label>
                      <input type="password" className="input" placeholder="••••••••" value={pwForm.confirm} onChange={setPw('confirm')} required />
                    </div>
                  </div>

                  {pwMsg   && <div className="success-msg">✓ {pwMsg}</div>}
                  {pwError && <div className="error-msg">⚠ {pwError}</div>}

                  <button type="submit" className="btn btn-primary settings-submit" disabled={pwSaving}>
                    {pwSaving ? 'Updating...' : 'Update Password'}
                  </button>
                </form>
              </div>
            </>
          )}

          {/* ─────────────────────────────── Teams ──────────── */}
          {section === 'teams' && <TeamSettings />}

          {/* ────────────────────────── Subtask presets ────── */}
          {section === 'presets' && <SubtaskPresetsCard />}

          {/* ──────────────────────────── Appearance ────────── */}
          {section === 'appearance' && (
            <>
              <div className="card">
                <div className="settings-card-head">
                  <h2 className="settings-card-title">Colors</h2>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={resetAll} disabled={!customCount}>
                    {customCount ? `Reset all (${customCount})` : 'Reset all'}
                  </button>
                </div>
                <p className="settings-card-sub">
                  Changes apply instantly and sync across your devices. The secondary color also drives the activity chart.
                </p>

                <Group title="Interface" count={THEME_FIELDS.length}>
                  <div className="theme-color-grid">
                    {THEME_FIELDS.map(f => (
                      <ColorRow key={f.key} field={f} value={getColor(f.key)} custom={isCustom(f.key)}
                        onChange={(v) => setColor(f.key, v)} onReset={() => resetColor(f.key)} />
                    ))}
                  </div>
                </Group>

                <Group title="Status colors" count={STATUS_FIELDS.length} defaultOpen={false}>
                  <div className="theme-color-grid">
                    {STATUS_FIELDS.map(f => (
                      <ColorRow key={f.key} field={f} value={getColor(f.key)} custom={isCustom(f.key)}
                        onChange={(v) => setColor(f.key, v)} onReset={() => resetColor(f.key)} />
                    ))}
                  </div>
                </Group>

                <Group title="Logo" defaultOpen={false}>
                  <SettingRow label="Logo tint" desc="Auto picks white or black to suit your theme.">
                    <div className="theme-logo-seg">
                      {[{ v: 'auto', label: 'Auto' }, { v: 'white', label: 'White' }, { v: 'black', label: 'Black' }].map(o => (
                        <button
                          key={o.v}
                          type="button"
                          className={`theme-logo-btn ${logoChoice === o.v ? 'theme-logo-btn-active' : ''}`}
                          onClick={() => (o.v === 'auto' ? resetColor('logo') : setColor('logo', o.v))}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </SettingRow>
                </Group>
              </div>

              <div className="settings-two-col">
                {/* Background images */}
                <div className="card">
                  <div className="settings-card-head">
                    <h2 className="settings-card-title">Background</h2>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={bgBusy || backgrounds.length >= maxBackgrounds}
                      onClick={() => bgInputRef.current?.click()}
                    >
                      {bgBusy ? 'Uploading…' : 'Upload image'}
                    </button>
                  </div>
                  <p className="settings-card-sub">
                    Use an image as the app background — synced to your account. {backgrounds.length}/{maxBackgrounds} saved.
                  </p>
                  <input ref={bgInputRef} type="file" accept="image/*" onChange={handleBgUpload} style={{ display: 'none' }} />
                  {bgError && <div className="error-msg settings-inline-err">⚠ {bgError}</div>}
                  <div className="bg-grid">
                    <button
                      type="button"
                      className={`bg-tile bg-tile-none ${!colors.background ? 'bg-tile-active' : ''}`}
                      onClick={() => setBackground(null)}
                    >
                      None
                    </button>
                    {backgrounds.map(bg => (
                      <div
                        key={bg.id}
                        className={`bg-tile ${colors.background === bg.url ? 'bg-tile-active' : ''}`}
                        style={{ backgroundImage: `url("${bg.url}")` }}
                        onClick={() => setBackground(bg.url)}
                        title="Use as background"
                      >
                        <button className="bg-tile-del" onClick={(e) => { e.stopPropagation(); requestDeleteBg(bg); }} title="Delete background">✕</button>
                      </div>
                    ))}
                  </div>

                  {colors.background && (
                    <div className="settings-sliders">
                      <div className="settings-slider-head">
                        <span>Glass opacity</span>
                        <span className="settings-slider-value">{Math.round((colors.glassOpacity ?? 0.55) * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min="0.2" max="0.95" step="0.05"
                        value={colors.glassOpacity ?? 0.55}
                        onChange={(e) => setColor('glassOpacity', Number(e.target.value))}
                        className="glass-opacity-range"
                      />

                      <div className="settings-slider-head">
                        <span>Glass blur</span>
                        <span className="settings-slider-value">{colors.glassBlur ?? 14}px</span>
                      </div>
                      <input
                        type="range"
                        min="0" max="30" step="1"
                        value={colors.glassBlur ?? 14}
                        onChange={(e) => setColor('glassBlur', Number(e.target.value))}
                        className="glass-opacity-range"
                      />
                      <p className="settings-card-sub settings-card-sub-tight">
                        Opacity &amp; blur of the frosted panels over your background.
                      </p>

                      <div className="settings-tint">
                        <div className="settings-slider-head">
                          <span>Tint</span>
                          <span className="settings-slider-value">
                            {tintOpacity > 0 ? `${tintColor.toUpperCase()} · ${Math.round(tintOpacity * 100)}%` : 'Off'}
                          </span>
                        </div>
                        <div className="settings-tint-row">
                          <input
                            type="color"
                            className="theme-color-input"
                            value={tintColor}
                            onChange={(e) => handleTintColor(e.target.value)}
                            title="Tint color"
                          />
                          <input
                            type="range"
                            min="0" max={MAX_BG_TINT_OPACITY} step="0.05"
                            value={tintOpacity}
                            onChange={(e) => setColor('bgTintOpacity', Number(e.target.value))}
                            className="glass-opacity-range"
                            aria-label="Tint strength"
                          />
                        </div>
                        <p className="settings-card-sub settings-card-sub-tight">
                          Washes a color over the image — darken a busy photo so text stays readable. Drag to 0% to turn it off.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Saved themes */}
                <div className="card">
                  <h2 className="settings-card-title">Saved Themes</h2>
                  <p className="settings-card-sub">
                    Save your current colors, background &amp; text settings as a named theme.
                  </p>
                  <div className="settings-inline-form">
                    <input className="input" placeholder="Theme name…" value={themeName} onChange={e => setThemeName(e.target.value)} />
                    <button type="button" className="btn btn-primary btn-sm" disabled={!themeName.trim()} onClick={handleSaveTheme}>Save</button>
                  </div>
                  {savedThemes.length === 0 ? (
                    <p className="settings-empty">No saved themes yet.</p>
                  ) : (
                    <div className="saved-theme-list">
                      {savedThemes.map(t => (
                        <div key={t.id} className="saved-theme-row">
                          <div className="saved-theme-swatches">
                            {t.colors?.background
                              ? <span className="saved-theme-img" style={{ backgroundImage: `url("${t.colors.background}")` }} />
                              : null}
                            {['bg', 'accent', 'text'].map(k => (
                              <span key={k} style={{ background: t.colors?.[k] || 'var(--bg-4)' }} />
                            ))}
                          </div>
                          <span className="saved-theme-name">{t.name}</span>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => applyTheme(t)}>Apply</button>
                          <button type="button" className="theme-color-reset" onClick={() => deleteTheme(t.id)}>Delete</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ─────────────────────────── Accessibility ──────── */}
          {section === 'accessibility' && (
            <div className="card">
              <h2 className="settings-card-title">Text</h2>
              <p className="settings-card-sub">Applies everywhere in the app and syncs across your devices.</p>

              <SettingRow label="Text size" desc="Scales every label, heading, and body line.">
                <div className="theme-logo-seg theme-logo-seg-wrap">
                  {FONT_SCALES.map(o => (
                    <button
                      key={o.key}
                      type="button"
                      className={`theme-logo-btn ${(colors.fontScale || 1) === o.key ? 'theme-logo-btn-active' : ''}`}
                      onClick={() => setColor('fontScale', o.key)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </SettingRow>

              <SettingRow label="Bold text" desc="Heavier body text for readability.">
                <Toggle on={colors.bold} onClick={() => setColor('bold', !colors.bold)} label="Bold text" />
              </SettingRow>
            </div>
          )}

          {/* ──────────────────────────── Achievements ──────── */}
          {section === 'achievements' && (
            <>
              <div className="card">
                <h2 className="settings-card-title">Levels &amp; Badges</h2>
                <p className="settings-card-sub">Earn XP, level up, and unlock rank badges by completing tasks.</p>
                <SettingRow
                  label="Enable XP & levels"
                  desc={userGamificationEnabled
                    ? 'Turning this off pauses your XP and hides levels & badges.'
                    : "You'll pick up right where you left off."}
                >
                  <Toggle
                    on={userGamificationEnabled}
                    onClick={handleToggleGamification}
                    disabled={savingGamification}
                    label="Enable XP and levels"
                  />
                </SettingRow>
              </div>

              {userGamificationEnabled ? (
                <div className="card">
                  <h2 className="settings-card-title">Ranks &amp; Badges</h2>
                  <p className="settings-card-sub">
                    Unlocked by leveling up, by tasks you've completed, and by how long you've been a member.
                    Click an unlocked badge to show or hide it in the top bar.
                  </p>
                  <RankBadges
                    level={userLevel?.level}
                    createdAt={effectiveStart}
                    tasksDone={userLevel?.tasks_completed}
                    specialFlags={specialFlags}
                    selectable
                    selected={effectiveShown}
                    onToggle={toggleBadge}
                  />
                </div>
              ) : (
                <div className="card settings-empty-card">
                  Turn on XP &amp; levels above to see your ranks and badges.
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {confirmDeleteBg && (
        <ModalPortal>
        <div className="modal-overlay" onClick={() => setConfirmDeleteBg(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2 className="settings-card-title">Delete this background?</h2></div>
            <div className="modal-body">
              <p style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.6 }}>
                It's used by {confirmDeleteBg.themes.length} saved theme{confirmDeleteBg.themes.length !== 1 ? 's' : ''}:{' '}
                <strong>{confirmDeleteBg.themes.map(t => t.name).join(', ')}</strong>.
              </p>
              <p style={{ fontSize: 12.5, color: 'var(--text-muted)', marginTop: 10, lineHeight: 1.6 }}>
                Those themes keep the image on this device from cache. If the cache is cleared, they'll fall back to a solid color.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmDeleteBg(null)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { deleteBackground(confirmDeleteBg.bg); setConfirmDeleteBg(null); }}>Delete anyway</button>
            </div>
          </div>
        </div>
        </ModalPortal>
      )}

      {/* Crop modal — shown after file is selected */}
      {cropSrc && (
        <AvatarCrop
          src={cropSrc}
          onConfirm={handleCropConfirm}
          onCancel={handleCropCancel}
        />
      )}
    </div>
  );
}
