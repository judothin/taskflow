import React, { useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePets } from '../context/PetContext';
import Avatar from '../components/Avatar';
import AvatarCrop from '../components/AvatarCrop';
import ModalPortal from '../components/ModalPortal';
import { InlineClock } from '../components/dashboardWidgets';
import { useThemeCustomization } from '../context/ThemeCustomizationContext';
import { THEME_FIELDS, STATUS_FIELDS, FONT_SCALES } from '../lib/themeColors';
import './Dashboard.css';
import './Auth.css';

const PRESET_COLORS = [
  '#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6',
  '#8b5cf6','#ef4444','#06b6d4','#84cc16','#f97316'
];

// Module-level so its identity is stable — if it were defined inside Settings,
// every color change would re-render Settings, remount the <input type="color">,
// and close the native picker mid-drag.
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
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{field.label}</div>
        {field.desc && <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>{field.desc}</div>}
      </div>
      <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text-dim)', textTransform: 'uppercase' }}>
        {value}
      </span>
      {custom && (
        <button type="button" className="theme-color-reset" onClick={onReset}>Reset</button>
      )}
    </div>
  );
}

export default function Settings() {
  const { profile, refreshProfile } = useAuth();
  const { userGamificationEnabled, setGamificationEnabled } = usePets();
  const {
    getColor, setColor, resetColor, resetAll, isCustom, colors,
    backgrounds, maxBackgrounds, setBackground, uploadBackground, deleteBackground,
    savedThemes, saveTheme, applyTheme, deleteTheme, themesUsingBackground,
  } = useThemeCustomization();
  const avatarRef = useRef();
  const bgInputRef = useRef();
  const logoChoice = colors.logo || 'auto';
  const [savingGamification, setSavingGamification] = useState(false);

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
        .update({ first_name: form.first_name, last_name: form.last_name, color: form.color, avatar_url })
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

  return (
    <div className="dashboard fade-in settings-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your profile and preferences</p>
        </div>
        <InlineClock />
      </div>

      <div className="settings-grid">
        <div className="settings-col">

      {/* Profile preview */}
      <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 20, marginBottom: 8 }}>
        {/* Clickable avatar */}
        <div
          className="avatar-upload-zone"
          onClick={() => avatarRef.current?.click()}
          title="Click to change photo"
        >
          <Avatar
            src={avatarPreview}
            color={form.color}
            initials={initials || '?'}
            size={64}
          />
          <div className="avatar-upload-overlay">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
              <circle cx="12" cy="13" r="4"/>
            </svg>
          </div>
          {avatarPreview && (
            <button className="avatar-remove-btn" onClick={removeAvatar} title="Remove photo">
              ✕
            </button>
          )}
        </div>
        <input
          ref={avatarRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={handleAvatarChange}
          style={{ display: 'none' }}
        />

        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{form.first_name} {form.last_name}</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{profile?.email}</div>
          {avatarPreview ? (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
              {avatarFile ? 'New photo selected — save to apply' : 'Profile photo set'}
            </div>
          ) : (
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>
              Click the avatar to add a photo
            </div>
          )}
          {avatarError && (
            <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>⚠ {avatarError}</div>
          )}
        </div>
      </div>

      {/* Profile form */}
      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24 }}>Profile Information</h2>
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
            <label className="label">Profile Photo <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--text-dim)', fontSize: 11 }}>— PNG, JPG, WebP or GIF, max 4 MB</span></label>
            <div
              className="avatar-upload-full"
              onClick={() => avatarRef.current?.click()}
            >
              {avatarPreview ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <Avatar src={avatarPreview} color={form.color} initials={initials || '?'} size={44} />
                  <div>
                    <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>
                      {avatarFile ? avatarFile.name : 'Current photo'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>Click to replace</div>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginLeft: 'auto', flexShrink: 0 }}
                    onClick={removeAvatar}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text-muted)' }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                  <span style={{ fontSize: 13 }}>Click to upload a profile photo</span>
                </div>
              )}
            </div>
            {avatarError && <div className="error-msg" style={{ marginTop: 4 }}>⚠ {avatarError}</div>}
          </div>

          <div className="form-group">
            <label className="label">Fallback / Chart Color</label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              Shown when no photo is set, and used on the activity chart
            </p>
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

          {msg   && <div style={{ color: 'var(--success)', fontSize: 13 }}>✓ {msg}</div>}
          {error && <div className="error-msg">⚠ {error}</div>}

          <button type="submit" className="btn btn-primary" disabled={saving} style={{ alignSelf: 'flex-start' }}>
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </form>
      </div>

      {/* Password form */}
      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 24 }}>Change Password</h2>
        <form onSubmit={handlePasswordChange} className="form-grid">
          <div className="form-group">
            <label className="label">New Password</label>
            <input type="password" className="input" placeholder="Min. 6 characters" value={pwForm.next} onChange={setPw('next')} required />
          </div>
          <div className="form-group">
            <label className="label">Confirm New Password</label>
            <input type="password" className="input" placeholder="••••••••" value={pwForm.confirm} onChange={setPw('confirm')} required />
          </div>

          {pwMsg   && <div style={{ color: 'var(--success)', fontSize: 13 }}>✓ {pwMsg}</div>}
          {pwError && <div className="error-msg">⚠ {pwError}</div>}

          <button type="submit" className="btn btn-primary" disabled={pwSaving} style={{ alignSelf: 'flex-start' }}>
            {pwSaving ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* Gamification opt-in/out */}
      <div className="card">
        <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Pets &amp; Levels</h2>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16 }}>
          Earn XP and level up by completing tasks, and unlock a pet that grows with you.
        </p>
        <div className="theme-color-row" style={{ borderBottom: 'none', paddingLeft: 0, paddingRight: 0 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Enable pets &amp; XP</div>
            <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
              {userGamificationEnabled
                ? 'Turning this off pauses your XP and pet at their current level.'
                : "You'll pick up right where you left off — or get a fresh pet to open if you never had one."}
            </div>
          </div>
          <button
            type="button"
            className={`nc-toggle ${userGamificationEnabled ? 'nc-toggle-on' : ''}`}
            onClick={handleToggleGamification}
            disabled={savingGamification}
            role="switch"
            aria-checked={!!userGamificationEnabled}
          >
            <span className="nc-toggle-thumb" />
          </button>
        </div>
      </div>
        </div>{/* /left column */}

        {/* Right column — appearance (theme editor + backgrounds/themes side by side) */}
        <div className="settings-theme-area">
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Theme & Colors</h2>
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetAll}>Reset all</button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 18 }}>
              Personalize the interface. Changes apply instantly and sync across your devices. The secondary color also drives the activity chart.
            </p>

            <div className="theme-color-grid">
              {THEME_FIELDS.map(f => (
                <ColorRow key={f.key} field={f} value={getColor(f.key)} custom={isCustom(f.key)}
                  onChange={(v) => setColor(f.key, v)} onReset={() => resetColor(f.key)} />
              ))}
            </div>

            <div className="label" style={{ marginTop: 24, marginBottom: 8 }}>Status colors</div>
            <div className="theme-color-grid">
              {STATUS_FIELDS.map(f => (
                <ColorRow key={f.key} field={f} value={getColor(f.key)} custom={isCustom(f.key)}
                  onChange={(v) => setColor(f.key, v)} onReset={() => resetColor(f.key)} />
              ))}
            </div>

            <div className="label" style={{ marginTop: 24, marginBottom: 8 }}>Logo</div>
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

            <div className="label" style={{ marginTop: 24, marginBottom: 8 }}>Accessibility</div>
            <div style={{ fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 8 }}>Text size</div>
            <div className="theme-logo-seg" style={{ flexWrap: 'wrap' }}>
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

            <div className="theme-color-row" style={{ borderBottom: 'none', paddingLeft: 0, paddingRight: 0, marginTop: 6 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>Bold text</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>Heavier body text for readability</div>
              </div>
              <button
                type="button"
                className={`nc-toggle ${colors.bold ? 'nc-toggle-on' : ''}`}
                onClick={() => setColor('bold', !colors.bold)}
                role="switch"
                aria-checked={!!colors.bold}
              >
                <span className="nc-toggle-thumb" />
              </button>
            </div>
          </div>

          <div className="settings-col">
          {/* Background images */}
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700 }}>Background</h2>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={bgBusy || backgrounds.length >= maxBackgrounds}
                onClick={() => bgInputRef.current?.click()}
              >
                {bgBusy ? 'Uploading…' : 'Upload image'}
              </button>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              Use an image as the app background — synced to your account. {backgrounds.length}/{maxBackgrounds} saved.
            </p>
            <input ref={bgInputRef} type="file" accept="image/*" onChange={handleBgUpload} style={{ display: 'none' }} />
            {bgError && <div className="error-msg" style={{ marginBottom: 10 }}>⚠ {bgError}</div>}
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
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 8 }}>
                  <span>Glass opacity</span>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>{Math.round((colors.glassOpacity ?? 0.55) * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.2" max="0.95" step="0.05"
                  value={colors.glassOpacity ?? 0.55}
                  onChange={(e) => setColor('glassOpacity', Number(e.target.value))}
                  className="glass-opacity-range"
                />

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12.5, color: 'var(--text-muted)', margin: '14px 0 8px' }}>
                  <span>Glass blur</span>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-dim)' }}>{colors.glassBlur ?? 14}px</span>
                </div>
                <input
                  type="range"
                  min="0" max="30" step="1"
                  value={colors.glassBlur ?? 14}
                  onChange={(e) => setColor('glassBlur', Number(e.target.value))}
                  className="glass-opacity-range"
                />
                <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6 }}>
                  Opacity &amp; blur of the frosted panels over your background.
                </p>
              </div>
            )}
          </div>

          {/* Saved themes */}
          <div className="card">
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Saved Themes</h2>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>
              Save your current colors, background &amp; text settings as a named theme.
            </p>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <input className="input" placeholder="Theme name…" value={themeName} onChange={e => setThemeName(e.target.value)} />
              <button type="button" className="btn btn-primary btn-sm" disabled={!themeName.trim()} onClick={handleSaveTheme}>Save</button>
            </div>
            {savedThemes.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>No saved themes yet.</p>
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
          </div>{/* /backgrounds + themes column */}
        </div>{/* /right appearance area */}
      </div>{/* /settings-grid */}

      {confirmDeleteBg && (
        <ModalPortal>
        <div className="modal-overlay" onClick={() => setConfirmDeleteBg(null)}>
          <div className="modal" style={{ maxWidth: 440 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header"><h2 style={{ fontSize: 16, fontWeight: 700 }}>Delete this background?</h2></div>
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
