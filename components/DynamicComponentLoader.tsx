import React, { useState, useEffect, Suspense } from 'react';

/**
 * MOCK Scope for dynamic components.
 * In a real implementation, this would contain all services and hooks
 * needed by the components.
 */
const SCOPE = {
  React,
  ...React, // Export hooks like useState, useEffect directly
  // Add other services here as needed
};

interface DynamicComponentLoaderProps {
  sourceCode: string;
  fallback: React.ReactNode;
  componentProps?: any;
}

/**
 * A prototype component that "compiles" and renders TSX on the fly.
 * NOTE: This is a simplified version for demonstration.
 * A production version would use @babel/standalone.
 */
export const DynamicComponentLoader: React.FC<DynamicComponentLoaderProps> = ({ 
  sourceCode, 
  fallback, 
  componentProps 
}) => {
  const [Component, setComponent] = useState<React.ComponentType<any> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const compile = async () => {
      try {
        // 1. In a real app, we'd load Babel:
        // const Babel = await import('@babel/standalone');
        // const compiled = Babel.transform(sourceCode, { presets: ['react', 'typescript'] }).code;
        
        // 2. FOR PROTOTYPE: We'll assume the code is a simple JS function returning JSX
        // and using the SCOPE variables.
        // This is a "dangerous" but illustrative way to show dynamic execution.
        
        // Simulating compilation delay
        await new Promise(r => setTimeout(r, 500));

        // Create a function from the source
        // Expecting sourceCode to be something like: 
        // "(props) => <div>Customized! {props.name}</div>"
        
        // eslint-disable-next-line no-new-func
        const factory = new Function('React', 'SCOPE', `return ${sourceCode}`);
        const DynamicComp = factory(React, SCOPE);
        
        setComponent(() => DynamicComp);
        setError(null);
      } catch (err: any) {
        console.error('Failed to compile dynamic component:', err);
        setError(err.message);
      }
    };

    if (sourceCode) {
      compile();
    }
  }, [sourceCode]);

  if (error) {
    return (
      <div className="p-4 border border-red-500 bg-red-50 text-red-700 rounded-lg">
        <h3 className="font-bold flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          Personalization Error
        </h3>
        <p className="text-sm mt-1">{error}</p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-2 text-xs underline"
        >
          Try Reloading
        </button>
      </div>
    );
  }

  if (!Component) return <>{fallback}</>;

  return (
    <Suspense fallback={fallback}>
      <Component {...componentProps} />
    </Suspense>
  );
};
