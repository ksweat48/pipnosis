import React, { useState, useEffect } from 'react';
import {
  MessageSquare,
  Bug,
  Lightbulb,
  Sparkles,
  Search,
  ChevronDown,
  ChevronUp,
  Send,
  AlertCircle,
  CheckCircle2,
  Eye,
  Flag
} from 'lucide-react';
import {
  userFeedbackService,
  FeedbackType,
  FeedbackStatus,
  FeedbackPriority,
  UserFeedback,
  FeedbackReply,
  FeedbackStats
} from '../../services/user-feedback-service';
import { useToast } from '../../hooks/useToast';
import { logger } from '../../lib/logger';

const FEEDBACK_TYPE_OPTIONS: { value: FeedbackType | 'all'; label: string; icon: React.ReactNode }[] = [
  { value: 'all', label: 'All Types', icon: <MessageSquare className="w-4 h-4" /> },
  { value: 'bug', label: 'Bug Report', icon: <Bug className="w-4 h-4" /> },
  { value: 'improvement', label: 'Improvement', icon: <Lightbulb className="w-4 h-4" /> },
  { value: 'feature_request', label: 'Feature Request', icon: <Sparkles className="w-4 h-4" /> },
  { value: 'general', label: 'General', icon: <MessageSquare className="w-4 h-4" /> }
];

export function UserFeedbackPanel() {
  const [feedback, setFeedback] = useState<UserFeedback[]>([]);
  const [filteredFeedback, setFilteredFeedback] = useState<UserFeedback[]>([]);
  const [stats, setStats] = useState<FeedbackStats>({ total: 0, new: 0, reviewing: 0, resolved: 0 });
  const [statusFilter, setStatusFilter] = useState<FeedbackStatus | 'all'>('all');
  const [typeFilter, setTypeFilter] = useState<FeedbackType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedFeedback, setExpandedFeedback] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, FeedbackReply[]>>({});
  const [replyMessage, setReplyMessage] = useState('');
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    loadFeedback();
    loadStats();

    const unsubscribe = userFeedbackService.subscribeToNewFeedback((newFeedback) => {
      showToast(`New feedback from ${newFeedback.user_email}`, 'info');
      loadFeedback();
      loadStats();
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    applyFilters();
  }, [feedback, statusFilter, typeFilter, searchQuery]);

  const loadFeedback = async () => {
    setIsLoading(true);
    try {
      const data = await userFeedbackService.getAllFeedback();
      setFeedback(data);
    } catch (error) {
      logger.error('Failed to load feedback', { error });
      showToast('Failed to load feedback', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const data = await userFeedbackService.getFeedbackStats();
      setStats(data);
    } catch (error) {
      logger.error('Failed to load stats', { error });
    }
  };

  const applyFilters = () => {
    let filtered = [...feedback];

    if (statusFilter !== 'all') {
      filtered = filtered.filter(f => f.status === statusFilter);
    }

    if (typeFilter !== 'all') {
      filtered = filtered.filter(f => f.feedback_type === typeFilter);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        f =>
          f.subject.toLowerCase().includes(query) ||
          f.message.toLowerCase().includes(query) ||
          f.user_email.toLowerCase().includes(query)
      );
    }

    setFilteredFeedback(filtered);
  };

  const loadReplies = async (feedbackId: string) => {
    try {
      const feedbackReplies = await userFeedbackService.getFeedbackReplies(feedbackId);
      setReplies(prev => ({ ...prev, [feedbackId]: feedbackReplies }));
    } catch (error) {
      logger.error('Failed to load replies', { error });
    }
  };

  const handleStatusChange = async (feedbackId: string, newStatus: FeedbackStatus) => {
    const notes = adminNotes[feedbackId];
    const result = await userFeedbackService.updateFeedbackStatus(feedbackId, newStatus, notes);

    if (result.success) {
      showToast(`Status updated to ${newStatus}`, 'success');
      loadFeedback();
      loadStats();
    } else {
      showToast(result.error || 'Failed to update status', 'error');
    }
  };

  const handlePriorityChange = async (feedbackId: string, newPriority: FeedbackPriority) => {
    const result = await userFeedbackService.updateFeedbackPriority(feedbackId, newPriority);

    if (result.success) {
      showToast(`Priority updated to ${newPriority}`, 'success');
      loadFeedback();
    } else {
      showToast(result.error || 'Failed to update priority', 'error');
    }
  };

  const handleAddReply = async (feedbackId: string) => {
    if (!replyMessage.trim()) return;

    setIsSubmittingReply(true);
    const result = await userFeedbackService.addReply(feedbackId, replyMessage.trim(), true);
    setIsSubmittingReply(false);

    if (result.success) {
      showToast('Reply sent successfully', 'success');
      setReplyMessage('');
      loadReplies(feedbackId);
    } else {
      showToast(result.error || 'Failed to send reply', 'error');
    }
  };

  const toggleExpanded = (feedbackId: string) => {
    if (expandedFeedback === feedbackId) {
      setExpandedFeedback(null);
    } else {
      setExpandedFeedback(feedbackId);
      if (!replies[feedbackId]) {
        loadReplies(feedbackId);
      }
      const item = feedback.find(f => f.id === feedbackId);
      if (item && item.admin_notes) {
        setAdminNotes(prev => ({ ...prev, [feedbackId]: item.admin_notes || '' }));
      }
    }
  };

  const getStatusBadge = (status: FeedbackStatus) => {
    switch (status) {
      case 'new':
        return (
          <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-yellow-500/20 text-yellow-400 rounded">
            <AlertCircle className="w-3 h-3" />
            New
          </span>
        );
      case 'reviewing':
        return (
          <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-400 rounded">
            <Eye className="w-3 h-3" />
            Reviewing
          </span>
        );
      case 'resolved':
        return (
          <span className="flex items-center gap-1 px-2 py-1 text-xs font-medium bg-emerald-500/20 text-emerald-400 rounded">
            <CheckCircle2 className="w-3 h-3" />
            Resolved
          </span>
        );
    }
  };

  const getPriorityBadge = (priority: FeedbackPriority) => {
    const colors = {
      low: 'text-gray-400',
      medium: 'text-yellow-400',
      high: 'text-red-400'
    };
    return <Flag className={`w-4 h-4 ${colors[priority]}`} />;
  };

  const getFeedbackTypeLabel = (type: FeedbackType) => {
    const option = FEEDBACK_TYPE_OPTIONS.find(opt => opt.value === type);
    return option ? option.label : type;
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-4 gap-4">
        <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
          <div className="text-2xl font-bold text-white">{stats.total}</div>
          <div className="text-sm text-gray-400">Total Feedback</div>
        </div>
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
          <div className="text-2xl font-bold text-yellow-400">{stats.new}</div>
          <div className="text-sm text-yellow-400/80">New</div>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4">
          <div className="text-2xl font-bold text-blue-400">{stats.reviewing}</div>
          <div className="text-sm text-blue-400/80">Reviewing</div>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
          <div className="text-2xl font-bold text-emerald-400">{stats.resolved}</div>
          <div className="text-sm text-emerald-400/80">Resolved</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 items-center">
        <div className="flex-1 min-w-[200px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search feedback..."
              className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setStatusFilter('all')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              statusFilter === 'all'
                ? 'bg-emerald-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            All ({stats.total})
          </button>
          <button
            onClick={() => setStatusFilter('new')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              statusFilter === 'new'
                ? 'bg-yellow-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            New ({stats.new})
          </button>
          <button
            onClick={() => setStatusFilter('reviewing')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              statusFilter === 'reviewing'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Reviewing ({stats.reviewing})
          </button>
          <button
            onClick={() => setStatusFilter('resolved')}
            className={`px-4 py-2 rounded-lg font-medium transition-colors ${
              statusFilter === 'resolved'
                ? 'bg-emerald-500 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            Resolved ({stats.resolved})
          </button>
        </div>

        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as FeedbackType | 'all')}
          className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-emerald-500"
        >
          {FEEDBACK_TYPE_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-3">
        {filteredFeedback.length === 0 ? (
          <div className="text-center py-12 bg-gray-700/50 rounded-lg border border-gray-600">
            <MessageSquare className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400">No feedback found</p>
          </div>
        ) : (
          filteredFeedback.map(item => (
            <div
              key={item.id}
              className="bg-gray-700/50 rounded-lg border border-gray-600 overflow-hidden"
            >
              <div
                onClick={() => toggleExpanded(item.id)}
                className="p-4 cursor-pointer hover:bg-gray-700/70 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <div className="flex items-center gap-2">
                        {getPriorityBadge(item.priority)}
                        <span className="text-sm font-medium text-gray-400">
                          {getFeedbackTypeLabel(item.feedback_type)}
                        </span>
                      </div>
                      <span className="text-sm text-gray-500">•</span>
                      <span className="text-sm text-gray-400">{item.user_email}</span>
                    </div>
                    <h3 className="font-semibold text-white mb-1">{item.subject}</h3>
                    <p className="text-sm text-gray-400 line-clamp-2">{item.message}</p>
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      <span>{new Date(item.created_at).toLocaleString()}</span>
                      {replies[item.id] && replies[item.id].length > 0 && (
                        <span>{replies[item.id].length} {replies[item.id].length === 1 ? 'reply' : 'replies'}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {getStatusBadge(item.status)}
                    {expandedFeedback === item.id ? (
                      <ChevronUp className="w-5 h-5 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-5 h-5 text-gray-400" />
                    )}
                  </div>
                </div>
              </div>

              {expandedFeedback === item.id && (
                <div className="border-t border-gray-600 p-4 bg-gray-800/50 space-y-4">
                  <div>
                    <h4 className="text-sm font-medium text-gray-300 mb-2">Full Message</h4>
                    <p className="text-sm text-gray-400 whitespace-pre-wrap">{item.message}</p>
                  </div>

                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Status
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleStatusChange(item.id, 'new')}
                          className={`px-3 py-1 text-sm rounded ${
                            item.status === 'new'
                              ? 'bg-yellow-500 text-white'
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          New
                        </button>
                        <button
                          onClick={() => handleStatusChange(item.id, 'reviewing')}
                          className={`px-3 py-1 text-sm rounded ${
                            item.status === 'reviewing'
                              ? 'bg-blue-500 text-white'
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          Reviewing
                        </button>
                        <button
                          onClick={() => handleStatusChange(item.id, 'resolved')}
                          className={`px-3 py-1 text-sm rounded ${
                            item.status === 'resolved'
                              ? 'bg-emerald-500 text-white'
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          Resolved
                        </button>
                      </div>
                    </div>

                    <div className="flex-1">
                      <label className="block text-sm font-medium text-gray-300 mb-2">
                        Priority
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handlePriorityChange(item.id, 'low')}
                          className={`px-3 py-1 text-sm rounded ${
                            item.priority === 'low'
                              ? 'bg-gray-500 text-white'
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          Low
                        </button>
                        <button
                          onClick={() => handlePriorityChange(item.id, 'medium')}
                          className={`px-3 py-1 text-sm rounded ${
                            item.priority === 'medium'
                              ? 'bg-yellow-500 text-white'
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          Medium
                        </button>
                        <button
                          onClick={() => handlePriorityChange(item.id, 'high')}
                          className={`px-3 py-1 text-sm rounded ${
                            item.priority === 'high'
                              ? 'bg-red-500 text-white'
                              : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                          }`}
                        >
                          High
                        </button>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Admin Notes
                    </label>
                    <textarea
                      value={adminNotes[item.id] || ''}
                      onChange={(e) => setAdminNotes(prev => ({ ...prev, [item.id]: e.target.value }))}
                      placeholder="Internal notes (not visible to user)..."
                      rows={2}
                      className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-400 focus:outline-none focus:border-emerald-500 resize-none"
                    />
                  </div>

                  {replies[item.id] && replies[item.id].length > 0 && (
                    <div className="space-y-2">
                      <h4 className="text-sm font-medium text-gray-300">Conversation</h4>
                      {replies[item.id].map(reply => (
                        <div
                          key={reply.id}
                          className={`p-3 rounded-lg ${
                            reply.is_admin
                              ? 'bg-emerald-500/10 border border-emerald-500/30'
                              : 'bg-gray-700'
                          }`}
                        >
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-xs font-medium text-gray-400">
                              {reply.is_admin ? 'Admin' : 'User'}
                            </span>
                            <span className="text-xs text-gray-500">
                              {new Date(reply.created_at).toLocaleString()}
                            </span>
                          </div>
                          <p className="text-sm text-gray-300">{reply.message}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={replyMessage}
                      onChange={(e) => setReplyMessage(e.target.value)}
                      placeholder="Reply to user..."
                      className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-400 focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      onClick={() => handleAddReply(item.id)}
                      disabled={!replyMessage.trim() || isSubmittingReply}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                      <Send className="w-4 h-4" />
                      Reply
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
