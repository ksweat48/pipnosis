import { supabase } from '@/lib/supabase';
import { TRADING_CONSTANTS } from '@/config/trading-constants';

interface DeviceFingerprint {
  ipAddress: string;
  deviceFingerprint: string;
  browserFingerprint: string;
  userAgent: string;
  screenResolution: string;
  timezone: string;
  language: string;
}

interface RiskFactors {
  ipMatch: boolean;
  deviceMatch: boolean;
  browserMatch: boolean;
  emailSimilar: boolean;
  cookieMatch: boolean;
  details: string[];
}

interface RiskAssessment {
  riskScore: number;
  status: 'approved' | 'requires_verification' | 'blocked';
  factors: RiskFactors;
}

class ReferralRiskEngine {
  private calculateLevenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }

  async assessReferralRisk(
    referrerId: string,
    referredUserId: string,
    referredEmail: string,
    deviceFingerprint: DeviceFingerprint
  ): Promise<RiskAssessment> {
    let riskScore = 0;
    const factors: RiskFactors = {
      ipMatch: false,
      deviceMatch: false,
      browserMatch: false,
      emailSimilar: false,
      cookieMatch: false,
      details: []
    };

    try {
      const { data: referrerFingerprints } = await supabase
        .from('device_fingerprints')
        .select('*')
        .eq('user_id', referrerId);

      if (!referrerFingerprints || referrerFingerprints.length === 0) {
        return { riskScore: 0, status: 'approved', factors };
      }

      for (const fp of referrerFingerprints) {
        if (fp.ip_address === deviceFingerprint.ipAddress) {
          factors.ipMatch = true;
          riskScore += 1;
          factors.details.push('Shared IP address (acceptable for family/WiFi)');
        }

        if (fp.device_fingerprint === deviceFingerprint.deviceFingerprint) {
          factors.deviceMatch = true;
          riskScore += 5;
          factors.details.push('Same device fingerprint detected');
        }

        if (fp.browser_fingerprint === deviceFingerprint.browserFingerprint) {
          factors.browserMatch = true;
          riskScore += 5;
          factors.details.push('Same browser fingerprint detected');
        }
      }

      const { data: referrerProfile } = await supabase
        .from('user_profiles')
        .select('email')
        .eq('id', referrerId)
        .maybeSingle();

      if (referrerProfile?.email) {
        const emailDistance = this.calculateLevenshteinDistance(
          referrerProfile.email.toLowerCase(),
          referredEmail.toLowerCase()
        );

        if (emailDistance < 3) {
          factors.emailSimilar = true;
          riskScore += 5;
          factors.details.push('Very similar email addresses');
        }
      }

      await supabase
        .from('device_fingerprints')
        .insert({
          user_id: referredUserId,
          ip_address: deviceFingerprint.ipAddress,
          device_fingerprint: deviceFingerprint.deviceFingerprint,
          browser_fingerprint: deviceFingerprint.browserFingerprint,
          user_agent: deviceFingerprint.userAgent,
          screen_resolution: deviceFingerprint.screenResolution,
          timezone: deviceFingerprint.timezone,
          language: deviceFingerprint.language
        });

    } catch (error) {
      console.error('[Referral Risk] Error assessing risk:', error);
    }

    let status: 'approved' | 'requires_verification' | 'blocked';
    if (riskScore <= 5) {
      status = 'approved';
    } else if (riskScore <= 14) {
      status = 'requires_verification';
      factors.details.push('Email and phone verification required before reward');
    } else {
      status = 'blocked';
      factors.details.push('High fraud risk - referral blocked');
    }

    return { riskScore, status, factors };
  }

  async trackReferral(
    referrerId: string,
    referredUserId: string,
    referralCode: string,
    riskAssessment: RiskAssessment
  ): Promise<boolean> {
    try {
      const { data: referralCodes } = await supabase
        .from('referral_codes')
        .select('monthly_referrals, last_monthly_reset')
        .eq('user_id', referrerId)
        .maybeSingle();

      if (referralCodes) {
        const lastReset = new Date(referralCodes.last_monthly_reset);
        const now = new Date();
        const monthsSinceReset = (now.getFullYear() - lastReset.getFullYear()) * 12 +
          (now.getMonth() - lastReset.getMonth());

        let monthlyCount = referralCodes.monthly_referrals;
        if (monthsSinceReset >= 1) {
          monthlyCount = 0;
          await supabase
            .from('referral_codes')
            .update({
              monthly_referrals: 0,
              last_monthly_reset: new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
            })
            .eq('user_id', referrerId);
        }

        if (monthlyCount >= 5) {
          console.warn('[Referral Risk] Monthly referral limit reached');
          return false;
        }
      }

      const { error } = await supabase
        .from('referral_tracking')
        .insert({
          referrer_id: referrerId,
          referred_user_id: referredUserId,
          referral_code_used: referralCode,
          risk_score: riskAssessment.riskScore,
          risk_factors: riskAssessment.factors,
          status: riskAssessment.status,
          reward_granted: riskAssessment.status === 'approved'
        });

      if (error) throw error;

      if (riskAssessment.status === 'approved') {
        await this.grantReferralRewards(referrerId, referredUserId);
      }

      return true;
    } catch (error) {
      console.error('[Referral Risk] Error tracking referral:', error);
      return false;
    }
  }

  private async grantReferralRewards(referrerId: string, referredUserId: string): Promise<void> {
    try {
      const referrerAmount = TRADING_CONSTANTS.REFERRAL_REWARDS.REFERRER_CREDITS;
      const referredAmount = TRADING_CONSTANTS.REFERRAL_REWARDS.REFERRED_USER_CREDITS;

      await supabase.rpc('add_tokens', {
        p_user_id: referrerId,
        p_amount: referrerAmount,
        p_transaction_type: 'referral_earned',
        p_metadata: { referred_user_id: referredUserId }
      });

      await supabase.rpc('add_tokens', {
        p_user_id: referredUserId,
        p_amount: referredAmount,
        p_transaction_type: 'referral_reward',
        p_metadata: { referrer_id: referrerId }
      });

      await supabase
        .from('referral_codes')
        .update({
          total_referrals: supabase.sql`total_referrals + 1`,
          monthly_referrals: supabase.sql`monthly_referrals + 1`,
          total_rewards_earned: supabase.sql`total_rewards_earned + 5.0`
        })
        .eq('user_id', referrerId);

      console.log('[Referral Risk] Rewards granted successfully');
    } catch (error) {
      console.error('[Referral Risk] Error granting rewards:', error);
    }
  }

  collectDeviceFingerprint(): DeviceFingerprint {
    return {
      ipAddress: '',
      deviceFingerprint: this.generateDeviceFingerprint(),
      browserFingerprint: this.generateBrowserFingerprint(),
      userAgent: navigator.userAgent,
      screenResolution: `${screen.width}x${screen.height}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language
    };
  }

  private generateDeviceFingerprint(): string {
    const components = [
      navigator.userAgent,
      navigator.language,
      screen.colorDepth,
      screen.width,
      screen.height,
      new Date().getTimezoneOffset(),
      !!window.sessionStorage,
      !!window.localStorage
    ];
    return btoa(components.join('|'));
  }

  private generateBrowserFingerprint(): string {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#f60';
    ctx.fillRect(125, 1, 62, 20);
    ctx.fillStyle = '#069';
    ctx.fillText('Pipnosis', 2, 15);
    ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
    ctx.fillText('Pipnosis', 4, 17);

    return canvas.toDataURL();
  }
}

export const referralRiskEngine = new ReferralRiskEngine();
