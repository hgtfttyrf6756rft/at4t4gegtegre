import React, { useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification, GoogleAuthProvider, signInWithPopup, signInWithCredential } from 'firebase/auth';
import { auth } from '../services/firebase';

interface AuthScreenProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
  onOpenTerms?: () => void;
  onOpenPrivacy?: () => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ isDarkMode, toggleTheme, onOpenTerms, onOpenPrivacy }) => {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (isLogin) {
        await signInWithEmailAndPassword(auth, email, password);
      } else {
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        await sendEmailVerification(userCredential.user);
      }
    } catch (err: any) {
      console.error(err);
      let msg = "Authentication failed.";
      if (err.message.includes("auth/invalid-email")) msg = "Invalid email address.";
      if (err.message.includes("auth/user-not-found") || err.message.includes("auth/wrong-password")) msg = "Invalid email or password.";
      if (err.message.includes("auth/email-already-in-use")) msg = "Email already in use.";
      if (err.message.includes("auth/weak-password")) msg = "Password should be at least 6 characters.";
      if (err.message.includes("auth/invalid-credential")) msg = "Invalid credentials.";
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleAuth = async () => {
    setError('');
    setGoogleLoading(true);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (err: any) {
      console.error(err);
      let msg = 'Google authentication failed.';
      if (err?.code === 'auth/popup-closed-by-user') msg = 'Google sign-in popup was closed before completing.';
      if (err?.code === 'auth/cancelled-popup-request') msg = 'Another sign-in popup was already open.';
      setError(msg);
    } finally {
      setGoogleLoading(false);
    }
  };



  return (
    <div className={"min-h-screen flex items-center justify-center p-4 sm:p-6 relative overflow-hidden " + (isDarkMode ? 'bg-[#000000]' : 'bg-gray-50')}>
      {/* Premium Ambient Background */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Subtle gradient mesh */}
        {isDarkMode ? (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#1a1a2e]/80 via-[#000000] to-[#000000]"></div>
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-100 via-white to-white"></div>
        )}

        {/* Floating orbs - subtle and elegant */}
        <div className={"absolute top-[-30%] left-[-20%] w-[800px] h-[800px] rounded-full blur-[150px] animate-float-slow " + (isDarkMode ? 'bg-gradient-to-br from-[#0071e3]/8 via-[#5e5ce6]/5 to-transparent' : 'bg-gradient-to-br from-blue-300/40 via-indigo-200/40 to-transparent')}></div>
        <div className={"absolute bottom-[-40%] right-[-20%] w-[700px] h-[700px] rounded-full blur-[150px] animate-float-slow " + (isDarkMode ? 'bg-gradient-to-tl from-[#5e5ce6]/8 via-[#bf5af2]/4 to-transparent' : 'bg-gradient-to-tl from-purple-300/30 via-pink-200/30 to-transparent')} style={{ animationDelay: '-10s' }}></div>

        {/* Grid pattern - very subtle */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.015)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.015)_1px,transparent_1px)] bg-[size:80px_80px] [mask-image:radial-gradient(ellipse_at_center,black_10%,transparent_60%)]"></div>
      </div>

      {/* Auth Container */}
      <div className="w-full max-w-[400px] relative z-10">
        {/* Main Card */}
        <div className="relative">
          {/* Subtle glow on hover */}
          <div className="absolute -inset-px bg-gradient-to-b from-white/[0.08] to-transparent rounded-[28px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

          {/* Card Content */}
          <div className={"relative backdrop-blur-2xl border rounded-[28px] p-8 sm:p-10 shadow-2xl " + (isDarkMode ? 'bg-[#1c1c1e]/80 border-white/[0.06]' : 'bg-white/90 border-gray-200')}>
            {/* Logo & Header */}
            <div className="text-center mb-10">
              {/* Minimal Logo */}
              <div className="relative w-16 h-16 mx-auto mb-6 flex items-center justify-center">
                <img
                  src="https://inrveiaulksfmzsbyzqj.supabase.co/storage/v1/object/public/images/Untitled%20design.svg"
                  alt="Logo"
                  className="w-16 h-16 object-contain"
                  style={isDarkMode ? { filter: 'brightness(0) invert(1)' } : undefined}
                />
              </div>

              <h1 className={"text-[28px] font-semibold mb-2 tracking-tight " + (isDarkMode ? 'text-white' : 'text-gray-900')}>
                {isLogin ? 'Welcome back' : 'Get started'}
              </h1>
              <p className={"text-[15px] " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                {isLogin ? 'Sign in to continue your research' : 'Create your account to begin'}
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email Input */}
              <div className="space-y-2">
                <label className="block text-[13px] font-medium text-[#86868b] pl-1">
                  Email
                </label>
                <div className={`relative rounded-xl transition-all duration-300 ${focusedField === 'email'
                  ? 'ring-2 ring-[#0071e3]/50 ring-offset-2 ring-offset-[#1c1c1e]'
                  : ''
                  }`}>
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#636366]">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                    </svg>
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onFocus={() => setFocusedField('email')}
                    onBlur={() => setFocusedField(null)}
                    className={"w-full border rounded-xl pl-12 pr-4 py-3.5 text-[15px] transition-all duration-200 focus:outline-none focus:border-[#0071e3]/50 " + (isDarkMode ? 'bg-[#2c2c2e] border-[#3a3a3c] text-white placeholder-[#636366]' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400')}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                  />
                </div>
              </div>

              {/* Password Input */}
              <div className="space-y-2">
                <label className="block text-[13px] font-medium text-[#86868b] pl-1">
                  Password
                </label>
                <div className={`relative rounded-xl transition-all duration-300 ${focusedField === 'password'
                  ? 'ring-2 ring-[#0071e3]/50 ring-offset-2 ring-offset-[#1c1c1e]'
                  : ''
                  }`}>
                  <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[#636366]">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                    </svg>
                  </div>
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    className={"w-full border rounded-xl pl-12 pr-12 py-3.5 text-[15px] transition-all duration-200 focus:outline-none focus:border-[#0071e3]/50 " + (isDarkMode ? 'bg-[#2c2c2e] border-[#3a3a3c] text-white placeholder-[#636366]' : 'bg-white border-gray-300 text-gray-900 placeholder-gray-400')}
                    placeholder="Enter your password"
                    autoComplete={isLogin ? "current-password" : "new-password"}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[#636366] hover:text-[#86868b] transition-colors"
                  >
                    {showPassword ? (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="flex items-center gap-3 p-4 bg-[#ff453a]/10 border border-[#ff453a]/20 rounded-xl animate-shake">
                  <div className="flex-shrink-0 w-8 h-8 bg-[#ff453a]/20 rounded-lg flex items-center justify-center">
                    <svg className="w-4 h-4 text-[#ff453a]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
                    </svg>
                  </div>
                  <p className="text-[#ff453a] text-[14px] font-medium">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full relative overflow-hidden group mt-2"
              >
                <div className="relative bg-[#0071e3] hover:bg-[#0077ed] rounded-xl py-4 font-medium text-white text-[15px] transition-all duration-200 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      {isLogin ? 'Sign In' : 'Create Account'}
                      <svg className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                      </svg>
                    </>
                  )}
                </div>
              </button>
            </form>

            {/* Divider */}
            <div className="flex items-center gap-4 my-8">
              <div className={"flex-1 h-px " + (isDarkMode ? 'bg-[#3a3a3c]' : 'bg-gray-200')}></div>
              <span className={"text-[13px] " + (isDarkMode ? 'text-[#636366]' : 'text-gray-400')}>or</span>
              <div className={"flex-1 h-px " + (isDarkMode ? 'bg-[#3a3a3c]' : 'bg-gray-200')}></div>
            </div>

            <button
              type="button"
              onClick={handleGoogleAuth}
              disabled={googleLoading}
              className={`w-full border rounded-xl py-3.5 flex items-center justify-center gap-3 text-[15px] font-medium transition-all ${isDarkMode
                ? 'border-white/10 bg-white/5 text-white hover:bg-white/10'
                : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50'
                } disabled:opacity-60 disabled:cursor-not-allowed`}
            >
              <img
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                alt="Google"
                className="w-5 h-5"
              />
              <span>{googleLoading ? 'Connecting to Google...' : `${isLogin ? 'Sign in' : 'Sign up'} with Google`}</span>
            </button>



            {/* Toggle Sign In/Sign Up */}
            <div className="text-center">
              <p className={"text-[14px] " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                {isLogin ? "Don't have an account?" : "Already have an account?"}
              </p>
              <button
                onClick={() => { setIsLogin(!isLogin); setError(''); }}
                className="mt-2 text-[14px] font-medium text-[#0071e3] hover:text-[#0077ed] transition-colors"
              >
                {isLogin ? 'Create a free account' : 'Sign in instead'}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-[12px] tracking-wide">
          <div className="flex items-center justify-center sm:justify-start gap-3">
            <p className={isDarkMode ? 'text-[#48484a]' : 'text-gray-500'}>FreshFront</p>
            {(onOpenPrivacy || onOpenTerms) && (
              <div className={"flex items-center gap-3 " + (isDarkMode ? 'text-[#86868b]' : 'text-gray-500')}>
                {onOpenPrivacy && (
                  <a
                    href="/privacy"
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenPrivacy();
                    }}
                    className={"transition-colors " + (isDarkMode ? 'hover:text-white' : 'hover:text-gray-900')}
                  >
                    Privacy
                  </a>
                )}
                {onOpenTerms && (
                  <a
                    href="/terms"
                    onClick={(e) => {
                      e.preventDefault();
                      onOpenTerms();
                    }}
                    className={"transition-colors " + (isDarkMode ? 'hover:text-white' : 'hover:text-gray-900')}
                  >
                    Terms
                  </a>
                )}
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={toggleTheme}
            className={"inline-flex items-center justify-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors " + (isDarkMode ? 'border-white/10 text-[#86868b] hover:bg-white/5' : 'border-gray-300 text-gray-600 hover:bg-gray-100')}
          >
            {isDarkMode ? 'Light mode' : 'Dark mode'}
            {isDarkMode ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25M18.364 5.636l-1.591 1.591M21 12h-2.25M18.364 18.364l-1.591-1.591M12 18.75V21M7.227 16.773l-1.591 1.591M5.25 12H3M7.227 7.227L5.636 5.636M12 8.25A3.75 3.75 0 1015.75 12 3.75 3.75 0 0012 8.25z" />
              </svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0118 15.75 9.75 9.75 0 018.25 6a9.72 9.72 0 01.748-3.752A9.753 9.753 0 003 11.25C3 16.634 7.366 21 12.75 21a9.753 9.753 0 009.002-5.998z" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Custom Animations */}
      <style>{`
        @keyframes float-slow {
          0%, 100% { transform: translate(0, 0) scale(1); }
          50% { transform: translate(30px, -40px) scale(1.02); }
        }
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        .animate-float-slow {
          animation: float-slow 25s ease-in-out infinite;
        }
        .animate-shake {
          animation: shake 0.3s ease-in-out;
        }
      `}</style>
    </div>
  );
};
