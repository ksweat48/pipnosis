import React, { useState, useEffect, createContext, useContext } from 'react';
import { User, Session, AuthError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  isAdmin: boolean;
  signIn: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  resetPassword: (email: string) => Promise<{ error: AuthError | null }>;
  updatePassword: (newPassword: string) => Promise<{ error: AuthError | null }>;
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
  const [isAdmin, setIsAdmin] = useState(false);

  const adminStatusCache = React.useRef<{ [userId: string]: { value: boolean; timestamp: number } }>({});
  const CACHE_DURATION = 5 * 60 * 1000;

  const checkAdminStatus = async (userId: string, retryCount = 0): Promise<boolean> => {
    const cached = adminStatusCache.current[userId];
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.value;
    }

    try {
      const timeoutPromise = new Promise<{ data: any; error: any }>((resolve) => {
        setTimeout(() => {
          resolve({ data: null, error: { message: 'Timeout', code: 'TIMEOUT' } });
        }, 3000);
      });

      const queryPromise = supabase
        .from('user_profiles')
        .select('is_admin')
        .eq('id', userId)
        .maybeSingle();

      const { data, error } = await Promise.race([queryPromise, timeoutPromise]);

      if (error) {
        console.warn('Error checking admin status (non-blocking):', error.message);

        if (error.code === 'TIMEOUT') {
          console.warn('Admin status check timed out. Defaulting to non-admin.');
          adminStatusCache.current[userId] = { value: false, timestamp: Date.now() };
          return false;
        }

        if (error.message.includes('500') || error.message.includes('Internal Server Error')) {
          console.warn('Database 500 error when checking admin status. Defaulting to non-admin.');
          adminStatusCache.current[userId] = { value: false, timestamp: Date.now() };
          return false;
        }

        if (retryCount < 1 && (error.message.includes('tected in policy') || error.message.includes('recursion'))) {
          console.log(`Retrying admin status check (attempt ${retryCount + 1}/1)...`);
          await new Promise(resolve => setTimeout(resolve, 500));
          return checkAdminStatus(userId, retryCount + 1);
        }

        adminStatusCache.current[userId] = { value: false, timestamp: Date.now() };
        return false;
      }

      const adminStatus = data?.is_admin || false;
      console.log('[useAuth] Admin status check result for', userId, ':', adminStatus);
      adminStatusCache.current[userId] = { value: adminStatus, timestamp: Date.now() };
      return adminStatus;
    } catch (error) {
      console.warn('Exception checking admin status (non-blocking):', error);
      adminStatusCache.current[userId] = { value: false, timestamp: Date.now() };
      return false;
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const sessionTimeout = setTimeout(() => {
          console.warn('Session retrieval timed out, continuing without auth');
          setSession(null);
          setUser(null);
          setIsAdmin(false);
          setLoading(false);
        }, 5000);

        const { data: { session }, error } = await supabase.auth.getSession();
        clearTimeout(sessionTimeout);

        if (error) {
          console.warn('Error getting session (non-blocking):', error.message);
          if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError') || error.message.includes('500')) {
            console.warn('Network/server error during auth initialization. App will continue without authentication.');
          }
        }
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          try {
            console.log('[useAuth] Checking admin status for user:', session.user.email);
            const adminStatus = await checkAdminStatus(session.user.id);
            console.log('[useAuth] Setting isAdmin state to:', adminStatus);
            setIsAdmin(adminStatus);

            if (adminStatus) {
              console.log('[useAuth] ✅ Admin status verified for user:', session.user.email);
            } else {
              console.log('[useAuth] ⚠️ User is NOT admin:', session.user.email);
            }
          } catch (adminError) {
            console.warn('[useAuth] Failed to verify admin status (non-blocking):', adminError);
            setIsAdmin(false);
          }
        } else {
          setIsAdmin(false);
        }
      } catch (error) {
        console.warn('Error initializing auth (non-blocking):', error);
        setSession(null);
        setUser(null);
        setIsAdmin(false);
      } finally {
        setLoading(false);
      }
    };

    initAuth();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      (async () => {
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          const adminStatus = await checkAdminStatus(session.user.id);
          setIsAdmin(adminStatus);
        } else {
          setIsAdmin(false);
        }

        setLoading(false);
      })();
    });

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error };
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: fullName || '',
        }
      }
    });
    return { error };
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    return { error };
  };

  const resetPassword = async (email: string) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return { error };
  };

  const updatePassword = async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    return { error };
  };

  const value = {
    user,
    session,
    loading,
    isAdmin,
    signIn,
    signUp,
    signOut,
    resetPassword,
    updatePassword,
  };

  return React.createElement(
    AuthContext.Provider,
    { value },
    children
  );
};