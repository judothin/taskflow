import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { usePets } from '../context/PetContext';
import './Auth.css';

const PRESET_COLORS = [
  '#6366f1','#ec4899','#f59e0b','#10b981','#3b82f6',
  '#8b5cf6','#ef4444','#06b6d4','#84cc16','#f97316'
];

export default function Register() {
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '', confirm: '', color: '#6366f1'
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signUp } = useAuth();
  const { refresh: refreshPets } = usePets();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) { setError('Passwords do not match'); return; }
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return; }
    setLoading(true);
    try {
      await signUp(form.email, form.password, form.firstName, form.lastName, form.color);
      // AuthContext's onAuthStateChange listener can fire (and trigger
      // PetContext's very first fetch) before signUp()'s own sequential
      // profiles/user_levels inserts above have actually landed — that
      // race left PetContext caching a stale "no row yet" result, which
      // meant RequireGamificationChoice saw nothing usable and let
      // RequirePet send new signups straight to the pet-reveal crate
      // *before* the choose-gamification screen ever got a chance to show.
      // Explicitly refreshing here (now that the inserts are guaranteed
      // done) forces PetContext to pick up the real row.
      await refreshPets();
      const invite = searchParams.get('invite');
      navigate(invite ? `/onboarding?invite=${invite}` : '/onboarding');
    } catch (err) {
      setError(err.message || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-bg">
        <div className="auth-orb auth-orb-1" />
        <div className="auth-orb auth-orb-2" />
      </div>

      <div className="auth-card fade-in" style={{ maxWidth: 480 }}>
        <div className="auth-logo">
          <img src="/logo.png" alt="TaskFlow" style={{ margin: '0 auto 16px', width: 44, height: 44, borderRadius: 8, objectFit: 'contain', display: 'block' }} />
          <h1>Create account</h1>
          <p>Join your team on TaskFlow</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="form-grid form-grid-2">
            <div className="form-group">
              <label className="label">First Name</label>
              <input className="input" placeholder="Jane" value={form.firstName} onChange={set('firstName')} required />
            </div>
            <div className="form-group">
              <label className="label">Last Name</label>
              <input className="input" placeholder="Doe" value={form.lastName} onChange={set('lastName')} required />
            </div>
          </div>

          <div className="form-group">
            <label className="label">Email</label>
            <input type="email" className="input" placeholder="you@company.com" value={form.email} onChange={set('email')} required />
          </div>

          <div className="form-group">
            <label className="label">Password</label>
            <input type="password" className="input" placeholder="Min. 6 characters" value={form.password} onChange={set('password')} required />
          </div>

          <div className="form-group">
            <label className="label">Confirm Password</label>
            <input type="password" className="input" placeholder="••••••••" value={form.confirm} onChange={set('confirm')} required />
          </div>

          <div className="form-group">
            <label className="label">Your Chart Color</label>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
              This color will represent you on the activity chart
            </p>
            <div className="color-picker-row">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch ${form.color === c ? 'color-swatch-active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setForm(f => ({ ...f, color: c }))}
                />
              ))}
              <input
                type="color"
                value={form.color}
                onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                className="color-custom-input"
                title="Custom color"
              />
            </div>
          </div>

          {error && <div className="error-msg">⚠ {error}</div>}

          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={loading}>
            {loading ? 'Creating account...' : 'Create Account'}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
