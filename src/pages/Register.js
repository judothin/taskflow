import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePets } from '../context/PetContext';
import { Icon } from '../ui';
import ColorSwatches, { PERSON_COLORS } from '../components/ColorSwatches';
import './Auth.css';

export default function Register() {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '', confirm: '', color: PERSON_COLORS[0],
  });
  const [error, setError] = useState('');
  const [errTick, setErrTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const { refresh: refreshLevels } = usePets();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const invite = searchParams.get('invite');

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
  const fail = (msg) => { setError(msg); setErrTick(t => t + 1); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password.length < 6) { fail('Password must be at least 6 characters.'); return; }
    if (form.password !== form.confirm) { fail('Passwords don’t match.'); return; }
    setLoading(true);
    try {
      await signUp(form.email.trim(), form.password, form.firstName.trim(), form.lastName.trim(), form.color);
      // The auth listener can fetch the level row before signUp's own insert
      // lands; refresh now that it has.
      await refreshLevels();
      navigate(invite ? `/onboarding?invite=${invite}` : '/onboarding');
    } catch (err) {
      fail(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="au-page">
      <div className="au-card au-card-wide">
        <div className="au-logo" aria-hidden="true">T</div>
        <h1 className="au-title">Create your account</h1>
        <p className="au-sub">{invite ? 'You’ve been invited to a team. Make an account to join it.' : 'Join your team on TaskFlow.'}</p>

        <form onSubmit={handleSubmit} className="au-form stagger">
          <div className="au-pair">
            <label className="field">
              <span className="field-label">First name</span>
              <input className="input" placeholder="Jane" value={form.firstName} onChange={set('firstName')} autoComplete="given-name" required autoFocus />
            </label>
            <label className="field">
              <span className="field-label">Last name</span>
              <input className="input" placeholder="Doe" value={form.lastName} onChange={set('lastName')} autoComplete="family-name" required />
            </label>
          </div>

          <label className="field">
            <span className="field-label">Email</span>
            <input type="email" className="input" placeholder="you@company.com" value={form.email} onChange={set('email')} autoComplete="email" required />
          </label>

          <div className="au-pair">
            <label className="field">
              <span className="field-label">Password</span>
              <input type="password" className="input" placeholder="Min. 6 characters" value={form.password} onChange={set('password')} autoComplete="new-password" required />
            </label>
            <label className="field">
              <span className="field-label">Confirm</span>
              <input type="password" className="input" placeholder="••••••••" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
            </label>
          </div>

          <div className="field">
            <span className="field-label">Your color <span className="opt-hint">· for your avatar and the activity chart</span></span>
            <ColorSwatches value={form.color} onChange={(c) => setForm(f => ({ ...f, color: c }))} custom label="Your color" />
          </div>

          {error && (
            <div key={errTick} className="notice notice-error wiggle" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>
          )}

          <button type="submit" className="btn btn-primary btn-block au-submit" disabled={loading}>
            {loading ? <span className="spinner" /> : <>Create account <Icon name="arrowRight" size={15} /></>}
          </button>
        </form>

        <div className="au-foot">
          Already have an account? <Link to={invite ? `/login?invite=${invite}` : '/login'}>Sign in</Link>
        </div>
      </div>
    </div>
  );
}
