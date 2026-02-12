import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
  adminOnly?: boolean;
}

export function ProtectedRoute({ children, adminOnly = false }: ProtectedRouteProps) {
  const { user, loading, adminLoading, isAdmin } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-950 flex items-center justify-center">
        <div className="animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full"></div>
      </div>
    );
  }

  if (!user) {
    const searchParams = new URLSearchParams(location.search);
    const refCode = searchParams.get('ref');
    if (refCode) {
      localStorage.setItem('pending_referral_code', refCode);
    }
    const authTarget = refCode ? `/auth?ref=${encodeURIComponent(refCode)}` : '/auth';
    return <Navigate to={authTarget} replace />;
  }

  if (adminOnly) {
    if (adminLoading) {
      return (
        <div className="min-h-screen bg-gray-950 flex items-center justify-center">
          <div className="animate-spin h-12 w-12 border-4 border-emerald-500/30 border-t-emerald-500 rounded-full"></div>
        </div>
      );
    }

    if (!isAdmin) {
      return <Navigate to="/charts" replace />;
    }
  }

  return <>{children}</>;
}
