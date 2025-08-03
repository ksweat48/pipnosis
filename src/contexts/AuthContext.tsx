import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { auth, profiles } from '../lib/supabase';

interface UserProfile {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  plan_type: 'free' | 'beta' | 'premium';
  account_balance: number;
  risk_profile: 'low' | 'medium' | 'high' | 'auto';
  trading_preferences: any;
  created_at: string;
  updated_at: string;
}

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: any }>;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<{ error: any }>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<{ error: any }>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Get initial session
    const getInitialSession = async () => {
      try {
        const { user: currentUser } = await auth.getCurrentUser();
        setUser(currentUser);
        
        if (currentUser) {
          await loadUserProfile(currentUser.id);
        }
      } catch (error) {
        console.error('Error getting initial session:', error);
      } finally {
        setLoading(false);
      }
    };

    getInitialSession();

    // Listen for auth changes
    const { data: { subscription } } = auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event, session?.user?.email);
      
      setSession(session);
      setUser(session?.user ?? null);
      
      if (session?.user) {
        await loadUserProfile(session.user.id);
      } else {
        setProfile(null);
      }
      
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const loadUserProfile = async (userId: string) => {
    try {
      const { data: profileData, error } = await profiles.get(userId);
      
      if (error && error.code === 'PGRST116') {
        // Profile doesn't exist, create default profile
        console.log('Creating default profile for user:', userId);
        await createDefaultProfile(userId);
      } else if (error) {
        console.error('Error loading profile:', error);
      } else {
        setProfile(profileData);
      }
    } catch (error) {
      console.error('Error in loadUserProfile:', error);
    }
  };

  const createDefaultProfile = async (userId: string) => {
    try {
      const defaultProfile = {
        email: user?.email || '',
        full_name: '',
        plan_type: 'free' as const,
        account_balance: 10000.00, // Demo balance
        risk_profile: 'auto' as const,
        trading_preferences: {
          default_pairs: ['EURUSD', 'GBPUSD', 'USDJPY'],
          max_trades_per_session: 2,
          preferred_timeframe: 'H1'
        }
      };

      // Check if profile already exists first
      const { data: existingProfile, error: checkError } = await profiles.get(userId);
      
      if (existingProfile) {
        console.log('Profile already exists, using existing profile');
        setProfile(existingProfile);
        return;
      }
      
      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Error checking existing profile:', checkError);
        return;
      }
      
      // Create new profile only if it doesn't exist
      const { data, error } = await profiles.create(userId, defaultProfile);
      
      if (error) {
        if (error.code === '23505') {
          // Profile already exists, try to fetch it
          console.log('Profile exists, fetching existing profile');
          await loadUserProfile(userId);
        } else {
          console.error('Error creating default profile:', error);
        }
      } else {
        setProfile(data);
        console.log('Default profile created successfully');
      }
    } catch (error) {
      console.error('Error in createDefaultProfile:', error);
    }
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    try {
      setLoading(true);
      const { data, error } = await auth.signUp(email, password);
      
      if (error) {
        return { error };
      }

      // If signup successful and user is confirmed, load or create profile
      if (data.user && !error) {
        await loadUserProfile(data.user.id);
      }

      return { error: null };
    } catch (error) {
      console.error('Signup error:', error);
      return { error };
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      setLoading(true);
      const { error } = await auth.signIn(email, password);
      return { error };
    } catch (error) {
      console.error('Signin error:', error);
      return { error };
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    try {
      setLoading(true);
      const { error } = await auth.signOut();
      return { error };
    } catch (error) {
      console.error('Signout error:', error);
      return { error };
    } finally {
      setLoading(false);
    }
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!user) {
      return { error: new Error('No user logged in') };
    }

    try {
      const { data, error } = await profiles.update(user.id, updates);
      
      if (error) {
        return { error };
      }

      setProfile(data);
      return { error: null };
    } catch (error) {
      console.error('Update profile error:', error);
      return { error };
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await loadUserProfile(user.id);
    }
  };

  const value = {
    user,
    profile,
    session,
    loading,
    signUp,
    signIn,
    signOut,
    updateProfile,
    refreshProfile
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};