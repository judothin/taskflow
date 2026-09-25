import React, { useEffect, useRef, useState } from 'react';
import { useThemeCustomization } from '../context/ThemeCustomizationContext';
import { Toggle } from '../components/SettingsControls';
import {
  THEME_FIELDS, STATUS_FIELDS, FONT_SCALES,
  DEFAULT_BG_TINT, MAX_BG_TINT_OPACITY, cacheBackgroundImage,
} from '../lib/themeColors';
import './MobileAppearance.css';

// ══════════════════════════════════════════════════════════════
// Appearance, phone edition
// --------------------------------------------------------------
// Everything here writes to the theme's `mobile` overrides (see
// resolveForDevice in lib/themeColors.js), so it changes how the app looks
// on a phone and leaves desktop alone. Anything not touched here keeps
// following desktop, and "Reset to match desktop" drops every override.
//
// Uploaded images go into the same shared library desktop uses (so they're
// pickable on both), but uploading here only sets the PHONE's background.
// ══════════════════════════════════════════════════════════════

// Module-level for a stable identity: defined inside the page, every colour
// change would remount the <input type="color"> and close the picker mid-drag.
function ColorRow({ field, value, custom, onChange, onReset }) {
  return (
    <div className="mapp-color-row">
      <label className="mapp-swatch" style={{ background: value }}>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={field.label}
        />
      </label>
      <div className="mapp-row-text">
        <div className="mapp-row-label">{field.label}</div>
        <div className="mapp-row-sub">
          <span className="mapp-hex">{value.toUpperCase()}</span>
          {custom && <span className="mapp-chip">Phone only</span>}
        </div>
      </div>
      {custom && (
        <button type="button" className="mapp-undo" onClick={onReset}>Use desktop</button>
      )}
    </div>
  );
}

function Section({ title, custom, onReset, children, collapsible = false, defaultOpen = true }) {
  const head = (
    <>
      <span className="mapp-section-title">{title}</span>
      {custom > 0 && <span className="mapp-chip">{custom} changed</span>}
    </>
  );
  const resetBtn = custom > 0 && onReset && (
    <button type="button" className="mapp-undo mapp-section-undo" onClick={onReset}>Use desktop</button>
  );

  if (collapsible) {
    return (
      <details className="mapp-section" open={defaultOpen}>
        <summary className="mapp-section-head">
          <svg className="mapp-chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9 18l6-6-6-6" />
          </svg>
          {head}
        </summary>
        <div className="mapp-section-body">
          {children}
          {resetBtn}
        </div>
      </details>
    );
  }
  return (
    <section className="mapp-section">
      <div className="mapp-section-head">{head}</div>
      <div className="mapp-section-body">
        {children}
        {resetBtn}
      </div>
    </section>
  );
}

function Segmented({ options, value, onChange, label }) {
  return (
    <div className="mapp-seg" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`mapp-seg-btn ${value === o.value ? 'mapp-seg-btn-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Slider({ label, display, ...input }) {
  return (
    <div className="mapp-slider">
      <div className="mapp-slider-head">
        <span>{label}</span>
        <span className="mapp-slider-value">{display}</span>
      </div>
      <input type="range" className="mapp-range" aria-label={label} {...input} />
    </div>
  );
}

const LOGO_OPTIONS = [
  { value: 'auto', label: 'Auto' }, { value: 'white', label: 'White' }, { value: 'black', label: 'Black' },
];

// Keys each section owns, so its "Use desktop" resets exactly those.
const INTERFACE_KEYS = THEME_FIELDS.map(f => f.key);
const STATUS_KEYS = STATUS_FIELDS.map(f => f.key);
const BACKGROUND_KEYS = ['background', 'glassOpacity', 'glassBlur', 'bgTint', 'bgTintOpacity'];
const TEXT_KEYS = ['fontScale', 'bold'];

export default function MobileAppearance() {
  const {
    phoneColors: c, mobileColors, setMobileValues, resetMobileKey, resetMobileAll,
    getPhoneColor, isMobileCustom, backgrounds, savedThemes, applyThemeToMobile,
    maxBackgrounds, uploadBackground,
  } = useThemeCustomization();

  const countOf = (keys) => keys.filter(isMobileCustom).length;
  const total = Object.keys(mobileColors).length;

  // Two-tap reset instead of a dialog: the first tap arms it, and it disarms
  // itself if you don't follow through.
  const [armed, setArmed] = useState(false);
  const armTimer = useRef(null);
  useEffect(() => () => clearTimeout(armTimer.current), []);
  const onReset = () => {
    if (!armed) {
      setArmed(true);
      clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmed(false), 3500);
      return;
    }
    clearTimeout(armTimer.current);
    setArmed(false);
    resetMobileAll();
  };

  const [appliedTheme, setAppliedTheme] = useState(null);

  const tintColor = c.bgTint || DEFAULT_BG_TINT;
  const tintOpacity = Math.min(Math.max(Number(c.bgTintOpacity) || 0, 0), MAX_BG_TINT_OPACITY);
  // Picking a tint colour at 0% strength would look like nothing happened.
  const onTintColor = (hex) =>
    setMobileValues(tintOpacity > 0 ? { bgTint: hex } : { bgTint: hex, bgTintOpacity: 0.3 });

  // null, not a missing key: "no background on the phone" even when desktop has one.
  const pickBackground = (url) => {
    setMobileValues({ background: url }, true);
    if (url) cacheBackgroundImage(url);
  };

  // Same limits as the desktop uploader in Settings.
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const full = backgrounds.length >= maxBackgrounds;
  const onUpload = async (e) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { setUploadError("That file isn't an image."); return; }
    if (file.size > 5 * 1024 * 1024) { setUploadError('Image must be 5 MB or smaller.'); return; }
    setUploadError('');
    setUploading(true);
    try {
      const url = await uploadBackground(file);
      if (url) pickBackground(url);
    } catch (err) {
      setUploadError(err?.message || 'Upload failed. Try again.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mapp fade-in">
      <header className="mapp-head">
        <div className="mapp-head-icon" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="13.5" cy="6.5" r="1.5" /><circle cx="17.5" cy="10.5" r="1.5" /><circle cx="8.5" cy="7.5" r="1.5" /><circle cx="6.5" cy="12.5" r="1.5" />
            <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.5-.75 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c3.31 0 6-2.69 6-6 0-4.96-4.49-9-10-9z" />
          </svg>
        </div>
        <div className="mapp-head-text">
          <h1 className="mapp-title">Appearance</h1>
          <p className="mapp-sub">Changes here only apply on your phone.</p>
        </div>
      </header>

      <div className={`mapp-sync ${total ? 'mapp-sync-custom' : ''}`}>
        <span className="mapp-sync-dot" aria-hidden="true" />
        <div className="mapp-sync-text">
          <div className="mapp-sync-title">
            {total ? `${total} change${total === 1 ? '' : 's'} from desktop` : 'Matching desktop'}
          </div>
          <div className="mapp-sync-sub">
            {total
              ? 'Everything else still follows your desktop look.'
              : 'Change anything below to give your phone its own look.'}
          </div>
        </div>
      </div>
      <button
        type="button"
        className={`mapp-reset ${armed ? 'mapp-reset-armed' : ''}`}
        onClick={onReset}
        disabled={!total}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M1 4v6h6" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
        </svg>
        {armed ? 'Tap again to reset' : 'Reset to match desktop'}
      </button>

      <Section title="Colors" custom={countOf(INTERFACE_KEYS)} onReset={() => resetMobileKey(...INTERFACE_KEYS)}>
        {THEME_FIELDS.map(f => (
          <ColorRow key={f.key} field={f} value={getPhoneColor(f.key)} custom={isMobileCustom(f.key)}
            onChange={(v) => setMobileValues({ [f.key]: v })} onReset={() => resetMobileKey(f.key)} />
        ))}
      </Section>

      <Section title="Status colors" collapsible defaultOpen={false}
        custom={countOf(STATUS_KEYS)} onReset={() => resetMobileKey(...STATUS_KEYS)}>
        {STATUS_FIELDS.map(f => (
          <ColorRow key={f.key} field={f} value={getPhoneColor(f.key)} custom={isMobileCustom(f.key)}
            onChange={(v) => setMobileValues({ [f.key]: v })} onReset={() => resetMobileKey(f.key)} />
        ))}
      </Section>

      <Section title="Background" custom={countOf(BACKGROUND_KEYS)} onReset={() => resetMobileKey(...BACKGROUND_KEYS)}>
        <input ref={fileRef} type="file" accept="image/*" onChange={onUpload} hidden />
        <div className="mapp-bg-grid">
          <button
            type="button"
            className="mapp-bg mapp-bg-upload"
            onClick={() => fileRef.current?.click()}
            disabled={uploading || full}
          >
            {uploading ? (
              <span className="mapp-spinner" aria-hidden="true" />
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            )}
            <span>{uploading ? 'Uploading…' : full ? 'Library full' : 'Upload'}</span>
          </button>
          <button
            type="button"
            className={`mapp-bg mapp-bg-none ${!c.background ? 'mapp-bg-on' : ''}`}
            onClick={() => pickBackground(null)}
            aria-pressed={!c.background}
          >
            None
          </button>
          {backgrounds.map(bg => (
            <button
              key={bg.id}
              type="button"
              className={`mapp-bg ${c.background === bg.url ? 'mapp-bg-on' : ''}`}
              style={{ backgroundImage: `url("${bg.url}")` }}
              onClick={() => pickBackground(bg.url)}
              aria-pressed={c.background === bg.url}
              aria-label="Use this background"
            />
          ))}
        </div>
        {uploadError && <p className="mapp-error">⚠ {uploadError}</p>}
        <p className="mapp-note">
          {full
            ? `You've saved ${maxBackgrounds} images, the most allowed. Delete one from Settings on desktop to upload another.`
            : `Up to 5 MB. Uploads go in your image library (${backgrounds.length}/${maxBackgrounds}) and are set as your phone's background.`}
        </p>

        {c.background && (
          <div className="mapp-sliders">
            <Slider
              label="Glass opacity"
              display={`${Math.round((c.glassOpacity ?? 0.55) * 100)}%`}
              min="0.2" max="0.95" step="0.05"
              value={c.glassOpacity ?? 0.55}
              onChange={(e) => setMobileValues({ glassOpacity: Number(e.target.value) })}
            />
            <Slider
              label="Glass blur"
              display={`${c.glassBlur ?? 14}px`}
              min="0" max="30" step="1"
              value={c.glassBlur ?? 14}
              onChange={(e) => setMobileValues({ glassBlur: Number(e.target.value) })}
            />
            <div className="mapp-slider">
              <div className="mapp-slider-head">
                <span>Tint</span>
                <span className="mapp-slider-value">
                  {tintOpacity > 0 ? `${tintColor.toUpperCase()} · ${Math.round(tintOpacity * 100)}%` : 'Off'}
                </span>
              </div>
              <div className="mapp-tint-row">
                <label className="mapp-swatch mapp-swatch-sm" style={{ background: tintColor }}>
                  <input type="color" value={tintColor} onChange={(e) => onTintColor(e.target.value)} aria-label="Tint color" />
                </label>
                <input
                  type="range"
                  className="mapp-range"
                  min="0" max={MAX_BG_TINT_OPACITY} step="0.05"
                  value={tintOpacity}
                  onChange={(e) => setMobileValues({ bgTintOpacity: Number(e.target.value) })}
                  aria-label="Tint strength"
                />
              </div>
            </div>
          </div>
        )}
      </Section>

      <Section title="Text" custom={countOf(TEXT_KEYS)} onReset={() => resetMobileKey(...TEXT_KEYS)}>
        <div className="mapp-field-label">Text size</div>
        <Segmented
          label="Text size"
          options={FONT_SCALES.map(o => ({ value: o.key, label: o.label === 'Extra Large' ? 'XL' : o.label }))}
          value={Number(c.fontScale) || 1}
          onChange={(v) => setMobileValues({ fontScale: v }, true)}
        />
        <div className="mapp-toggle-row">
          <div className="mapp-row-text">
            <div className="mapp-row-label">Bold text</div>
            <div className="mapp-row-sub">Heavier body text for readability</div>
          </div>
          <Toggle on={!!c.bold} onClick={() => setMobileValues({ bold: !c.bold }, true)} label="Bold text" />
        </div>
      </Section>

      <Section title="Logo" custom={countOf(['logo'])} onReset={() => resetMobileKey('logo')}>
        <Segmented
          label="Logo tint"
          options={LOGO_OPTIONS}
          value={c.logo || 'auto'}
          onChange={(v) => setMobileValues({ logo: v }, true)}
        />
      </Section>

      {savedThemes.length > 0 && (
        <Section title="Saved themes">
          <p className="mapp-note mapp-note-top">Apply one of your themes to your phone only.</p>
          <div className="mapp-themes">
            {savedThemes.map(t => (
              <button
                key={t.id}
                type="button"
                className="mapp-theme"
                onClick={() => {
                  applyThemeToMobile(t);
                  setAppliedTheme(t.id);
                  setTimeout(() => setAppliedTheme(id => (id === t.id ? null : id)), 1600);
                }}
              >
                <span className="mapp-theme-swatches" aria-hidden="true">
                  {t.colors?.background && (
                    <span className="mapp-theme-img" style={{ backgroundImage: `url("${t.colors.background}")` }} />
                  )}
                  {['bg', 'accent', 'text'].map(k => (
                    <span key={k} style={{ background: t.colors?.[k] || 'var(--bg-4)' }} />
                  ))}
                </span>
                <span className="mapp-theme-name">{t.name}</span>
                <span className={`mapp-theme-action ${appliedTheme === t.id ? 'mapp-theme-action-done' : ''}`}>
                  {appliedTheme === t.id ? 'Applied' : 'Apply'}
                </span>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}
