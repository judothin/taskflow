import React, { useRef, useState } from 'react';
import { format, isThisYear, formatDistanceToNowStrict } from 'date-fns';
import Icon from './Icon';
import ModalPortal from '../components/ModalPortal';
import { useEscapeStack } from './Sheet';

// ── Status / priority vocabulary, shared by every page ──────────────
export const STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
];
export const STATUS_LABEL = {
  critical: 'Critical', open: 'Open', in_progress: 'In progress', on_hold: 'On hold', completed: 'Completed',
};
export const ROIS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];
export const COMPLEXITIES = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];
export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ') : '');

// ── Dates ── short and calm: "Oct 2", "Mar 31, 2025", "Oct 2, 2026 · 8:38 AM"
export function shortDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  return format(dt, isThisYear(dt) ? 'MMM d' : 'MMM d, yyyy');
}
export function longDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '' : `${format(dt, 'MMM d, yyyy')} · ${format(dt, 'h:mm a')}`;
}
export function ago(d) {
  if (!d) return '';
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return '';
  const s = (Date.now() - dt.getTime()) / 1000;
  if (s < 45) return 'just now';
  return `${formatDistanceToNowStrict(dt)} ago`;
}

// ── People ──
export function fullName(p) {
  if (!p) return '';
  return `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.email || '';
}
export function initialsOf(nameOrPerson) {
  const name = typeof nameOrPerson === 'string' ? nameOrPerson : fullName(nameOrPerson);
  const parts = (name || '?').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return ((parts[0][0] || '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Round avatar: photo if there is one, else initials on a warm chip. */
export function Avatar({ person, name, src, size = 28, className = '', title }) {
  const url = src || person?.avatar_url;
  const label = name || fullName(person);
  const style = { width: size, height: size, fontSize: Math.max(9, Math.round(size * 0.36)) };
  if (url) {
    return (
      <span className={`avatar ${className}`} style={style} title={title || label}>
        <img src={url} alt="" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
      </span>
    );
  }
  return <span className={`avatar ${className}`} style={style} title={title || label}>{initialsOf(label)}</span>;
}

export function AvatarStack({ people = [], size = 22, max = 4 }) {
  const shown = people.slice(0, max);
  return (
    <span className="avatar-stack">
      {shown.map((p, i) => <Avatar key={p?.id || i} person={p} size={size} />)}
      {people.length > max && <span className="avatar" style={{ width: size, height: size }}>+{people.length - max}</span>}
    </span>
  );
}

/** "● In progress" */
export function StatusLabel({ status, label }) {
  return (
    <span className="status">
      <span className={`dot dot-${status}`} />
      {label || STATUS_LABEL[status] || cap(status)}
    </span>
  );
}

/** The two-by-two status picker used in the task sheet. */
export function StatusPicker({ value, onChange, options = STATUSES }) {
  return (
    <div className="opt-grid" role="radiogroup" aria-label="Status">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`opt ${value === o.value ? 'is-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          <span className={`dot dot-${o.value}`} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Eyebrow + big title + subtitle, with actions on the right. */
export function PageHeader({ eyebrow, title, sub, actions, small }) {
  return (
    <header className="page-head anim-rise">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className={`page-title ${small ? 'page-title-sm' : ''}`}>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {actions && <div className="toolbar">{actions}</div>}
    </header>
  );
}

export function Empty({ icon = 'inbox', title, children, action }) {
  return (
    <div className="empty">
      <span className="empty-icon"><Icon name={icon} size={20} /></span>
      {title && <div className="empty-title">{title}</div>}
      {children && <div>{children}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Search', autoFocus, className = '', inputRef }) {
  return (
    <label className={`search ${className}`}>
      <Icon name="search" size={14} />
      <input
        ref={inputRef}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        spellCheck={false}
      />
      {value && (
        <button type="button" className="search-clear" onClick={() => onChange('')} aria-label="Clear search">
          <Icon name="x" size={12} />
        </button>
      )}
    </label>
  );
}

/**
 * Dashed drop target that also opens the file picker on click.
 *   <Dropzone onFiles={addFiles} accept="image/*" title="Drop screenshots or paste" sub="Optional" />
 */
export function Dropzone({ onFiles, accept, multiple = true, title = 'Attach files or paste', sub, row, disabled }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const has = (e) => Array.from(e.dataTransfer?.types || []).includes('Files');
  return (
    <div
      className={`dropzone ${row ? 'dropzone-row' : ''} ${over ? 'is-over' : ''}`}
      role="button"
      tabIndex={0}
      aria-disabled={disabled}
      onClick={() => !disabled && input.current?.click()}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); input.current?.click(); } }}
      onDragEnter={(e) => { if (!has(e)) return; e.preventDefault(); e.stopPropagation(); depth.current += 1; setOver(true); }}
      onDragOver={(e) => { if (!has(e)) return; e.preventDefault(); e.stopPropagation(); }}
      onDragLeave={(e) => { e.stopPropagation(); depth.current = Math.max(0, depth.current - 1); if (!depth.current) setOver(false); }}
      onDrop={(e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault(); e.stopPropagation(); depth.current = 0; setOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      <Icon name="upload" size={18} />
      <span>{title}</span>
      {sub && <span className="dropzone-sub">{sub}</span>}
      <input
        ref={input} type="file" hidden accept={accept} multiple={multiple}
        onChange={(e) => { onFiles(Array.from(e.target.files || [])); e.target.value = ''; }}
      />
    </div>
  );
}

/** Click-to-close full screen image preview. */
export function Lightbox({ src, onClose }) {
  useEscapeStack(onClose);
  if (!src) return null;
  return (
    <ModalPortal>
      <div className="lightbox" onClick={onClose}><img src={src} alt="" /></div>
    </ModalPortal>
  );
}

/** Mono uppercase label used above sections inside sheets. */
export function SheetLabel({ children, sub }) {
  return <span className="sheet-label">{children}{sub && <span className="sub">{sub}</span>}</span>;
}

/** Title + description checkbox row. */
export function CheckRow({ checked, onChange, title, desc }) {
  return (
    <label className="check-row">
      <input type="checkbox" className="check" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span>
        <span className="check-row-title">{title}</span>
        {desc && <span className="check-row-desc" style={{ display: 'block' }}>{desc}</span>}
      </span>
    </label>
  );
}

/** Rows of skeleton lines for a table that's still loading. */
export function SkeletonRows({ rows = 5, widths = ['44%', '18%', '10%', '14%'] }) {
  return (
    <div>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skel-row">
          {widths.map((w, j) => <span key={j} className="skel skel-line" style={{ width: w, opacity: 1 - i * 0.12 }} />)}
        </div>
      ))}
    </div>
  );
}
