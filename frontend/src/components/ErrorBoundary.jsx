import { Component } from "react";
import { isChunkLoadError, reportError } from "../utils/errorReporter";

// Top-level error boundary (main.jsx): if rendering anything crashes, show
// a friendly page instead of a blank screen, and report the error
// (utils/errorReporter.js). A failed lazy-chunk load (usually a new
// version was deployed while the page was open) gets its own message and
// isn't reported. Plain markup and inline-safe classes only: this renders
// when the rest of the app may be broken, outside the router.
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    reportError("boundary", error, { componentStack: info?.componentStack });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const isNewVersion = isChunkLoadError(error);
    return (
      <div className="min-h-screen bg-surface-warm flex items-center justify-center px-6 py-16" role="alert">
        <div className="max-w-md w-full text-center bg-white rounded-3xl border border-gray-100 shadow-sm p-8">
          <h1 className="font-serif text-2xl font-bold text-gray-900">
            {isNewVersion ? "A new version of Kenlibs is available" : "Something went wrong"}
          </h1>
          <p className="text-gray-500 mt-3">
            {isNewVersion
              ? "Refresh the page to load it. Anything you saved is safe."
              : "Please refresh the page. If it keeps happening, try again in a little while; we've been told about it."}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-6 py-3 rounded-2xl font-semibold text-white bg-accent hover:bg-accent-hover"
            >
              Refresh
            </button>
            <a href="/kenlibs" className="px-6 py-3 rounded-2xl font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200">
              Go to Kenlibs
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
