import React, { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Icon } from '../ui';
import './Auth.css';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [errTick, setErrTick] = useState(0);
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const invite = params.get('invite');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await signIn(email.trim(), password);
      navigate(invite ? `/onboarding?invite=${invite}` : '/dashboard');
    } catch (err) {
      setError(err.message || 'Invalid email or password');
      setErrTick(t => t + 1);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="au-page">
      <div className="au-card">
        <div className="au-logo" aria-hidden="true">T</div>
        <h1 className="au-title">Sign in to TaskFlow</h1>
        <p className="au-sub">Welcome back. Pick up where you left off.</p>

        <form onSubmit={handleSubmit} className="au-form stagger">
          <label className="field">
            <span className="field-label">Email</span>
            <input
              type="email" className="input" placeholder="you@company.com" autoComplete="email"
              value={email} onChange={e => setEmail(e.target.value)} required autoFocus
            />
          </label>
          <label className="field">
            <span className="field-label">Password</span>
            <input
              type="password" className="input" placeholder="••••••••" autoComplete="current-password"
              value={password} onChange={e => setPassword(e.target.value)} required
            />
          </label>

          {error && (
            <div key={errTick} className="notice notice-error wiggle" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>
          )}

          <button type="submit" className="btn btn-primary btn-block au-submit" disabled={loading}>
            {loading ? <span className="spinner" /> : <>Sign in <Icon name="arrowRight" size={15} /></>}
          </button>
        </form>

        <div className="au-foot">
          New to TaskFlow? <Link to={invite ? `/register?invite=${invite}` : '/register'}>Create an account</Link>
        </div>
      </div>
    </div>
  );
}
