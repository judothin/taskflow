import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { useTeam } from '../context/TeamContext';
import { usePets } from '../context/PetContext';
import { useThemeCustomization } from '../context/ThemeCustomizationContext';
import { Icon, Segmented, ConfirmDialog, initialsOf, longDate, toast } from '../ui';
import AvatarCrop from '../components/AvatarCrop';
import TeamSettings from '../components/TeamSettings';
import SubtaskPresetsCard from '../components/SubtaskPresetsCard';
import ColorSwatches, { PERSON_COLORS } from '../components/ColorSwatches';
import { SettingRow, Toggle, Range } from '../components/SettingsControls';
import {
  ACCENTS, FONT_SCALES, DEFAULT_BG_TINT, MAX_BG_TINT_OPACITY, contrastText,
} from '../lib/themeColors';
import { SETTINGS_SECTIONS as SECTIONS, resolveSettingsSection } from '../lib/settingsSections';
import './Settings.css';

const DAY = 86400000;
const daysSince = (d) => (d ? Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / DAY)) : 0);
const todayStr = () => new Date().toISOString().slice(0, 10);

// Error line that wiggles in whenever its message changes.
function ErrorNote({ msg }) {
  if (!msg) return null;
  return (
    <div key={msg} className="notice notice-error wiggle" role="alert">
      <Icon name="alert" size={15} /><span>{msg}</span>
    </div>
  );
}

/** Primary button that turns into a green "✓ Saved" for a moment. */
function SaveButton({ saving, saved, disabled, children = 'Save changes', type = 'submit', onClick, className = '' }) {
  return (
    <button
      type={type}
      className={`btn btn-primary st-save ${saved ? 'is-saved' : ''} ${className}`}
      disabled={disabled || saving || saved}
      onClick={onClick}
    >
      {saving ? <span key="s"><span className="spinner" />Saving…</span>
        : saved ? <span key="d"><Icon name="check" size={15} stroke={2.6} />Saved</span>
          : <span key="i">{children}</span>}
    </button>
  );
}

function useFlash(ms = 1700) {
  const [on, setOn] = useState(false);
  const t = useRef(null);
  useEffect(() => () => clearTimeout(t.current), []);
  const flash = () => { setOn(true); clearTimeout(t.current); t.current = setTimeout(() => setOn(false), ms); };
  return [on, flash];
}

// ─────────────────────────────── Profile ───────────────────────────────

// Fixed shape for the colour preview — a fortnight of made-up activity.
const PREVIEW_BARS = [2, 1, 0, 0, 0, 0, 2, 2, 0, 0, 0, 0, 3, 5, 3, 3, 0, 0, 0, 4, 4, 0];

function ProfileSection() {
  const { profile, user, refreshProfile } = useAuth();
  const fileRef = useRef(null);

  const base = useMemo(() => ({
    first_name: profile?.first_name || '',
    last_name: profile?.last_name || '',
    color: profile?.color || '#6366f1',
    start_date: profile?.start_date || '',
  }), [profile?.first_name, profile?.last_name, profile?.color, profile?.start_date]);

  const [form, setForm] = useState(base);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url || null);
  const [cropSrc, setCropSrc] = useState(null);
  const [avatarError, setAvatarError] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, flashSaved] = useFlash();

  // A fresh profile (first load, or after saving) becomes the new baseline.
  useEffect(() => {
    setForm(base);
    setAvatarFile(null);
    setAvatarPreview(profile?.avatar_url || null);
  }, [base, profile?.avatar_url]);

  const avatarDirty = !!avatarFile || (avatarPreview || null) !== (profile?.avatar_url || null);
  const dirty = avatarDirty || Object.keys(base).some(k => (form[k] || '') !== (base[k] || ''));
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 4 * 1024 * 1024) { setAvatarError('Image must be 4 MB or smaller.'); return; }
    setAvatarError('');
    setCropSrc(URL.createObjectURL(file));
  };

  const onCropped = (blob) => {
    setCropSrc(null);
    setAvatarFile(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }));
    setAvatarPreview(URL.createObjectURL(blob));
  };

  const removePhoto = () => { setAvatarFile(null); setAvatarPreview(null); setAvatarError(''); };

  const discard = () => {
    setForm(base);
    setAvatarFile(null);
    setAvatarPreview(profile?.avatar_url || null);
    setError(''); setAvatarError('');
  };

  const uploadAvatar = async () => {
    if (!avatarFile) return avatarPreview; // unchanged URL, or null = removed
    const path = `avatars/${profile.id}.jpg`;
    const { error: upErr } = await supabase.storage
      .from('task-images')
      .upload(path, avatarFile, { upsert: true, contentType: 'image/jpeg' });
    if (upErr) throw upErr;
    const { data } = supabase.storage.from('task-images').getPublicUrl(path);
    return `${data.publicUrl}?t=${Date.now()}`; // bust the CDN cache
  };

  const save = async (e) => {
    e.preventDefault();
    if (!dirty || !profile) return;
    if (!form.first_name.trim() || !form.last_name.trim()) { setError('First and last name are both needed.'); return; }
    setSaving(true); setError('');
    try {
      const avatar_url = await uploadAvatar();
      const { error: upErr } = await supabase.from('profiles').update({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        color: form.color,
        avatar_url,
        start_date: form.start_date || null,
      }).eq('id', profile.id);
      if (upErr) throw upErr;
      await refreshProfile();
      flashSaved();
    } catch (err) {
      setError(err.message || 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  };

  const initials = initialsOf(`${form.first_name} ${form.last_name}`.trim() || profile?.email || '?');
  const start = form.start_date;
  const days = daysSince(start || user?.created_at);

  return (
    <form onSubmit={save}>
      <div className="st-rows stagger">
        <SettingRow label="Photo" desc="Falls back to your initials and color.">
          <div className="st-photo">
            <span
              key={avatarPreview || 'none'}
              className={`st-avatar ${avatarFile ? 'is-new' : ''}`}
              style={{ '--av': form.color, color: contrastText(form.color) }}
            >
              {avatarPreview ? <img src={avatarPreview} alt="" /> : initials}
            </span>
            <div className="st-photo-btns">
              <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
                <Icon name="upload" size={14} />{avatarPreview ? 'Replace photo' : 'Upload photo'}
              </button>
              {avatarPreview && (
                <button type="button" className="btn btn-ghost anim-pop" onClick={removePhoto}>Remove</button>
              )}
            </div>
            {avatarError ? <span className="st-photo-hint t-bad wiggle">{avatarError}</span>
              : avatarFile ? <span className="st-photo-hint">New photo — save to apply it.</span>
                : null}
            <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={pickFile} />
          </div>
        </SettingRow>

        <SettingRow label="Name" desc="Shown on tasks and reviews." top>
          <div className="st-pair">
            <label>
              <span className="st-mini-label">First name</span>
              <input className="input" value={form.first_name} onChange={set('first_name')} autoComplete="given-name" />
            </label>
            <label>
              <span className="st-mini-label">Last name</span>
              <input className="input" value={form.last_name} onChange={set('last_name')} autoComplete="family-name" />
            </label>
          </div>
        </SettingRow>

        <SettingRow label="Email" desc="Change it under Account.">
          <span className="st-value">{profile?.email || user?.email}</span>
        </SettingRow>

        <SettingRow label="Start date" desc="E.g. your hire date. Sets your tenure badge in the top bar.">
          <input type="date" className="input input-mono st-date" value={start} max={todayStr()} onChange={set('start_date')} />
          <span key={start} className="st-note anim-fade">
            {start
              ? <>Day <strong>{(days + 1).toLocaleString()}</strong> · {days.toLocaleString()} day{days === 1 ? '' : 's'} as a member</>
              : <>Using your sign-up date · {days.toLocaleString()} day{days === 1 ? '' : 's'}</>}
          </span>
        </SettingRow>

        <SettingRow label="Chart color" desc="Shown when no photo is set, and used on the activity chart." top>
          <div style={{ minWidth: 0 }}>
            <ColorSwatches
              value={form.color}
              onChange={(c) => setForm(f => ({ ...f, color: c }))}
              options={PERSON_COLORS}
              custom
              label="Chart color"
            />
            <div className="st-chart-wrap">
              <div className="st-chart" style={{ '--c': form.color }} aria-hidden="true">
                {PREVIEW_BARS.map((v, i) => (
                  <span key={i} className={v ? '' : 'is-zero'} style={{ height: `${v * 6.5}px`, '--i': i }} />
                ))}
              </div>
              <span className="st-chart-label">Preview</span>
            </div>
          </div>
        </SettingRow>
      </div>

      <div className="st-foot">
        <ErrorNote msg={error} />
        <button type="button" className="btn btn-ghost" disabled={!dirty || saving} onClick={discard}>Discard</button>
        <SaveButton saving={saving} saved={saved} disabled={!dirty} />
      </div>

      {cropSrc && <AvatarCrop src={cropSrc} onConfirm={onCropped} onCancel={() => setCropSrc(null)} />}
    </form>
  );
}

// ─────────────────────────────── Account ───────────────────────────────

function AccountSection() {
  const { user, profile, signOut } = useAuth();
  const { userLevel } = usePets();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [emailSent, setEmailSent] = useState('');

  const [pw, setPw] = useState({ next: '', confirm: '' });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSaved, flashPw] = useFlash();
  const [confirmOut, setConfirmOut] = useState(false);

  const current = profile?.email || user?.email || '';

  const changeEmail = async (e) => {
    e.preventDefault();
    const next = email.trim();
    if (!next || next.toLowerCase() === current.toLowerCase()) { setEmailError('Enter a different email address.'); return; }
    setEmailBusy(true); setEmailError(''); setEmailSent('');
    try {
      const { error } = await supabase.auth.updateUser({ email: next });
      if (error) throw error;
      setEmailSent(next);
      setEmail('');
    } catch (err) {
      setEmailError(err.message || 'Could not change your email.');
    } finally {
      setEmailBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwError('');
    if (pw.next.length < 6) { setPwError('Password must be at least 6 characters.'); return; }
    if (pw.next !== pw.confirm) { setPwError('Passwords don’t match.'); return; }
    setPwBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: pw.next });
      if (error) throw error;
      setPw({ next: '', confirm: '' });
      flashPw();
    } catch (err) {
      setPwError(err.message || 'Could not update your password.');
    } finally {
      setPwBusy(false);
    }
  };

  const doSignOut = async () => { await signOut(); navigate('/login'); };

  return (
    <>
      <div className="st-rows stagger">
        <SettingRow label="Email" desc="The address you sign in with. We’ll send a link to confirm a new one." top col>
          <span className="st-value">{current}</span>
          <form className="st-inline-form" onSubmit={changeEmail}>
            <input
              type="email" className="input" placeholder="New email address" value={email}
              onChange={(e) => { setEmail(e.target.value); setEmailError(''); }} autoComplete="email"
            />
            <button type="submit" className="btn" disabled={!email.trim() || emailBusy}>
              {emailBusy ? <span className="spinner" /> : 'Change email'}
            </button>
          </form>
          <ErrorNote msg={emailError} />
          {emailSent && (
            <div className="notice notice-ok"><Icon name="send" size={15} />
              <span>Check <strong>{emailSent}</strong> (and your current inbox) for a confirmation link. Your email changes once it’s confirmed.</span>
            </div>
          )}
        </SettingRow>

        <SettingRow label="Password" desc="At least 6 characters." top col>
          <form onSubmit={changePassword} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="st-pair">
              <label>
                <span className="st-mini-label">New password</span>
                <input type="password" className="input" value={pw.next} autoComplete="new-password"
                  onChange={(e) => { setPw(p => ({ ...p, next: e.target.value })); setPwError(''); }} />
              </label>
              <label>
                <span className="st-mini-label">Confirm</span>
                <input type="password" className="input" value={pw.confirm} autoComplete="new-password"
                  onChange={(e) => { setPw(p => ({ ...p, confirm: e.target.value })); setPwError(''); }} />
              </label>
            </div>
            <ErrorNote msg={pwError} />
            <div>
              <SaveButton saving={pwBusy} saved={pwSaved} disabled={!pw.next || !pw.confirm}>Update password</SaveButton>
            </div>
          </form>
        </SettingRow>

        <SettingRow label="Member since" desc="When you created your TaskFlow account.">
          <span className="st-value">{user?.created_at ? longDate(user.created_at) : '—'}</span>
          {userLevel?.tasks_completed != null && (
            <span className="chip">{Number(userLevel.tasks_completed).toLocaleString()} tasks completed</span>
          )}
        </SettingRow>

        <SettingRow label="Sign out" desc="Signs you out on this device.">
          <button type="button" className="btn" onClick={() => setConfirmOut(true)}>
            <Icon name="logout" size={14} />Sign out
          </button>
        </SettingRow>
      </div>

      {confirmOut && (
        <ConfirmDialog
          title="Sign out of TaskFlow?"
          text="You can sign back in any time with your email and password."
          confirmLabel="Sign out"
          onConfirm={doSignOut}
          onClose={() => setConfirmOut(false)}
        />
      )}
    </>
  );
}

// ────────────────────────────── Appearance ─────────────────────────────

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', icon: 'sun' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
  { value: 'system', label: 'System', icon: 'monitor' },
];

function AppearanceSection() {
  const {
    mode, setThemeMode, accent, setAccent, colors, setColorValues,
    backgrounds, uploadBackground, setBackground, deleteBackground, maxBackgrounds,
  } = useThemeCustomization();
  const fileRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [bgError, setBgError] = useState('');
  const [over, setOver] = useState(false);
  const [confirmDel, setConfirmDel] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const full = backgrounds.length >= maxBackgrounds;
  const active = colors.background || null;

  const upload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setBgError('That isn’t an image.'); return; }
    if (file.size > 5 * 1024 * 1024) { setBgError('Image must be 5 MB or smaller.'); return; }
    setBgError(''); setBusy(true);
    try {
      const url = await uploadBackground(file);
      if (url) setBackground(url);
    } catch (err) {
      setBgError(err.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  };

  const doDelete = async () => {
    setDeleting(true);
    try {
      await deleteBackground(confirmDel);
      setConfirmDel(null);
      toast('Background deleted');
    } catch (err) {
      setBgError(err.message || 'Couldn’t delete it. Try again.');
      setConfirmDel(null);
    } finally {
      setDeleting(false);
    }
  };

  const glassOpacity = Math.min(Math.max(Number(colors.glassOpacity) || 0.72, 0.1), 0.98);
  const glassBlur = colors.glassBlur == null ? 14 : Number(colors.glassBlur);
  const tintColor = colors.bgTint || DEFAULT_BG_TINT;
  const tintOpacity = Math.min(Math.max(Number(colors.bgTintOpacity) || 0, 0), MAX_BG_TINT_OPACITY);
  // Picking a tint while its strength sits at 0 would look like nothing
  // happened, so give it a visible start (one commit, both keys).
  const pickTint = (hex) => setColorValues(tintOpacity > 0 ? { bgTint: hex } : { bgTint: hex, bgTintOpacity: 0.3 });

  return (
    <>
      <div className="st-rows stagger">
        <SettingRow label="Theme" desc="System follows your device’s light or dark setting.">
          <Segmented
            className="st-seg"
            value={mode}
            onChange={setThemeMode}
            options={THEME_OPTIONS}
            ariaLabel="Theme"
          />
        </SettingRow>

        <SettingRow label="Accent color" desc="Primary buttons, selected segments, switches and highlights." top col>
          <ColorSwatches
            value={accent}
            onChange={setAccent}
            onCustom={(hex) => setColorValues({ accent: hex })}
            options={ACCENTS}
            custom
            label="Accent color"
          />
          <div className="st-preview" aria-hidden="true">
            <span className="btn btn-primary btn-sm">Save changes</span>
            <input type="checkbox" className="switch" checked readOnly tabIndex={-1} />
            <span className="st-preview-tag">Selected</span>
            {accent ? (
              <span className="st-accent-hex" style={{ marginLeft: 'auto' }}>{accent.toUpperCase()}</span>
            ) : <span className="st-accent-hex" style={{ marginLeft: 'auto' }}>Ink · default</span>}
          </div>
          {accent && (
            <div>
              <button type="button" className="btn btn-ghost btn-sm anim-pop" onClick={() => setAccent('')}>
                <Icon name="undo" size={13} />Reset to ink
              </button>
            </div>
          )}
        </SettingRow>

        <SettingRow label="Background" desc="An image behind frosted-glass surfaces. Synced to your account." top col>
          <div
            className="st-bg-grid"
            onDragOver={(e) => { if (Array.from(e.dataTransfer?.types || []).includes('Files')) { e.preventDefault(); setOver(true); } }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); if (!full) upload(e.dataTransfer.files?.[0]); }}
          >
            <button
              type="button"
              className={`st-bg-tile st-bg-none ${!active ? 'is-on' : ''}`}
              onClick={() => setBackground(null)}
              aria-pressed={!active}
            >
              <span>None</span>
            </button>
            {backgrounds.map((bg, i) => (
              <div
                key={bg.id}
                role="button"
                tabIndex={0}
                className={`st-bg-tile ${active === bg.url ? 'is-on' : ''}`}
                style={{ backgroundImage: `url("${bg.url}")`, '--i': i + 1 }}
                onClick={() => setBackground(bg.url)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setBackground(bg.url); } }}
                aria-pressed={active === bg.url}
                aria-label="Use this background"
              >
                {active === bg.url && <span className="st-bg-on"><Icon name="check" size={12} stroke={2.8} /></span>}
                <button
                  type="button"
                  className="st-bg-x"
                  onClick={(e) => { e.stopPropagation(); setConfirmDel(bg); }}
                  aria-label="Delete background"
                >
                  <Icon name="x" size={12} stroke={2.4} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className={`st-bg-tile st-bg-add ${over ? 'is-over' : ''}`}
              onClick={() => fileRef.current?.click()}
              disabled={busy || full}
              style={{ '--i': backgrounds.length + 1 }}
            >
              {busy ? <span className="spinner spinner-sm" /> : <Icon name="upload" size={16} />}
              {busy ? 'Uploading…' : full ? 'Library full' : 'Upload'}
            </button>
          </div>
          <div className="st-bg-meta">
            <span className="mono">{backgrounds.length}/{maxBackgrounds}</span>
            <span>saved · drop an image here, up to 5 MB</span>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; upload(f); }} />
          <ErrorNote msg={bgError} />
        </SettingRow>

        {active && (
          <SettingRow label="Glass" desc="How solid the panels over your image are, how much it’s blurred, and an optional colour wash." top>
            <div className="st-sliders">
              <div>
                <div className="st-slider-head"><span>Glass opacity</span><span className="st-slider-val">{Math.round(glassOpacity * 100)}%</span></div>
                <Range value={glassOpacity} min={0.1} max={0.98} step={0.01} label="Glass opacity"
                  onChange={(v) => setColorValues({ glassOpacity: v })} />
              </div>
              <div>
                <div className="st-slider-head"><span>Blur</span><span className="st-slider-val">{glassBlur}px</span></div>
                <Range value={glassBlur} min={0} max={40} step={1} label="Background blur"
                  onChange={(v) => setColorValues({ glassBlur: v })} />
              </div>
              <div>
                <div className="st-slider-head">
                  <span>Tint</span>
                  <span className="st-slider-val">{tintOpacity > 0 ? `${tintColor.toUpperCase()} · ${Math.round(tintOpacity * 100)}%` : 'Off'}</span>
                </div>
                <div className="st-tint-row">
                  <label className="st-tint-swatch" style={{ '--sw': tintColor }} title="Tint colour">
                    <input type="color" value={tintColor} onChange={(e) => pickTint(e.target.value)} aria-label="Tint colour" />
                  </label>
                  <Range value={tintOpacity} min={0} max={MAX_BG_TINT_OPACITY} step={0.01} label="Tint strength"
                    onChange={(v) => setColorValues({ bgTintOpacity: v })} />
                </div>
              </div>
            </div>
          </SettingRow>
        )}
      </div>

      {confirmDel && (
        <ConfirmDialog
          title="Delete this background?"
          text={active === confirmDel.url
            ? 'It’s your current background, so the app will switch to plain. The image is removed from your account for good.'
            : 'The image is removed from your account for good. This can’t be undone.'}
          confirmLabel="Delete"
          danger
          busy={deleting}
          onConfirm={doDelete}
          onClose={() => !deleting && setConfirmDel(null)}
        />
      )}
    </>
  );
}

// ───────────────────────────── Accessibility ───────────────────────────

const reduceQuery = typeof window !== 'undefined' && window.matchMedia
  ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

function AccessibilitySection() {
  const { colors, setColorValues } = useThemeCustomization();
  const { userGamificationEnabled, setGamificationEnabled } = usePets();
  const { activeTeam } = useTeam();
  const [savingXp, setSavingXp] = useState(false);
  const [reduced, setReduced] = useState(() => !!reduceQuery?.matches);

  useEffect(() => {
    if (!reduceQuery) return undefined;
    const on = (e) => setReduced(e.matches);
    reduceQuery.addEventListener('change', on);
    return () => reduceQuery.removeEventListener('change', on);
  }, []);

  const toggleXp = async () => {
    setSavingXp(true);
    try { await setGamificationEnabled(!userGamificationEnabled); } finally { setSavingXp(false); }
  };
  const teamOff = activeTeam?.gamification_enabled === false;

  return (
    <div className="st-rows stagger">
      <SettingRow label="Text size" desc="Scales every label, heading and line of text.">
        <Segmented
          className="st-seg"
          value={Number(colors.fontScale) || 1}
          onChange={(v) => setColorValues({ fontScale: v }, true)}
          options={FONT_SCALES.map(f => ({ value: f.key, label: f.label }))}
          ariaLabel="Text size"
        />
      </SettingRow>

      <SettingRow label="Bold text" desc="Heavier body text for readability.">
        <Toggle on={!!colors.bold} onClick={() => setColorValues({ bold: !colors.bold }, true)} label="Bold text" />
      </SettingRow>

      <SettingRow label="Subtask columns" desc="Checklists on task cards. Narrow cards and phones stay single-column.">
        <Segmented
          className="st-seg"
          value={Number(colors.subtaskColumns) === 2 ? 2 : 1}
          onChange={(v) => setColorValues({ subtaskColumns: v }, true)}
          options={[{ value: 1, label: '1 column' }, { value: 2, label: '2 columns' }]}
          ariaLabel="Subtask columns"
        />
      </SettingRow>

      <SettingRow label="Reduce motion" desc="TaskFlow follows your device’s reduce-motion setting and turns animations down to a fade.">
        <span key={String(reduced)} className={`chip st-motion-tag ${reduced ? '' : 't-3'}`}>
          {reduced ? 'On — from your device' : 'Off — from your device'}
        </span>
      </SettingRow>

      <SettingRow
        label="Show levels & XP"
        desc={teamOff
          ? `Turned off for ${activeTeam?.name || 'this team'} by an admin. Your XP still adds up in the background.`
          : 'The level ring in the top bar and the XP you earn for tasks. Off pauses it; you pick up where you left off.'}
      >
        <Toggle on={userGamificationEnabled} onClick={toggleXp} disabled={savingXp} label="Show levels and XP" />
      </SettingRow>
    </div>
  );
}

// ──────────────────────────────── Page ─────────────────────────────────

export default function Settings() {
  const [params, setParams] = useSearchParams();
  const section = resolveSettingsSection(params.get('section'));
  const current = SECTIONS.find(s => s.id === section);

  // One highlight that glides to the active item — measured, so it works for
  // the vertical list and the phone's horizontal chip row alike.
  const listRef = useRef(null);
  const [pill, setPill] = useState(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const measure = () => {
      const el = list.querySelector('.st-nav-item.is-on');
      if (!el) return;
      setPill(p => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, anim: !!p }));
      if (list.scrollWidth > list.clientWidth) {
        const left = el.offsetLeft - list.scrollLeft;
        if (left < 0 || left + el.offsetWidth > list.clientWidth) {
          list.scrollTo({ left: el.offsetLeft - 16, behavior: 'smooth' });
        }
      }
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  }, [section]);

  const go = (id) => {
    if (id === section) return;
    const next = new URLSearchParams(params);
    next.set('section', id);
    setParams(next, { replace: true });
    if (window.innerWidth <= 768) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="st-page">
      <nav className="st-nav" aria-label="Settings sections">
        <div className="st-nav-inner">
          <div className="eyebrow">Settings</div>
          <div ref={listRef} className={`st-nav-list ${pill ? 'has-pill' : ''}`}>
            {pill && (
              <span
                className={`st-nav-pill ${pill.anim ? 'is-anim' : ''}`}
                style={{ width: pill.w, height: pill.h, transform: `translate(${pill.x}px, ${pill.y}px)` }}
                aria-hidden="true"
              />
            )}
            {SECTIONS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={`st-nav-item ${section === s.id ? 'is-on' : ''}`}
                style={{ '--i': i }}
                onClick={() => go(s.id)}
                aria-current={section === s.id ? 'page' : undefined}
              >
                <Icon name={s.icon} size={16} />
                {s.label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="st-main">
        <div key={section} className="st-panel">
          <header className="st-head">
            <div className="eyebrow">Settings</div>
            <h1 className="page-title">{current.label}</h1>
            <p className="page-sub">{current.blurb}</p>
          </header>

          {section === 'profile' && <ProfileSection />}
          {section === 'account' && <AccountSection />}
          {section === 'teams' && <TeamSettings />}
          {section === 'presets' && <SubtaskPresetsCard />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'accessibility' && <AccessibilitySection />}
        </div>
      </div>
    </div>
  );
}
