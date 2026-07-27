import { Component } from 'react';

/**
 * Contains a crash in a single widget/panel so it never blanks the whole app.
 *
 * Durable safety net for the strangler-migration period: as routes migrate to
 * the BYOD aw-workspace, unmigrated endpoints 404 and an unguarded widget can
 * throw during render. Wrapping each independent widget here means that crash
 * shows a small "unavailable" fallback instead of taking down the entire
 * React tree.
 *
 * Props:
 *  - label: short name shown in the fallback ("Agents", "VPN", …)
 *  - silent: render nothing on crash instead of a fallback chip
 *  - fallback: custom fallback node (overrides the default)
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // Keep it visible in the console for debugging, but don't rethrow.
    console.error(`[ErrorBoundary${this.props.label ? ` ${this.props.label}` : ''}]`, error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.silent) return null;
    if (this.props.fallback !== undefined) return this.props.fallback;
    return (
      <span
        className="px-2 py-1 text-[11px] rounded text-[var(--color-text-muted)] opacity-60"
        title={`${this.props.label || 'This widget'} is unavailable`}
      >
        {this.props.label || 'Widget'} unavailable
      </span>
    );
  }
}
