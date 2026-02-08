/**
 * CLUB REWARDS PAGE
 *
 * Display staking information and rewards system.
 * Phase 1: Display only with clear disclaimers.
 * Phase 2: Active staking and reward distribution.
 *
 * CRITICAL DISCLAIMERS:
 * - Not investment advice
 * - No guaranteed returns
 * - Utility tokens only
 * - Educational/entertainment purposes
 */

import React from 'react';
import { Gift, TrendingUp, Lock, AlertCircle, DollarSign, Coins } from 'lucide-react';
import { ClubLayout } from '@/components/ClubLayout';

export function ClubRewardsPage() {
  return (
    <ClubLayout>
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Critical Disclaimer Banner */}
        <div className="relative">
          <div className="absolute -inset-1 bg-gradient-to-r from-amber-600 to-orange-600 rounded-2xl opacity-30 blur-lg" />

          <div className="relative bg-gradient-to-br from-amber-900/30 to-orange-900/30 backdrop-blur-xl border-2 border-amber-500/50 rounded-2xl p-6">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-amber-500/20 rounded-xl flex-shrink-0">
                <AlertCircle size={28} className="text-amber-400" />
              </div>
              <div>
                <h3 className="text-xl font-bold text-amber-400 mb-2">Important Notice</h3>
                <div className="text-amber-200 text-sm space-y-2">
                  <p>
                    Pipnosis Club tokens are <span className="font-bold">utility tokens</span> for membership access and community features only.
                  </p>
                  <p>
                    <span className="font-bold">This is NOT investment advice.</span> There are <span className="font-bold">no guaranteed returns</span>.
                    Token values displayed are for utility purposes only and do not represent financial investments.
                  </p>
                  <p>
                    The rewards system is for <span className="font-bold">entertainment and engagement purposes</span> within the Pipnosis Club community.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Page Header */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl opacity-20 group-hover:opacity-30 transition blur-lg" />

          <div className="relative bg-gradient-to-br from-gray-900/95 to-slate-900/95 backdrop-blur-xl border-2 border-purple-500/30 rounded-2xl p-8">
            <div className="flex items-center gap-4 mb-4">
              <div className="relative">
                <div className="absolute inset-0 bg-purple-500 rounded-full blur-xl opacity-40" />
                <Gift size={48} className="text-purple-400 relative" />
              </div>
              <div>
                <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400">
                  Rewards & Staking
                </h1>
                <p className="text-purple-300 text-lg">Earn tokens through community engagement</p>
              </div>
            </div>
          </div>
        </div>

        {/* Coming Soon Notice */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl opacity-20 group-hover:opacity-30 transition blur-lg" />

          <div className="relative bg-gradient-to-br from-gray-900/95 to-slate-900/95 backdrop-blur-xl border-2 border-purple-500/30 rounded-2xl p-12 text-center">
            <div className="flex items-center justify-center mb-6">
              <div className="relative">
                <div className="absolute inset-0 bg-purple-500 rounded-full blur-xl opacity-60 animate-pulse" />
                <Lock size={64} className="text-purple-400 relative" />
              </div>
            </div>

            <h2 className="text-3xl font-bold text-purple-400 mb-4">Rewards System Coming Soon</h2>

            <p className="text-purple-300 text-lg mb-8 max-w-2xl mx-auto">
              The rewards and staking features are currently under development. Once launched, you'll have access to:
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left max-w-4xl mx-auto">
              <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-3 bg-purple-900/40 rounded-lg">
                    <Coins size={24} className="text-purple-400" />
                  </div>
                  <h3 className="text-xl font-bold text-purple-400">Token Staking</h3>
                </div>
                <ul className="text-purple-300 text-sm space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Lock tokens for specified periods</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Earn bonus tokens based on stake duration</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Flexible unstaking options</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Track staking history and returns</span>
                  </li>
                </ul>
              </div>

              <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-3 bg-purple-900/40 rounded-lg">
                    <TrendingUp size={24} className="text-purple-400" />
                  </div>
                  <h3 className="text-xl font-bold text-purple-400">Community Rewards</h3>
                </div>
                <ul className="text-purple-300 text-sm space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Earn tokens for active participation</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Referral bonuses and incentives</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Milestone achievements and badges</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Exclusive member benefits</span>
                  </li>
                </ul>
              </div>

              <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-3 bg-purple-900/40 rounded-lg">
                    <DollarSign size={24} className="text-purple-400" />
                  </div>
                  <h3 className="text-xl font-bold text-purple-400">Cashout Options</h3>
                </div>
                <ul className="text-purple-300 text-sm space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Convert earned tokens to cash rewards</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Transparent conversion rates</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Multiple payout methods</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Secure transaction processing</span>
                  </li>
                </ul>
              </div>

              <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-3 bg-purple-900/40 rounded-lg">
                    <Gift size={24} className="text-purple-400" />
                  </div>
                  <h3 className="text-xl font-bold text-purple-400">Special Events</h3>
                </div>
                <ul className="text-purple-300 text-sm space-y-2">
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Limited-time bonus opportunities</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Community challenges and contests</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Seasonal reward multipliers</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-purple-400 mt-1">•</span>
                    <span>Member appreciation events</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Reminder Disclaimer */}
        <div className="bg-gray-900/50 border border-purple-500/20 rounded-xl p-6 text-center">
          <p className="text-purple-400 text-sm">
            <span className="font-bold">Remember:</span> Pipnosis Club tokens are utility tokens for membership access and community features.
            This is not financial advice. There are no guaranteed returns.
          </p>
        </div>
      </div>
    </ClubLayout>
  );
}
