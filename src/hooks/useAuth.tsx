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
    console.log('🔐 [useAuth] Initializing auth...');

    const fetchUserRole = async (userId: string) => {
      console.log('👤 [useAuth] Fetching user role for:', userId);
      setAdminLoading(true);
      try {
        const { data, error } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', userId)
          .maybeSingle();

        if (!error && data) {
          console.log('✅ [useAuth] User role:', data.role);
          setIsAdmin(data.role === 'admin');
        } else {
          console.log('ℹ️ [useAuth] No admin role found, treating as regular user');
          setIsAdmin(false);
        }
      } catch (error) {
        console.error('❌ [useAuth] Error fetching user role:', error);
        setIsAdmin(false);
      } finally {
        setAdminLoading(false);
      }
    };

    console.log('🔍 [useAuth] Getting session...');
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        console.log('📋 [useAuth] Session retrieved:', session ? 'Logged in' : 'Not logged in');
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchUserRole(session.user.id).finally(() => {
            console.log('✅ [useAuth] Auth initialization complete (with user)');
            setLoading(false);
          });
        } else {
          console.log('✅ [useAuth] Auth initialization complete (no user)');
          setLoading(false);
        }
      })
      .catch((error) => {
        console.error('❌ [useAuth] Failed to get session:', error);
        // Continue anyway - don't block the app
        setLoading(false);
      });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        const previousUser = user;

        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          if (previousUser?.id !== session.user.id) {
            const { activeEntryMonitor } = await import('@/services/active-entry-monitor');
            activeEntryMonitor.stopAllMonitoring();
            console.log('[Auth] Stopped monitoring for previous user');
          }

          await fetchUserRole(session.user.id);

          if (!liveTradeLearningTrigger.isActive()) {
            console.log('[Auth] Starting live trade learning trigger for user:', session.user.id);
            liveTradeLearningTrigger.start(session.user.id);
          }

          if (!continuousLearningLoop.isActive()) {
            console.log('[Auth] Starting continuous learning loop for user:', session.user.id);
            continuousLearningLoop.start(session.user.id);
          }

          try {
            const { activeEntryMonitor } = await import('@/services/active-entry-monitor');
            await activeEntryMonitor.resumeAllActiveIntents(session.user.id);
            console.log('[Auth] ✅ Resumed entry intent monitoring');
          } catch (error) {
            console.error('[Auth] Failed to resume entry monitoring:', error);
          }
        } else {
          setIsAdmin(false);

          if (liveTradeLearningTrigger.isActive()) {
            console.log('[Auth] Stopping live trade learning trigger');
            liveTradeLearningTrigger.stop();
          }

          if (continuousLearningLoop.isActive()) {
            console.log('[Auth] Stopping continuous learning loop');
            continuousLearningLoop.stop();
          }

          import('@/services/active-entry-monitor').then(({ activeEntryMonitor }) => {
            activeEntryMonitor.stopAllMonitoring();
            console.log('[Auth] Stopped all entry monitoring');
          }).catch(console.error);
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
