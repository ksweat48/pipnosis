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
          .from('user_profiles')
          .select('is_admin')
          .eq('id', userId)
          .single();

        if (!error && data) {
          console.log('✅ [useAuth] User admin status:', data.is_admin);
          setIsAdmin(data.is_admin === true);
        } else {
          console.log('ℹ️ [useAuth] No user profile found or not admin, treating as regular user');
          setIsAdmin(false);
        }
      } catch (error) {
        console.error('❌ [useAuth] Error fetching user role:', error);
        setIsAdmin(false);
      } finally {
        setAdminLoading(false);
      }
    };

    const validateAccountIntegrity = async (userId: string): Promise<boolean> => {
      // SSOT: Account Integrity Validation
      // GOVERNANCE: Prevent broken accounts from accessing the system
      try {
        console.log('🔍 [useAuth] Validating account integrity for:', userId);

        const { data, error } = await supabase
          .rpc('check_account_integrity', { check_user_id: userId });

        if (error) {
          console.error('❌ [useAuth] Failed to check account integrity:', error);
          return false;
        }

        if (!data || !data.valid) {
          console.error('❌ [useAuth] Account integrity check failed:', data);
          console.error('Issues:', data?.issues);

          // Force logout if account is broken
          await supabase.auth.signOut();

          // Show error to user
          alert('Account setup is incomplete. Please contact support or try signing up again.');

          return false;
        }

        console.log('✅ [useAuth] Account integrity validated');
        return true;
      } catch (error) {
        console.error('❌ [useAuth] Error validating account integrity:', error);
        return false;
      }
    };

    console.log('🔍 [useAuth] Getting session...');
    supabase.auth.getSession()
      .then(async ({ data: { session } }) => {
        console.log('📋 [useAuth] Session retrieved:', session ? 'Logged in' : 'Not logged in');

        if (session?.user) {
          // CRITICAL: Validate account integrity before allowing access
          const isValid = await validateAccountIntegrity(session.user.id);

          if (!isValid) {
            // Account is broken - don't set session/user
            console.error('🚫 [useAuth] Account integrity validation failed - blocking access');
            setSession(null);
            setUser(null);
            setLoading(false);
            return;
          }

          // Account is valid - proceed normally
          setSession(session);
          setUser(session.user);

          fetchUserRole(session.user.id).finally(() => {
            console.log('✅ [useAuth] Auth initialization complete (with user)');
            setLoading(false);
          });
        } else {
          setSession(null);
          setUser(null);
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

        if (session?.user) {
          // CRITICAL: Validate account integrity on auth state change
          const isValid = await validateAccountIntegrity(session.user.id);

          if (!isValid) {
            // Account is broken - block access
            console.error('🚫 [useAuth] Account integrity validation failed on state change');
            setSession(null);
            setUser(null);
            setIsAdmin(false);
            setLoading(false);
            return;
          }

          // Account is valid - proceed
          setSession(session);
          setUser(session.user);

          if (previousUser?.id !== session.user.id) {
            const { unifiedEntryMonitor } = await import('@/services/unified-entry-monitor');
            unifiedEntryMonitor.stopAllMonitoring();
            console.log('[Auth] Stopped monitoring for previous user');
          }

          // Initialize user risk preference (SSOT) if not already set
          try {
            const { userRiskPreferenceService } = await import('@/services/user-risk-preference-service');
            await userRiskPreferenceService.initializeNewUser(session.user.id);
          } catch (error) {
            console.warn('[Auth] Could not initialize risk preference:', error);
            // Don't fail auth if this fails - service will use default
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
            // STEP 1: Clean up stale intents before resuming
            const { entryIntentCleanupService } = await import('@/services/entry-intent-cleanup');
            const cleanupResult = await entryIntentCleanupService.performFullCleanup(session.user.id);

            if (cleanupResult.totalCleaned > 0) {
              console.log('[Auth] 🧹 Cleaned up stale intents:', cleanupResult);
            }

            // STEP 2: Resume only valid, active intents
            const { unifiedEntryMonitor } = await import('@/services/unified-entry-monitor');
            await unifiedEntryMonitor.resumeAllActiveIntents(session.user.id);
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

          import('@/services/unified-entry-monitor').then(({ unifiedEntryMonitor }) => {
            unifiedEntryMonitor.stopAllMonitoring();
            console.log('[Auth] Stopped all entry monitoring');
          }).catch(console.error);

          // No session - clear everything
          setSession(null);
          setUser(null);
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
