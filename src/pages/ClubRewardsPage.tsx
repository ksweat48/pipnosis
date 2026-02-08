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
      <div className="max-w-6xl mx-auto space-y-8 pb-8">
        {/* Critical Disclaimer Banner */}
        <div className="bg-gradient-to-br from-amber-50 to-orange-50 border border-amber-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div className="p-3 bg-amber-100 rounded-xl flex-shrink-0">
              <AlertCircle size={28} className="text-amber-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-amber-900 mb-2">Important Notice</h3>
              <div className="text-amber-800 text-sm space-y-2">
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

        {/* Page Header */}
        <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-2xl p-8 shadow-lg">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-violet-50 rounded-xl">
              <Gift size={48} className="text-violet-500" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-slate-900">
                Rewards & Staking
              </h1>
              <p className="text-slate-600 text-lg">Earn tokens through community engagement</p>
            </div>
          </div>
        </div>

        {/* Coming Soon Notice */}
        <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-2xl p-12 shadow-lg text-center">
          <div className="flex items-center justify-center mb-6">
            <div className="p-4 bg-slate-100 rounded-full">
              <Lock size={64} className="text-slate-500" />
            </div>
          </div>

          <h2 className="text-3xl font-bold text-slate-900 mb-4">Rewards System Coming Soon</h2>

          <p className="text-slate-600 text-lg mb-8 max-w-2xl mx-auto">
            The rewards and staking features are currently under development. Once launched, you'll have access to:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left max-w-4xl mx-auto">
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-violet-100 rounded-lg">
                  <Coins size={24} className="text-violet-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Token Staking</h3>
              </div>
              <ul className="text-slate-600 text-sm space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-violet-500 font-bold mt-0.5">•</span>
                  <span>Lock tokens for specified periods</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-violet-500 font-bold mt-0.5">•</span>
                  <span>Earn bonus tokens based on stake duration</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-violet-500 font-bold mt-0.5">•</span>
                  <span>Flexible unstaking options</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-violet-500 font-bold mt-0.5">•</span>
                  <span>Track staking history and returns</span>
                </li>
              </ul>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-emerald-100 rounded-lg">
                  <TrendingUp size={24} className="text-emerald-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Community Rewards</h3>
              </div>
              <ul className="text-slate-600 text-sm space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 font-bold mt-0.5">•</span>
                  <span>Earn tokens for active participation</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 font-bold mt-0.5">•</span>
                  <span>Referral bonuses and incentives</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 font-bold mt-0.5">•</span>
                  <span>Milestone achievements and badges</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-emerald-500 font-bold mt-0.5">•</span>
                  <span>Exclusive member benefits</span>
                </li>
              </ul>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-amber-100 rounded-lg">
                  <DollarSign size={24} className="text-amber-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Cashout Options</h3>
              </div>
              <ul className="text-slate-600 text-sm space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 font-bold mt-0.5">•</span>
                  <span>Convert earned tokens to cash rewards</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 font-bold mt-0.5">•</span>
                  <span>Transparent conversion rates</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 font-bold mt-0.5">•</span>
                  <span>Multiple payout methods</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-amber-500 font-bold mt-0.5">•</span>
                  <span>Secure transaction processing</span>
                </li>
              </ul>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 shadow-sm">
              <div className="flex items-center gap-3 mb-4">
                <div className="p-3 bg-blue-100 rounded-lg">
                  <Gift size={24} className="text-blue-600" />
                </div>
                <h3 className="text-xl font-bold text-slate-900">Special Events</h3>
              </div>
              <ul className="text-slate-600 text-sm space-y-2">
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 font-bold mt-0.5">•</span>
                  <span>Limited-time bonus opportunities</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 font-bold mt-0.5">•</span>
                  <span>Community challenges and contests</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 font-bold mt-0.5">•</span>
                  <span>Seasonal reward multipliers</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-blue-500 font-bold mt-0.5">•</span>
                  <span>Member appreciation events</span>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Reminder Disclaimer */}
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-6 text-center shadow-sm">
          <p className="text-slate-600 text-sm">
            <span className="font-bold">Remember:</span> Pipnosis Club tokens are utility tokens for membership access and community features.
            This is not financial advice. There are no guaranteed returns.
          </p>
        </div>
      </div>
    </ClubLayout>
  );
}
