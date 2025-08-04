import React, { useState, useEffect, createContext, useContext } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';

// Mock Supabase client for demo mode
const mockSupabase = {
  auth: {
    getSession: () => Promise.resolve({ data: { session: null } }),
    onAuthStateChange: (callback: any) => {
      // Mock auth state change listener
      return { data: { subscription: { unsubscribe: () => {} } } };
    },
    signInWithPassword: (credentials: any) => {
      // Mock sign-in behavior - only allow demo credentials
      if (credentials.email === 'demo@pipnosis.com' && credentials.password === 'demo123') {
        return Promise.resolve({ 
          data: { user: { email: credentials.email } }, 
          error: null 
        });
      } else {
        return Promise.resolve({ 
          data: { user: null }, 
          error: { message: 'Invalid login credentials. Try demo@pipnosis.com / demo123' } 
        });
      }
    },
    signUp: (credentials: any) => {
      // Mock sign-up behavior - always succeeds but requires email confirmation
      return Promise.resolve({ 
        data: { user: null }, 
        error: { message: 'Demo Mode: Account created! In production, check your email for confirmation.' } 
      });
    },
    signOut: () => Promise.resolve({ error: null })
  }
};

// Use mock client for demo mode
const supabase = mockSupabase;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
    });
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  const value = {
    user,
    session,
    loading,
    signIn,
    signUp,
    signOut,
  };

  return React.createElement(
    AuthContext.Provider,
    { value },
    children
  );
};