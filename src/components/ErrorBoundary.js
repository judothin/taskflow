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
      <div className="error-boundary">
        <div className="error-boundary-card">
          <h2 className="error-boundary-title">Something went wrong on this page</h2>
          <p className="error-boundary-msg">{String(this.state.error?.message || this.state.error)}</p>
          <div className="error-boundary-actions">
            <button className="btn btn-secondary" onClick={() => this.setState({ error: null })}>Try again</button>
            <button className="btn btn-primary" onClick={() => { window.location.href = '/dashboard'; }}>Back to dashboard</button>
          </div>
        </div>
      </div>
    );
  }
}
