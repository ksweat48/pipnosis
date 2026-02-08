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
      <div className="max-w-4xl mx-auto">
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-purple-600 to-pink-600 rounded-2xl opacity-20 group-hover:opacity-30 transition blur-lg" />

          <div className="relative bg-gradient-to-br from-gray-900/95 to-slate-900/95 backdrop-blur-xl border-2 border-purple-500/30 rounded-2xl p-12 text-center">
            <div className="flex items-center justify-center mb-6">
              <div className="relative">
                <div className="absolute inset-0 bg-purple-500 rounded-full blur-xl opacity-60 animate-pulse" />
                <MessageSquare size={64} className="text-purple-400 relative" />
              </div>
            </div>

            <h1 className="text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-purple-400 via-pink-400 to-indigo-400 mb-4">
              Member Chat
            </h1>

            <p className="text-purple-300 text-lg mb-8 max-w-2xl mx-auto">
              Connect with fellow Pipnosis Club members in real-time. Share insights, strategies, and build lasting connections.
            </p>

            <div className="bg-purple-900/20 border border-purple-500/30 rounded-xl p-8 mb-8">
              <div className="flex items-center justify-center gap-3 mb-4">
                <Lock size={24} className="text-purple-400" />
                <h3 className="text-xl font-bold text-purple-400">Coming Soon</h3>
              </div>

              <p className="text-purple-300 text-sm max-w-xl mx-auto">
                The member chat feature is currently under development. Once launched, you'll be able to:
              </p>

              <ul className="text-purple-300 text-sm space-y-2 mt-4 max-w-xl mx-auto text-left">
                <li className="flex items-start gap-2">
                  <span className="text-purple-400 mt-1">•</span>
                  <span>Send real-time messages to other Club members</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-400 mt-1">•</span>
                  <span>Share charts, screenshots, and trading insights</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-400 mt-1">•</span>
                  <span>React to messages with emojis</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-400 mt-1">•</span>
                  <span>Create and join topic-specific channels</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-purple-400 mt-1">•</span>
                  <span>Direct message other members privately</span>
                </li>
              </ul>
            </div>

            <div className="flex items-center justify-center gap-6 text-sm">
              <div className="flex items-center gap-2 text-purple-400">
                <Users size={18} />
                <span>Exclusive to Members</span>
              </div>
              <div className="w-1 h-1 bg-purple-500 rounded-full" />
              <div className="flex items-center gap-2 text-purple-400">
                <Lock size={18} />
                <span>Secure & Private</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ClubLayout>
  );
}
