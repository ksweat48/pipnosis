import { useState, useEffect } from 'react';
import { clubMembershipService, type UserMembership } from '@/services/club-membership-service';

export function useClubMembership(userId: string | null | undefined) {
  const [membership, setMembership] = useState<UserMembership | null | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setMembership(null);
      setLoading(false);
      return;
    }

    let cancelled = false;

    clubMembershipService
      .getUserMembership(userId)
      .then((m) => {
        if (!cancelled) setMembership(m);
      })
      .catch(() => {
        if (!cancelled) setMembership(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { membership, loading };
}
