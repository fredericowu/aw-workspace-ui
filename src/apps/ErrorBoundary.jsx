// Per-contribution ErrorBoundary (ADR Decision 3b crash-containment + the SPA
// graceful-degradation rule). A throwing app component renders an inline error
// card and calls onError (which increments the app's error counter → circuit
// breaker) instead of blanking the dashboard. Scoped per slot mount / window
// body so one bad contribution never takes others down.
import { Component } from 'react';

export default class AppErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    this.props.onError?.(error, info);
    console.error(`[apps] contribution "${this.props.label || 'app'}" crashed`, error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app-contrib-error" role="alert" data-testid="app-contrib-error">
          <span className="app-contrib-error-title">
            {this.props.label ? `${this.props.label} failed to render` : 'App component failed to render'}
          </span>
          <span className="app-contrib-error-detail">{String(this.state.error.message || this.state.error)}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
