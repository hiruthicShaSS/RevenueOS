import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

/** Keeps a crash in one page from blanking the whole app. Resets when the route changes. */
export default class ErrorBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="mx-auto mt-16 max-w-lg rounded-2xl border border-bad/25 bg-bad/5 p-6 text-center">
        <AlertTriangle className="mx-auto h-6 w-6 text-bad" />
        <div className="mt-3 text-sm font-medium text-fg">This page hit an error</div>
        <div className="mt-1 break-words text-xs text-mute">{this.state.error.message}</div>
        <button onClick={() => this.setState({ error: null })} className="mt-4 rounded-lg border border-line-2 px-3 py-1.5 text-xs text-soft hover:text-fg">
          Try again
        </button>
      </div>
    );
  }
}
