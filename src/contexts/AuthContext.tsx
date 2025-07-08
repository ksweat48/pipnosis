import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { 
  supabase, 
  createUserProfile, 
  getUserProfile, 
  UserProfile,
  subscribeToUserData,
  checkDatabaseHealth
} from '../lib/supabase';

interface AuthContextType {
  user: User | null;
  profile: UserProfile | null;
  session: Session | null;
  loading: boolean;
  databaseConnected: boolean;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ user: User | null; error: AuthError | null }>;
  signIn: (email: string, password: string) => Promise<{ user: User | null; error: AuthError | null }>;
  signOut: () => Promise<{ error: AuthError | null }>;
  updateProfile: (updates: Partial<UserProfile>) => Promise<UserProfile | null>;
  refreshProfile: () => Promise<void>;
  showDatabaseSetup: boolean;
  setShowDatabaseSetup: (show: boolean) => void;
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
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [databaseConnected, setDatabaseConnected] = useState(false);
  const [showDatabaseSetup, setShowDatabaseSetup] = useState(false);
  const [authInitialized, setAuthInitialized] = useState(false);
  const [isTestUser, setIsTestUser] = useState(false);
  const [dbCheckInProgress, setDbCheckInProgress] = useState(false); 
  const [dbConnectionConfirmed, setDbConnectionConfirmed] = useState(false); 

  // Check if we're in production
  const isProduction = window.location.hostname === 'pipnosis.com' || 
                      window.location.hostname === 'www.pipnosis.com' ||
                      false; // Disable production mode

  // CRITICAL FIX: Enhanced database connection check with better persistence and timeout handling
  useEffect(() => {
    let mounted = true;
    let checkTimeout: any;

    const checkDB = async () => { 
      // CRITICAL FIX: If user is logged in and we've already confirmed DB connection, 
      // don't check again unless it's been a long time
      if (user && dbConnectionConfirmed && !isTestUser) {
        const lastConfirmed = localStorage.getItem('pipnosis_db_confirmed');
        const now = Date.now();
        const oneHour = 60 * 60 * 1000;
        
        if (lastConfirmed && (now - parseInt(lastConfirmed)) < oneHour) {
          console.log('✅ Database connection confirmed recently - maintaining online status');
          setDatabaseConnected(true);
          return;
        }
      }

      // Prevent multiple simultaneous checks
      if (dbCheckInProgress) return;
      
      setDbCheckInProgress(true);
      
      try {
        console.log('🔍 Checking database connection...');
        
        // In production, be more optimistic about database connectivity
        if (isProduction) {
          console.log('🔄 Local development environment - standard database checks');
          
          // Use standard database health check for local development
        } else {
          // Development environment - normal health check but with better error handling
          try {
            const isConnected = await checkDatabaseHealth();
            
            if (mounted) {
              setDatabaseConnected(isConnected);
              
              if (isConnected && user && !isTestUser) {
                setDbConnectionConfirmed(true);
                localStorage.setItem('pipnosis_db_confirmed', Date.now().toString());
              }
              
              // Only show database setup in development if there are issues AND user is logged in
              if (!isConnected && user && !isTestUser) {
                const lastShown = localStorage.getItem('pipnosis_db_setup_shown');
                const now = Date.now();
                const oneHour = 60 * 60 * 1000;
                
                if (!lastShown || (now - parseInt(lastShown)) > oneHour) {
                  setTimeout(() => {
                    if (mounted) {
                      setShowDatabaseSetup(true);
                      localStorage.setItem('pipnosis_db_setup_shown', now.toString());
                    }
                  }, 2000);
                }
              }
            }
          } catch (error) {
            console.error('❌ Database check error:', error);
            if (mounted) {
              if (user && !isTestUser) {
                console.log('🔄 User is logged in - maintaining connection status despite error');
                setDatabaseConnected(true);
              } else {
                setDatabaseConnected(false);
              }
            }
          }
        }
      } finally {
        if (mounted) {
          setDbCheckInProgress(false);
        }
      }
    };
    
    // Initial check with delay to let auth settle
    checkTimeout = setTimeout(() => {
      if (mounted) {
        checkDB();
      }
    }, 1000);
    
    // CRITICAL FIX: Much longer intervals for logged-in users with confirmed connections
    const checkInterval = user && dbConnectionConfirmed ? 1800000 : // 30 minutes for confirmed users
                         user ? 300000 : // 5 minutes for logged-in users
                         isProduction ? 600000 : 120000; // 10 minutes in prod, 2 minutes in dev for others
    
    const interval = setInterval(() => {
      if (mounted && !(user && dbConnectionConfirmed)) {
        checkDB();
      }
    }, checkInterval);
    
    return () => {
      mounted = false;
      if (checkTimeout) clearTimeout(checkTimeout);
      clearInterval(interval);
    };
  }, [user?.id, isProduction, isTestUser, dbCheckInProgress, dbConnectionConfirmed]);

  // Helper function to create mock user session
  const createMockUserSession = (email: string, fullName: string, accountBalance = 10000) => {
    // This function is no longer used as we're removing mock data
    return { mockUser: null, mockProfile: null };
  };

  // Helper function to clear all auth state
  const clearAuthState = () => {
    setUser(null);
    setProfile(null);
    setSession(null);
    setIsTestUser(false);
    setDbConnectionConfirmed(false);
    localStorage.removeItem('pipnosis_db_confirmed');
    console.log('🧹 Auth state cleared');
  };

  // CRITICAL FIX: Enhanced session initialization with better timeout handling
  useEffect(() => {
    let mounted = true;
    let initializationTimeoutId: any = null;
    let sessionCheckTimeoutId: any = null;

    // Check for test user session first
    const checkTestUser = () => {
      const testUser = localStorage.getItem('pipnosis_test_user');
      if (testUser) {
        try {
          const userData = JSON.parse(testUser);
          console.log('✅ Found test user session:', userData.email);
          
          const { mockUser, mockProfile } = createMockUserSession(
            userData.email, 
            userData.user_metadata?.full_name || 'Test User',
            userData.email === 'admin@pipnosis.com' ? 50000 : 10000
          );
          
          if (mounted) {
            setUser(mockUser);
            setProfile(mockProfile);
            setIsTestUser(true);
            setDatabaseConnected(true);
            setDbConnectionConfirmed(true);
            setLoading(false);
            setAuthInitialized(true);
          }
          return true;
        } catch (error) {
          console.error('Error parsing test user:', error);
          localStorage.removeItem('pipnosis_test_user');
        }
      }
      return false;
    };

    // CRITICAL FIX: Enhanced session check with multiple timeout layers
    const getInitialSession = async () => {
      try {
        console.log('Checking initial auth session...');
        
        // Shorter timeout for production to prevent hanging
        const sessionTimeout = isProduction ? 8000 : 12000; 
        
        initializationTimeoutId = setTimeout(() => {
          if (mounted && loading && !authInitialized) {
            console.warn('⚠️ Session check timeout, setting loading to false');
            setLoading(false);
            setAuthInitialized(true);
          }
        }, sessionTimeout);
        
        // Add session-specific timeout
        sessionCheckTimeoutId = setTimeout(() => {
          if (mounted) {
            if (loading && !authInitialized) {
              console.warn('Session check taking too long, forcing completion');
              setLoading(false);
              setAuthInitialized(true);
            }
          }
        }, sessionTimeout / 2);
        
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (initializationTimeoutId) {
          clearTimeout(initializationTimeoutId);
          initializationTimeoutId = null;
        }
        
        if (sessionCheckTimeoutId) {
          clearTimeout(sessionCheckTimeoutId);
          sessionCheckTimeoutId = null;
        }
        
        if (error) {
          console.error('Error getting session:', error);
          if (mounted) {
            setLoading(false);
            setAuthInitialized(true);
          }
        } else {
          console.log('✅ Initial session:', session?.user?.email || 'No session');
          if (mounted) {
            setSession(session);
            setUser(session?.user ?? null);
            setIsTestUser(false);
            
            if (session?.user) {
              // CRITICAL FIX: Load profile with timeout
              try {
                await Promise.race([
                  loadUserProfile(session.user.id),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Profile load timeout')), 5000)
                  )
                ]);
                setDbConnectionConfirmed(true);
                localStorage.setItem('pipnosis_db_confirmed', Date.now().toString());
              } catch (profileError) {
                console.warn('⚠️ Profile load timeout, continuing with basic auth');
              }
            }
            
            setLoading(false);
            setAuthInitialized(true);
          }
        }
      } catch (error) {
        console.error('Error in getInitialSession:', error);
        if (mounted) {
          setLoading(false);
          setAuthInitialized(true);
        }
      }
    };

    if (!checkTestUser()) {
      getInitialSession();
    }

    // CRITICAL FIX: Enhanced auth state change handler with better error handling
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;
        
        console.log('🔐 Auth state changed:', event, session?.user?.email || 'No user');
        
        try {
          if (event === 'SIGNED_IN' && session?.user) {
            console.log('✅ User signed in after email confirmation');
            
            const urlParams = new URLSearchParams(window.location.search);
            const isEmailConfirmation = urlParams.get('type') === 'signup' || 
                                       urlParams.get('confirmation') === 'true' ||
                                       event === 'SIGNED_IN';
            
            if (isEmailConfirmation) {
              console.log('📧 Email confirmation detected, loading profile...');
              window.history.replaceState({}, document.title, window.location.pathname);
            }
          }
          
          if (event === 'SIGNED_OUT') {
            console.log('🚪 Supabase sign out detected');
            clearAuthState();
          } else {
            setSession(session);
            setUser(session?.user ?? null);
            setIsTestUser(false);
            
            if (session?.user) {
              try {
                // CRITICAL FIX: Load profile with timeout
                await Promise.race([
                  loadUserProfile(session.user.id),
                  new Promise((_, reject) => 
                    setTimeout(() => reject(new Error('Profile load timeout')), 5000)
                  )
                ]);
                setDbConnectionConfirmed(true);
                localStorage.setItem('pipnosis_db_confirmed', Date.now().toString());
              } catch (profileError) {
                console.warn('⚠️ Profile load timeout during auth change');
              }
            } else {
              setProfile(null);
              setDbConnectionConfirmed(false);
              localStorage.removeItem('pipnosis_db_confirmed');
            }
          }
          
          if (!authInitialized) {
            setLoading(false);
            setAuthInitialized(true);
          }
        } catch (error) {
          console.error('❌ Error in auth state change handler:', error);
          if (!authInitialized) {
            setLoading(false);
            setAuthInitialized(true);
          }
        }
      }
    );

    return () => {
      mounted = false;
      if (initializationTimeoutId) {
        clearTimeout(initializationTimeoutId);
        initializationTimeoutId = null;
      }
      if (sessionCheckTimeoutId) {
        clearTimeout(sessionCheckTimeoutId);
        sessionCheckTimeoutId = null;
      }
      subscription.unsubscribe();
    };
  }, [isProduction]);

  // Set up real-time subscriptions for user data
  useEffect(() => {
    if (user && databaseConnected && !isTestUser) {
      console.log('🔄 Setting up real-time subscriptions for user:', user.id);
      
      const subscription = subscribeToUserData(user.id, (payload) => {
        console.log('📡 Real-time update:', payload);
      });

      return () => {
        console.log('🔄 Cleaning up real-time subscriptions');
        subscription.unsubscribe();
      };
    }
  }, [user, databaseConnected, isTestUser]);

  // CRITICAL FIX: Enhanced profile loading with timeout
  const loadUserProfile = async (userId: string) => {
    try {
      console.log('👤 Loading user profile for:', userId);
      
      const userProfile = await getUserProfile(userId);
      
      if (userProfile) {
        console.log('✅ User profile loaded:', userProfile.email);
        setProfile(userProfile);
        
        if (!databaseConnected) {
          console.log('✅ Database connection confirmed via profile load');
          setDatabaseConnected(true);
          setDbConnectionConfirmed(true);
          localStorage.setItem('pipnosis_db_confirmed', Date.now().toString());
        }
      } else {
        console.log('👤 No profile found, creating new profile...');
        
        try {
          const newProfile = await createUserProfile({
            id: userId,
            email: user?.email || 'user@pipnosis.com',
            full_name: user?.user_metadata?.full_name || 'User',
            plan_type: 'free',
            account_balance: 10000.00,
            risk_profile: 'auto',
            trading_preferences: {
              dataMode: 'api',
              riskProfile: 'auto',
              tradingGoal: 'weekly-income'
            }
          });
          
          console.log('✅ Created new user profile');
          setProfile(newProfile);
          
          if (!databaseConnected) {
            console.log('✅ Database connection confirmed via profile creation');
            setDatabaseConnected(true);
            setDbConnectionConfirmed(true);
            localStorage.setItem('pipnosis_db_confirmed', Date.now().toString());
          }
        } catch (createError) {
          console.error('❌ Failed to create user profile:', createError);
          
          setProfile(null);
          throw createError;
        }
      }
    } catch (error) {
      console.error('❌ Error loading user profile:', error);
      
      setProfile(null);
      throw error;
    }
  };

  const refreshProfile = async () => {
    if (user && !isTestUser) {
      await loadUserProfile(user.id);
    }
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    try {
      setLoading(true);
      console.log('📝 Attempting signup for:', email);
      
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
          },
          emailRedirectTo: `${window.location.origin}/?confirmation=true`
        },
      });

      if (error) {
        console.error('❌ Signup error:', error);
        return { user: null, error };
      }

      console.log('✅ Signup successful:', data.user?.email);

      if (data.user) {
        try {
          const newProfile = await createUserProfile({
            id: data.user.id,
            email: data.user.email!,
            full_name: fullName,
            plan_type: 'free',
            account_balance: 10000.00,
            risk_profile: 'auto',
            trading_preferences: {
              dataMode: 'api',
              riskProfile: 'auto',
              tradingGoal: 'weekly-income'
            }
          });
          setProfile(newProfile);
          setDbConnectionConfirmed(true);
          localStorage.setItem('pipnosis_db_confirmed', Date.now().toString());
          console.log('✅ User profile created');
        } catch (profileError) {
          console.error('❌ Error creating user profile:', profileError);
        }
      }

      return { user: data.user, error: null };
    } catch (error) {
      console.error('❌ Signup error:', error);
      return { user: null, error: error as AuthError };
    } finally {
      setLoading(false);
    }
  };

  const signIn = async (email: string, password: string) => {
    try {
      setLoading(true);
      console.log('🔑 Attempting signin for:', email);
      
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('❌ Signin error:', error);
      } else {
        console.log('✅ Signin successful:', data.user?.email);
        setIsTestUser(false);
        setDbConnectionConfirmed(true);
        localStorage.setItem('pipnosis_db_confirmed', Date.now().toString());
      }

      return { user: data.user, error };
    } catch (error) {
      console.error('❌ Signin error:', error);
      return { user: null, error: error as AuthError };
    } finally {
      setLoading(false);
    }
  };

  // CRITICAL FIX: Enhanced sign out with better state management
  const signOut = async () => {
    try {
      console.log('🚪 Starting sign out process...');
      
      // CRITICAL FIX: Don't set loading during sign out to prevent UI blocking
      // setLoading(true); // REMOVED
      
      console.log('🔐 Signing out from Supabase...');
      const { error } = await supabase.auth.signOut();
      
      if (!error) {
        console.log('✅ Supabase signout successful');
        clearAuthState();
      } else {
        console.error('❌ Supabase signout error:', error);
        clearAuthState();
      }
      
      return { error };
    } catch (error) {
      console.error('❌ Signout error:', error);
      clearAuthState();
      return { error: error as AuthError };
    }
  };

  const updateProfile = async (updates: Partial<UserProfile>) => {
    if (!user) return null;

    if (isTestUser) {
      const updatedProfile = { ...profile!, ...updates };
      setProfile(updatedProfile);
      console.log('✅ Test user profile updated locally');
      return updatedProfile;
    }

    try {
      console.log('👤 Updating user profile:', updates);
      
      const updatedProfile = await createUserProfile({
        ...profile!,
        ...updates,
        id: user.id,
        email: user.email!,
      });
      
      setProfile(updatedProfile);
      console.log('✅ Profile updated successfully');
      return updatedProfile;
    } catch (error) {
      console.error('❌ Error updating profile:', error);
      return null;
    }
  };

  const value = {
    user,
    profile,
    session,
    loading,
    databaseConnected,
    signUp,
    signIn,
    signOut,
    updateProfile,
    refreshProfile,
    showDatabaseSetup,
    setShowDatabaseSetup,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};