
import React, { useState } from 'react';
import { User, sendEmailVerification, signOut } from 'firebase/auth';
import { auth } from '../services/firebase';

interface VerifyEmailScreenProps {
    user: User;
    onVerified: () => void;
    isDarkMode: boolean;
}

export const VerifyEmailScreen: React.FC<VerifyEmailScreenProps> = ({ user, onVerified, isDarkMode }) => {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleResend = async () => {
    setLoading(true);
    setMessage('');
    try {
      await sendEmailVerification(user);
      setMessage('Verification link sent! Check your inbox (and spam).');
    } catch (e: any) {
      console.error(e);
      if (e.message?.includes('too-many-requests')) {
        setMessage('Please wait a moment before trying again.');
      } else {
        setMessage('Error sending email. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const checkVerification = async () => {
      setLoading(true);
      try {
          // Reload the user object from Firebase to get latest emailVerified status
          await user.reload();
          
          if (user.emailVerified) {
              // Notify parent instead of reloading page
              onVerified();
          } else {
              setMessage('Not verified yet. Please click the link in your email.');
          }
      } catch (e) {
          console.error(e);
          setMessage('Error checking verification. Please try again.');
      } finally {
          setLoading(false);
      }
  };

  return (
    <div className={"min-h-screen flex items-center justify-center p-4 relative overflow-hidden " + (isDarkMode ? 'bg-gray-950' : 'bg-gray-50')}>
        {/* Background Effects matching AuthScreen */}
        <div className={"absolute top-1/4 left-1/4 w-96 h-96 rounded-full blur-3xl mix-blend-screen animate-pulse-slow " + (isDarkMode ? 'bg-blue-600/20' : 'bg-blue-300/40')}></div>
        <div className={"absolute bottom-1/4 right-1/4 w-96 h-96 rounded-full blur-3xl mix-blend-screen animate-pulse-slow " + (isDarkMode ? 'bg-purple-600/20' : 'bg-purple-300/30')} style={{animationDelay: '1s'}}></div>
        <div className={"absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] z-0 " + (isDarkMode ? 'from-gray-900 via-gray-950 to-gray-950' : 'from-blue-100 via-white to-white')}></div>

        <div className={"max-w-md w-full backdrop-blur-xl rounded-2xl p-8 shadow-2xl relative z-10 animate-fade-in text-center border " + (isDarkMode ? 'bg-gray-900/60 border-white/10' : 'bg-white border-gray-200')}>
            <div className="w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl mx-auto mb-6 flex items-center justify-center shadow-lg shadow-emerald-500/30">
                 <span className="text-3xl">✉️</span>
            </div>
            
            <h1 className={"text-2xl font-bold mb-2 " + (isDarkMode ? 'text-white' : 'text-gray-900')}>Verify your email</h1>
            <p className={"text-sm mb-6 leading-relaxed " + (isDarkMode ? 'text-gray-400' : 'text-gray-600')}>
                We've sent a verification link to <span className={isDarkMode ? 'text-white font-medium' : 'text-gray-900 font-medium'}>{user.email}</span>.<br/>
                Please verify your email to access the studio.
            </p>

            {message && (
                <div className={`p-3 rounded-lg text-xs font-medium mb-6 animate-fade-in ${message.includes('Error') || message.includes('Not verified') ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>
                    {message}
                </div>
            )}

            <div className="space-y-3">
                <button
                    onClick={checkVerification}
                    disabled={loading}
                    className="w-full bg-white text-black hover:bg-gray-200 font-bold py-3 rounded-xl shadow-lg transition-all"
                >
                    {loading ? 'Checking...' : 'I have verified'}
                </button>

                <button
                    onClick={handleResend}
                    disabled={loading}
                    className={"w-full font-bold py-3 rounded-xl shadow-lg transition-all border " + (isDarkMode ? 'bg-gray-800 hover:bg-gray-700 text-white border-white/5' : 'bg-gray-100 hover:bg-gray-200 text-gray-900 border-gray-200')}
                >
                    Resend Email
                </button>
                
                <button 
                    onClick={() => signOut(auth)}
                    className={"text-xs uppercase tracking-widest font-bold mt-4 transition-colors " + (isDarkMode ? 'text-gray-500 hover:text-white' : 'text-gray-500 hover:text-gray-800')}
                >
                    Sign Out
                </button>
            </div>
        </div>
    </div>
  );
};
