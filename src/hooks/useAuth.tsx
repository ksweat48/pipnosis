import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { liveTradeLearningTrigger } from '@/services/live-trade-learning-trigger';
import { continuousLearningLoop } from '@/services/continuous-learning-loop';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  adminLoading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signUp: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  updatePassword: (currentPassword: string, newPassword: string) => Promise<{ error: any }>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminLoading, setAdminLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const fetchUserRole = async (userId: string) => {
      setAdminLoading(true);
      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .maybeSingle();

        if (!error && data) {
          setIsAdmin(data.role === 'admin');
        } else {
          setIsAdmin(false);
        }
      } catch (error) {
        console.error('Error fetching user role:', error);
        setIsAdmin(false);
      } finally {
        setAdminLoading(false);
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchUserRole(session.user.id).finally(() => {
          setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          await fetchUserRole(session.user.id);

          // Start live trade learning trigger for authenticated users
          if (!liveTradeLearningTrigger.isActive()) {
            console.log('[Auth] Starting live trade learning trigger for user:', session.user.id);
            liveTradeLearningTrigger.start(session.user.id);
          }

          // Start continuous learning loop for authenticated users
          if (!continuousLearningLoop.isActive()) {
            console.log('[Auth] Starting continuous learning loop for user:', session.user.id);
            continuousLearningLoop.start(session.user.id);
          }
        } else {
          setIsAdmin(false);

          // Stop live trade learning trigger when user logs out
          if (liveTradeLearningTrigger.isActive()) {
            console.log('[Auth] Stopping live trade learning trigger');
            liveTradeLearningTrigger.stop();
          }

          // Stop continuous learning loop when user logs out
          if (continuousLearningLoop.isActive()) {
            console.log('[Auth] Stopping continuous learning loop');
            continuousLearningLoop.stop();
          }
        }
        setLoading(false);
      })();
    });

    return () => {
      subscription.unsubscribe();
      // Clean up learning trigger on component unmount
      if (liveTradeLearningTrigger.isActive()) {
        liveTradeLearningTrigger.stop();
      }
      // Clean up continuous learning loop on component unmount
      if (continuousLearningLoop.isActive()) {
        continuousLearningLoop.stop();
      }
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const updatePassword = async (currentPassword: string, newPassword: string) => {
    if (!user?.email) {
      return { error: { message: 'No user logged in' } };
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (signInError) {
      return { error: { message: 'Current password is incorrect' } };
    }

    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });

    return { error };
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, adminLoading, isAdmin, signIn, signUp, signOut, updatePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
