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
      const { data, error } = await supabase
        .from('user_profiles')
        .select('is_admin')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        console.error('Error checking admin status:', error);

        if (error.message.includes('500') || error.message.includes('Internal Server Error')) {
          console.warn('Database error when checking admin status. Defaulting to non-admin.');
          return false;
        }

        if (retryCount < 2 && (error.message.includes('tected in policy') || error.message.includes('recursion'))) {
          console.log(`Retrying admin status check (attempt ${retryCount + 1}/2)...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
          return checkAdminStatus(userId, retryCount + 1);
        }

        return false;
      }

      const adminStatus = data?.is_admin || false;
      adminStatusCache.current[userId] = { value: adminStatus, timestamp: Date.now() };
      return adminStatus;
    } catch (error) {
      console.error('Exception checking admin status:', error);

      if (retryCount < 2) {
        console.log(`Retrying admin status check after exception (attempt ${retryCount + 1}/2)...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return checkAdminStatus(userId, retryCount + 1);
      }

      return false;
    }
  };

  useEffect(() => {
    const initAuth = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        if (error) {
          console.error('Error getting session:', error);
          if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            console.warn('Network error during auth initialization. App will continue without authentication.');
          }
        }
        setSession(session);
        setUser(session?.user ?? null);

        if (session?.user) {
          try {
            const adminStatus = await checkAdminStatus(session.user.id);
            setIsAdmin(adminStatus);

            if (adminStatus) {
              console.log('Admin status verified for user:', session.user.email);
            }
          } catch (adminError) {
            console.error('Failed to verify admin status after retries:', adminError);
            setIsAdmin(false);
          }
        } else {
          setIsAdmin(false);
        }
      } catch (error) {
        console.error('Error initializing auth:', error);
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