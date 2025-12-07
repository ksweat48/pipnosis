import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase';
import { ArrowLeft } from 'lucide-react';

export function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);

      if (error) {
        setMessage('Error: ' + error.message);
      } else {
        setMessage('Password reset email sent! Check your inbox.');
      }
    } catch (err) {
      setMessage('An error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-viewport relative flex items-center justify-center p-4 overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat animate-subtle-zoom"
        style={{
          backgroundImage: 'url(/2_pipnosis_background_hawk_and_candle_image.png)',
          backgroundAttachment: 'fixed'
        }}
      />
      <div className="absolute inset-0 bg-black/60" />

      <div className="glass-card p-8 max-w-md w-full relative z-10">
        <div className="mb-4">
          <Link
            to="/auth"
            className="inline-flex items-center text-gray-400 hover:text-emerald-500 text-sm transition-colors"
          >
            <ArrowLeft size={16} className="mr-1" />
            Back to Sign In
          </Link>
        </div>

        <h1 className="text-3xl font-bold text-white mb-6 text-center">Reset Password</h1>

        {message && (
          <div className="bg-blue-500/10 border border-blue-500 text-blue-500 p-3 rounded mb-4">
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-gray-400 text-sm mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-white/20 text-white p-3 rounded focus:outline-none focus:ring-2 focus:ring-emerald-500 placeholder-gray-300"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 text-white py-3 rounded hover:bg-emerald-700 disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>
        </form>
      </div>
    </div>
  );
}
