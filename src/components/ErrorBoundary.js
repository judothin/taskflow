import React from 'react';

// Catches render/lifecycle throws in the page tree so a bug shows a recoverable
// message instead of a blank white screen. (React error boundaries must be
// class components.)
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Surface it for debugging; never swallow silently.
    // eslint-disable-next-line no-console
    console.error('Page crashed:', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <div className="empty">
          <span className="empty-icon">!</span>
          <div className="empty-title">Something went wrong on this page</div>
          <div className="mono t-3" style={{ fontSize: 12.5, maxWidth: 520 }}>{String(this.state.error?.message || this.state.error)}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
            <button type="button" className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
            <button type="button" className="btn btn-primary" onClick={() => { window.location.href = '/dashboard'; }}>Back to dashboard</button>
          </div>
        </div>
      </div>
    );
  }
}
