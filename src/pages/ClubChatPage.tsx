/**
 * CLUB CHAT PAGE
 *
 * Real-time chat for Club members.
 * Phase 1: Basic infrastructure with coming soon message.
 * Phase 2: Full real-time chat with media support.
 */

import React from 'react';
import { MessageSquare, Users, Lock } from 'lucide-react';
import { ClubLayout } from '@/components/ClubLayout';

export function ClubChatPage() {
  return (
    <ClubLayout>
      <div className="max-w-4xl mx-auto flex items-center justify-center min-h-[calc(100vh-14rem)] sm:min-h-[calc(100vh-20rem)]">
        <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl p-6 sm:p-12 shadow-lg text-center w-full">
          <div className="flex items-center justify-center mb-4 sm:mb-6">
            <div className="p-3 sm:p-4 bg-violet-50 rounded-full">
              <MessageSquare size={40} className="text-violet-500 sm:w-16 sm:h-16" />
            </div>
          </div>

          <h1 className="text-2xl sm:text-4xl font-bold text-slate-900 mb-2 sm:mb-4">
            Member Chat
          </h1>

          <p className="text-slate-600 text-sm sm:text-lg mb-6 sm:mb-8 max-w-2xl mx-auto">
            Connect with fellow Pipnosis Club members in real-time. Share insights, strategies, and build lasting connections.
          </p>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-8 mb-6 sm:mb-8">
            <div className="flex items-center justify-center gap-2 sm:gap-3 mb-3 sm:mb-4">
              <Lock size={20} className="text-slate-500 sm:w-6 sm:h-6" />
              <h3 className="text-lg sm:text-xl font-bold text-slate-900">Coming Soon</h3>
            </div>

            <p className="text-slate-600 text-xs sm:text-sm max-w-xl mx-auto mb-4 sm:mb-6">
              The member chat feature is currently under development. Once launched, you'll be able to:
            </p>

            <ul className="text-slate-600 text-xs sm:text-sm space-y-2 sm:space-y-3 max-w-xl mx-auto text-left">
              <li className="flex items-start gap-2">
                <span className="text-violet-500 font-bold mt-0.5">•</span>
                <span>Send real-time messages to other Club members</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-500 font-bold mt-0.5">•</span>
                <span>Share charts, screenshots, and trading insights</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-500 font-bold mt-0.5">•</span>
                <span>React to messages with emojis</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-500 font-bold mt-0.5">•</span>
                <span>Create and join topic-specific channels</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-violet-500 font-bold mt-0.5">•</span>
                <span>Direct message other members privately</span>
              </li>
            </ul>
          </div>

          <div className="flex items-center justify-center gap-4 sm:gap-6 text-xs sm:text-sm">
            <div className="flex items-center gap-1.5 sm:gap-2 text-slate-600">
              <Users size={16} className="text-violet-500 sm:w-[18px] sm:h-[18px]" />
              <span>Exclusive to Members</span>
            </div>
            <div className="w-1 h-1 bg-slate-300 rounded-full" />
            <div className="flex items-center gap-1.5 sm:gap-2 text-slate-600">
              <Lock size={16} className="text-violet-500 sm:w-[18px] sm:h-[18px]" />
              <span>Secure & Private</span>
            </div>
          </div>
        </div>
      </div>
    </ClubLayout>
  );
}
