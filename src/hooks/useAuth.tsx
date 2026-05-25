import React, { createContext, useContext, useEffect, useState, useRef, useCallback } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

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
  const mountedRef = useRef(true);
  const validatingRef = useRef(false);

  const fetchUserRole = useCallback(async (userId: string) => {
    setAdminLoading(true);
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('is_admin')
        .eq('id', userId)
        .maybeSingle();

      if (!mountedRef.current) return;
      if (!error && data) {
        setIsAdmin(data.is_admin === true);
      } else {
        setIsAdmin(false);
      }
    } catch {
      if (mountedRef.current) setIsAdmin(false);
    } finally {
      if (mountedRef.current) setAdminLoading(false);
    }
  }, []);

  const validateAccountIntegrity = useCallback(async (userId: string): Promise<boolean> => {
    try {
      const { data, error } = await supabase
        .rpc('check_account_integrity', { check_user_id: userId });

      if (error) {
        console.error('[Auth] Account integrity check error:', error);
        return false;
      }

      if (!data || !data.valid) {
        console.error('[Auth] Account integrity failed:', data?.issues);
        await supabase.auth.signOut();
        alert('Account setup is incomplete. Please contact support or try signing up again.');
        return false;
      }

      return true;
    } catch (err) {
      console.error('[Auth] Account integrity exception:', err);
      return false;
    }
  }, []);

  // SSOT: Single auth state management
  // getSession() handles initial hydration from persisted session (no heavy validation)
  // onAuthStateChange handles sign-in/sign-out/refresh events
  // This eliminates the race condition where both paths validated simultaneously
  useEffect(() => {
    mountedRef.current = true;

    // Add timeout wrapper to prevent hanging on failed auth
    const getSessionWithTimeout = (timeoutMs = 15000) => {
      return Promise.race([
        supabase.auth.getSession(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Auth timeout')), timeoutMs)
        )
      ]) as Promise<{ data: { session: Session | null } }>;
    };

    getSessionWithTimeout().then(async ({ data: { session: currentSession } }) => {
      if (!mountedRef.current) return;

      if (currentSession?.user) {
        setSession(currentSession);
        setUser(currentSession.user);
        await fetchUserRole(currentSession.user.id);
      } else {
        setSession(null);
        setUser(null);
      }

      if (mountedRef.current) setLoading(false);
    }).catch((error) => {
      console.error('[Auth] Session initialization failed:', error);
      if (mountedRef.current) {
        setSession(null);
        setUser(null);
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'INITIAL_SESSION') return;

      if ((event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') && newSession?.user) {
        setSession(newSession);
        setUser(newSession.user);
        return;
      }

      if (event === 'SIGNED_OUT' || !newSession?.user) {
        setSession(null);
        setUser(null);
        setIsAdmin(false);
        setLoading(false);
        return;
      }

      (async () => {
        if (validatingRef.current) return;
        validatingRef.current = true;

        try {
          const isValid = await validateAccountIntegrity(newSession.user.id);
          if (!isValid || !mountedRef.current) {
            setSession(null);
            setUser(null);
            setLoading(false);
            return;
          }

          setSession(newSession);
          setUser(newSession.user);
          await fetchUserRole(newSession.user.id);
        } finally {
          validatingRef.current = false;
          if (mountedRef.current) setLoading(false);
        }
      })();
    });

    return () => {
      mountedRef.current = false;
      subscription.unsubscribe();
    };
  }, [fetchUserRole, validateAccountIntegrity]);

  // SSOT: Service initialization - decoupled from auth settlement
  // Runs after user state settles, does not block auth or navigation
  useEffect(() => {
    if (!user?.id) return;

    const userId = user.id;
    let cancelled = false;

    const initServices = async () => {
      await new Promise(r => setTimeout(r, 100));
      if (cancelled) return;

      try {
        const { userRiskPreferenceService } = await import('@/services/user-risk-preference-service');
        await userRiskPreferenceService.initializeNewUser(userId);
      } catch { /* non-blocking */ }

      if (cancelled) return;

      try {
        const { liveTradeLearningTrigger } = await import('@/services/live-trade-learning-trigger');
        if (!liveTradeLearningTrigger.isActive()) liveTradeLearningTrigger.start(userId);
      } catch { /* non-blocking */ }

      if (cancelled) return;

      try {
        const { continuousLearningLoop } = await import('@/services/continuous-learning-loop');
        if (!continuousLearningLoop.isActive()) continuousLearningLoop.start(userId);
      } catch { /* non-blocking */ }

      if (cancelled) return;

      // CCIP-2026-0505B: Intent cleanup runs in background to avoid blocking
      // TradePage boot. The RPC can take 15-20s during cold start when the
      // sequential cleanup functions contend with other boot workload. Resuming
      // active intents does NOT depend on cleanup completing first.
      queueMicrotask(() => {
        if (cancelled) return;
        (async () => {
          try {
            const { entryIntentCleanupService } = await import('@/services/entry-intent-cleanup');
            const cleanupResult = await entryIntentCleanupService.performFullCleanup(userId);
            if (cleanupResult.totalCleaned > 0) {
              console.log('[Auth] Cleaned up stale intents:', cleanupResult);
            }
          } catch { /* non-blocking */ }
        })();
      });

      try {
        const { unifiedEntryMonitor } = await import('@/services/unified-entry-monitor');
        await unifiedEntryMonitor.resumeAllActiveIntents(userId);
      } catch { /* non-blocking */ }
    };

    initServices();

    return () => {
      cancelled = true;
      import('@/services/live-trade-learning-trigger').then(({ liveTradeLearningTrigger }) => {
        if (liveTradeLearningTrigger.isActive()) liveTradeLearningTrigger.stop();
      }).catch(() => {});
      import('@/services/continuous-learning-loop').then(({ continuousLearningLoop }) => {
        if (continuousLearningLoop.isActive()) continuousLearningLoop.stop();
      }).catch(() => {});
      import('@/services/unified-entry-monitor').then(({ unifiedEntryMonitor }) => {
        unifiedEntryMonitor.stopAllMonitoring();
      }).catch(() => {});
    };
  }, [user?.id]);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signUp = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: undefined }
    });

    if (!error && data.user) {
      const pendingRefCode = localStorage.getItem('pending_referral_code');
      if (pendingRefCode) {
        try {
          const { data: refResult, error: refError } = await supabase.rpc('process_signup_referral', {
            p_referee_user_id: data.user.id,
            p_referral_code: pendingRefCode
          });

          if (refError) {
            console.error('[Auth] Failed to process referral:', refError);
          } else if (refResult?.success) {
            localStorage.removeItem('pending_referral_code');
          } else {
            localStorage.removeItem('pending_referral_code');
          }
        } catch (err) {
          console.error('[Auth] Exception processing referral:', err);
          localStorage.removeItem('pending_referral_code');
        }
      }
    }

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

    const { error } = await supabase.auth.updateUser({ password: newPassword });
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
