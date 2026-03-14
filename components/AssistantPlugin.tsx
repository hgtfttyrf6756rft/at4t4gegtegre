import React, { useState, useEffect, useCallback } from 'react';
import { storageService } from '../services/storageService';
import { ResearchProject } from '../types';

// ─── Build the Babel CDN URL ───────────────────────────────────────────
const BABEL_CDN = 'https://cdn.jsdelivr.net/npm/@babel/standalone@7.24.0/babel.min.js';

let babelLoaded = false;
let babelLoadPromise: Promise<void> | null = null;

const loadBabel = (): Promise<void> => {
  if (babelLoaded) return Promise.resolve();
  if (babelLoadPromise) return babelLoadPromise;
  babelLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = BABEL_CDN;
    script.onload = () => { babelLoaded = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return babelLoadPromise;
};

// ─── Scope provided to every plugin ───────────────────────────────────
const buildScope = (project: ResearchProject, extraProps: Record<string, any>) => ({
  React,
  useState,
  useEffect,
  useCallback,
  storageService,
  fetch: window.fetch.bind(window),
  project,
  ...extraProps,
});

export interface AssistantPluginProps {
  slot: string;
  code: string;                        // raw JSX/JS source from Firestore
  project: ResearchProject;
  isDarkMode: boolean;
  apiKeys?: Record<string, string>;    // user's stored API keys
  extraProps?: Record<string, any>;    // any extra props passed from the parent slot
  onError?: (err: string) => void;
  onReset?: () => void;                // called when user clicks "Reset Plugin"
}

/**
 * Compiles and renders a user-authored plugin within a named slot.
 * Uses @babel/standalone (loaded from CDN) for real JSX transpilation.
 */
export const AssistantPlugin: React.FC<AssistantPluginProps> = ({
  slot,
  code,
  project,
  isDarkMode,
  apiKeys = {},
  extraProps = {},
  onError,
  onReset,
}) => {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  const [compileError, setCompileError] = useState<string | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const compile = useCallback(async () => {
    if (!code?.trim()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setCompileError(null);
    setRuntimeError(null);
    try {
      // Ensure Babel is loaded
      await loadBabel();
      const Babel = (window as any).Babel;
      if (!Babel) throw new Error('Babel failed to load');

      // Transpile the user's JSX/TS code to plain JS
      const result = Babel.transform(code, {
        presets: ['react'],
        filename: `${slot}-plugin.jsx`,
      });

      const transpiled = result?.code;
      if (!transpiled) throw new Error('Transpilation produced no output');

      // Build the scope for this plugin
      const scope = buildScope(project, { ...extraProps, apiKeys, isDarkMode });
      const scopeKeys = Object.keys(scope);
      const scopeValues = Object.values(scope);

      // Wrap the code: expect the user to export default or just return JSX
      // We wrap in a factory that gives them the scope as named variables
      const wrappedCode = `
        ${transpiled}
        // Support: if user wrote 'export default MyComp', grab it
        if (typeof exports !== 'undefined' && exports.__esModule && exports.default) {
          return exports.default;
        }
        // Support: user returned JSX directly (arrow fn returned)
        return null;
      `;

      // eslint-disable-next-line no-new-func
      const factory = new Function('exports', 'module', ...scopeKeys, wrappedCode);
      const exportsObj: any = {};
      const moduleObj = { exports: exportsObj };

      // Execute to capture the export
      factory(exportsObj, moduleObj, ...scopeValues);

      // Prefer module.exports.default, then module.exports itself if it's a fn
      let Comp = moduleObj.exports?.default || moduleObj.exports;
      if (typeof Comp !== 'function') Comp = null;

      setComponent(() => Comp);
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.error(`[AssistantPlugin:${slot}] compile error:`, msg);
      setCompileError(msg);
      onError?.(msg);
    } finally {
      setIsLoading(false);
    }
  }, [code, slot]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    compile();
  }, [compile]);

  // ─── Error UI ────────────────────────────────────────────────────────
  const errorStyle = isDarkMode
    ? 'bg-red-950/50 border-red-800 text-red-300'
    : 'bg-red-50 border-red-200 text-red-700';

  if (compileError || runtimeError) {
    return (
      <div className={`p-3 rounded-xl border text-xs ${errorStyle}`}>
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 font-medium">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Plugin Error
            <span className="opacity-60 font-normal">({slot})</span>
          </span>
          {onReset && (
            <button
              onClick={onReset}
              className="underline opacity-70 hover:opacity-100"
            >
              Reset Plugin
            </button>
          )}
        </div>
        <pre className="mt-1.5 whitespace-pre-wrap break-all opacity-80 font-mono text-[10px] max-h-20 overflow-auto">
          {compileError || runtimeError}
        </pre>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={`flex items-center gap-1.5 text-xs px-2 py-1 opacity-50 ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
        <div className="w-3.5 h-3.5 border border-current border-t-transparent rounded-full animate-spin" />
        Loading plugin…
      </div>
    );
  }

  if (!Component) return null;

  // ─── Runtime Error Boundary ──────────────────────────────────────────
  try {
    return (
      <RuntimeErrorBoundary
        slot={slot}
        isDarkMode={isDarkMode}
        onReset={onReset}
        onError={setRuntimeError}
      >
        <Component
          project={project}
          isDarkMode={isDarkMode}
          apiKeys={apiKeys}
          {...extraProps}
        />
      </RuntimeErrorBoundary>
    );
  } catch (err: any) {
    setRuntimeError(err?.message || 'Runtime error');
    return null;
  }
};

// ─── Simple Class-based Error Boundary ───────────────────────────────
interface RuntimeErrorBoundaryProps {
  slot: string;
  isDarkMode: boolean;
  onReset?: () => void;
  onError?: (err: string) => void;
  children: React.ReactNode;
}

interface RuntimeErrorBoundaryState {
  caught: string | null;
}

class RuntimeErrorBoundary extends React.Component<RuntimeErrorBoundaryProps, RuntimeErrorBoundaryState> {
  state: RuntimeErrorBoundaryState = { caught: null };

  static getDerivedStateFromError(error: any): RuntimeErrorBoundaryState {
    return { caught: error?.message || 'Plugin crashed' };
  }

  componentDidCatch(error: any) {
    this.props.onError?.(error?.message || String(error));
  }

  render() {
    if (this.state.caught) {
      const { isDarkMode, slot, onReset } = this.props;
      const cls = isDarkMode
        ? 'bg-red-950/50 border-red-800 text-red-300'
        : 'bg-red-50 border-red-200 text-red-700';
      return (
        <div className={`p-3 rounded-xl border text-xs ${cls}`}>
          <span className="flex items-center gap-1.5 font-medium">
            Plugin crashed ({slot})
          </span>
          {onReset && (
            <button onClick={onReset} className="mt-1 underline opacity-70">
              Reset Plugin
            </button>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
