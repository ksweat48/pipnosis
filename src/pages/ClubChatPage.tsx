import React, { useEffect, useState, useRef, useCallback } from 'react';
import { MessageSquare, Send, Loader2, ChevronDown, Trash2, SmilePlus, Crown } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { ClubLayout } from '@/components/ClubLayout';
import { clubChatService, type ChatMessage, type ChatReaction } from '@/services/club-chat-service';
import { clubMembershipService } from '@/services/club-membership-service';
import { clubAccessGateService, type ClubAccessResult } from '@/services/club-access-gate-service';

const TIER_COLORS: Record<number, string> = {
  1: '#6366F1',
  2: '#0EA5E9',
  3: '#10B981',
  4: '#F59E0B',
  5: '#EF4444',
  6: '#D946EF',
};

const TIER_NAMES: Record<number, string> = {
  1: 'Member',
  2: 'Starter',
  3: 'Builder',
  4: 'Pro',
  5: 'Elite',
  6: 'Founder',
};

const QUICK_REACTIONS = ['👍', '🔥', '💯', '📈', '🎯'];

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'now';
  if (diffMins < 60) return `${diffMins}m ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function TierBadge({ tier }: { tier: number }) {
  const color = TIER_COLORS[tier] || '#94A3B8';
  const name = TIER_NAMES[tier] || 'Member';

  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold leading-none"
      style={{ backgroundColor: `${color}18`, color, border: `1px solid ${color}30` }}
    >
      <Crown size={9} />
      {name}
    </span>
  );
}

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  reactions: ChatReaction[];
  userId: string;
  onDelete: (id: string) => void;
  onReact: (messageId: string, emoji: string) => void;
}

function MessageBubble({ message, isOwn, reactions, userId, onDelete, onReact }: MessageBubbleProps) {
  const [showReactions, setShowReactions] = useState(false);

  const reactionCounts = reactions.reduce<Record<string, { count: number; hasUser: boolean }>>((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, hasUser: false };
    acc[r.emoji].count++;
    if (r.userId === userId) acc[r.emoji].hasUser = true;
    return acc;
  }, {});

  return (
    <div className={`group flex ${isOwn ? 'justify-end' : 'justify-start'} mb-1`}>
      <div className={`max-w-[85%] sm:max-w-[70%] ${isOwn ? 'order-2' : ''}`}>
        {!isOwn && (
          <div className="flex items-center gap-1.5 mb-0.5 px-1">
            <span className="text-xs font-semibold text-slate-700">{message.displayName}</span>
            <TierBadge tier={message.membershipTier} />
          </div>
        )}

        <div className="relative">
          <div
            className={`px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${
              isOwn
                ? 'bg-slate-900 text-white rounded-br-md'
                : 'bg-white border border-slate-200/80 text-slate-800 rounded-bl-md shadow-sm'
            }`}
          >
            {message.content}
          </div>

          <div className={`flex items-center gap-1.5 mt-0.5 px-1 ${isOwn ? 'justify-end' : 'justify-start'}`}>
            <span className="text-[10px] text-slate-400">{formatTime(message.createdAt)}</span>

            <button
              onClick={() => setShowReactions(!showReactions)}
              className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-slate-100"
            >
              <SmilePlus size={12} className="text-slate-400" />
            </button>

            {isOwn && (
              <button
                onClick={() => onDelete(message.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-50"
              >
                <Trash2 size={12} className="text-red-400" />
              </button>
            )}
          </div>

          {showReactions && (
            <div className={`absolute z-10 mt-1 flex gap-1 bg-white border border-slate-200 rounded-xl px-2 py-1.5 shadow-lg ${isOwn ? 'right-0' : 'left-0'}`}>
              {QUICK_REACTIONS.map((emoji) => (
                <button
                  key={emoji}
                  onClick={() => { onReact(message.id, emoji); setShowReactions(false); }}
                  className="text-lg hover:scale-125 transition-transform"
                >
                  {emoji}
                </button>
              ))}
            </div>
          )}
        </div>

        {Object.keys(reactionCounts).length > 0 && (
          <div className={`flex flex-wrap gap-1 mt-1 px-1 ${isOwn ? 'justify-end' : ''}`}>
            {Object.entries(reactionCounts).map(([emoji, { count, hasUser }]) => (
              <button
                key={emoji}
                onClick={() => onReact(message.id, emoji)}
                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs border transition-colors ${
                  hasUser
                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                <span>{emoji}</span>
                <span className="font-medium">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ClubChatPage() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<Map<string, ChatReaction[]>>(new Map());
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [memberTier, setMemberTier] = useState(1);
  const [memberName, setMemberName] = useState('Member');
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [accessResult, setAccessResult] = useState<ClubAccessResult | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!user) return;
    initChat();
  }, [user]);

  const initChat = async () => {
    if (!user) return;

    const gateResult = await clubAccessGateService.validateAccess(user.id);
    setAccessResult(gateResult);

    if (!gateResult.canAccess) {
      setLoading(false);
      return;
    }

    if (gateResult.membership?.hasMembership) {
      setMemberTier(gateResult.membership.tierLevel);
      setMemberName(gateResult.membership.tierName || user.email?.split('@')[0] || 'Member');
    } else {
      setMemberTier(1);
      setMemberName(user.email?.split('@')[0] || 'Member');
    }

    const msgs = await clubChatService.getMessages();
    setMessages(msgs);
    setHasMore(msgs.length >= 50);

    if (msgs.length > 0) {
      const reactionMap = await clubChatService.getReactionsForMessages(msgs.map(m => m.id));
      setReactions(reactionMap);
    }

    setLoading(false);

    requestAnimationFrame(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
    });

    const unsub = clubChatService.subscribeToMessages((newMsg) => {
      setMessages(prev => {
        if (prev.find(m => m.id === newMsg.id)) return prev;
        return [...prev, newMsg];
      });
      requestAnimationFrame(() => {
        if (scrollContainerRef.current) {
          const el = scrollContainerRef.current;
          const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
          if (isNearBottom || newMsg.userId === user.id) {
            messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
          }
        }
      });
    });

    return unsub;
  };

  const handleLoadMore = async () => {
    if (!hasMore || loadingMore || messages.length === 0) return;
    setLoadingMore(true);

    const oldestDate = messages[0]?.createdAt;
    const olderMsgs = await clubChatService.getMessages(oldestDate);

    if (olderMsgs.length > 0) {
      const reactionMap = await clubChatService.getReactionsForMessages(olderMsgs.map(m => m.id));
      setReactions(prev => {
        const merged = new Map(prev);
        reactionMap.forEach((v, k) => merged.set(k, v));
        return merged;
      });
    }

    setMessages(prev => [...olderMsgs, ...prev]);
    setHasMore(olderMsgs.length >= 50);
    setLoadingMore(false);
  };

  const handleSend = async () => {
    if (!user || !inputValue.trim() || sending) return;
    setSending(true);

    const result = await clubChatService.sendMessage(
      user.id,
      inputValue.trim(),
      memberName,
      memberTier
    );

    if (result.success) {
      setInputValue('');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
      }
    }

    setSending(false);
  };

  const handleDelete = async (messageId: string) => {
    if (!user) return;
    const success = await clubChatService.deleteMessage(messageId, user.id);
    if (success) {
      setMessages(prev => prev.filter(m => m.id !== messageId));
    }
  };

  const handleReact = async (messageId: string, emoji: string) => {
    if (!user) return;
    await clubChatService.toggleReaction(messageId, user.id, emoji);

    const reactionMap = await clubChatService.getReactionsForMessages([messageId]);
    setReactions(prev => {
      const merged = new Map(prev);
      reactionMap.forEach((v, k) => merged.set(k, v));
      if (!reactionMap.has(messageId)) merged.set(messageId, []);
      return merged;
    });
  };

  const handleScroll = useCallback(() => {
    if (!scrollContainerRef.current) return;
    const el = scrollContainerRef.current;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
    setShowScrollDown(!isNearBottom);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 120) + 'px';
  };

  if (!user) return null;

  if (loading) {
    return (
      <ClubLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
        </div>
      </ClubLayout>
    );
  }

  if (accessResult && !accessResult.canAccess) {
    const isTokenIssue = accessResult.status === 'insufficient_tokens';
    return (
      <ClubLayout>
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="bg-white/70 backdrop-blur-md border border-slate-200/60 rounded-2xl p-8 text-center max-w-md shadow-lg">
            <MessageSquare size={48} className="text-slate-300 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-slate-900 mb-2">
              {isTokenIssue ? 'Insufficient Tokens' : 'Membership Required'}
            </h2>
            <p className="text-slate-600 text-sm">
              {accessResult.message}
            </p>
            {isTokenIssue && accessResult.tokens.deficit > 0 && (
              <p className="text-xs text-slate-500 mt-2">
                You need {accessResult.tokens.deficit} more PIP token{accessResult.tokens.deficit > 1 ? 's' : ''} to unlock access.
              </p>
            )}
          </div>
        </div>
      </ClubLayout>
    );
  }

  return (
    <ClubLayout>
      <div className="flex flex-col h-[calc(100vh-16rem)] sm:h-[calc(100vh-14rem)] bg-white/50 backdrop-blur-md border border-slate-200/60 rounded-xl sm:rounded-2xl shadow-lg overflow-hidden">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-200/60 bg-white/80 backdrop-blur-sm">
          <div className="p-2 bg-slate-100 rounded-lg">
            <MessageSquare size={18} className="text-slate-700" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900">Member Chat</h2>
            <p className="text-[11px] text-slate-500">{messages.length} messages</p>
          </div>
        </div>

        <div
          ref={scrollContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto px-3 sm:px-4 py-3 space-y-0.5"
        >
          {hasMore && (
            <div className="text-center py-2">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:text-slate-400"
              >
                {loadingMore ? 'Loading...' : 'Load earlier messages'}
              </button>
            </div>
          )}

          {messages.length === 0 && (
            <div className="flex items-center justify-center h-full text-slate-400 text-sm">
              No messages yet. Start the conversation!
            </div>
          )}

          {messages.map((msg) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isOwn={msg.userId === user.id}
              reactions={reactions.get(msg.id) || []}
              userId={user.id}
              onDelete={handleDelete}
              onReact={handleReact}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>

        {showScrollDown && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-10">
            <button
              onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
              className="p-2 bg-white border border-slate-200 rounded-full shadow-lg hover:shadow-xl transition-shadow"
            >
              <ChevronDown size={18} className="text-slate-600" />
            </button>
          </div>
        )}

        <div className="border-t border-slate-200/60 bg-white/90 backdrop-blur-sm px-3 sm:px-4 py-2.5">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={inputValue}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              rows={1}
              maxLength={2000}
              className="flex-1 resize-none px-3.5 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-300 focus:bg-white transition-colors"
              style={{ maxHeight: '120px' }}
            />
            <button
              onClick={handleSend}
              disabled={!inputValue.trim() || sending}
              className="flex-shrink-0 p-2.5 bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 text-white rounded-xl transition-colors"
            >
              {sending ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
        </div>
      </div>
    </ClubLayout>
  );
}
