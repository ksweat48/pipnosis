import React, { useState, useEffect } from 'react';
import { X, MessageSquare, Bug, Lightbulb, Sparkles, Send, Clock, CheckCircle2, Eye, MessageCircle } from 'lucide-react';
import { userFeedbackService, FeedbackType, UserFeedback, FeedbackReply } from '../services/user-feedback-service';
import { useToast } from '../hooks/useToast';
import { logger } from '../lib/logger';

interface BetaFeedbackDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

type Tab = 'submit' | 'history';

const FEEDBACK_TYPE_OPTIONS: { value: FeedbackType; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'bug', label: 'Bug Report', icon: <Bug className="w-4 h-4" />, color: 'text-red-400' },
  { value: 'improvement', label: 'Improvement Suggestion', icon: <Lightbulb className="w-4 h-4" />, color: 'text-yellow-400' },
  { value: 'feature_request', label: 'Feature Request', icon: <Sparkles className="w-4 h-4" />, color: 'text-blue-400' },
  { value: 'general', label: 'General Feedback', icon: <MessageSquare className="w-4 h-4" />, color: 'text-gray-400' }
];

export function BetaFeedbackDialog({ isOpen, onClose }: BetaFeedbackDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>('submit');
  const [feedbackType, setFeedbackType] = useState<FeedbackType>('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [userFeedback, setUserFeedback] = useState<UserFeedback[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [expandedFeedback, setExpandedFeedback] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, FeedbackReply[]>>({});
  const [replyMessage, setReplyMessage] = useState('');
  const [isSubmittingReply, setIsSubmittingReply] = useState(false);
  const { showToast } = useToast();

  useEffect(() => {
    if (isOpen && activeTab === 'history') {
      loadUserFeedback();
    }
  }, [isOpen, activeTab]);

  const loadUserFeedback = async () => {
    setIsLoadingHistory(true);
    try {
      const feedback = await userFeedbackService.getUserFeedback();
      setUserFeedback(feedback);
    } catch (error) {
      logger.error('Failed to load feedback history', { error });
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const loadReplies = async (feedbackId: string) => {
    try {
      const feedbackReplies = await userFeedbackService.getFeedbackReplies(feedbackId);
      setReplies(prev => ({ ...prev, [feedbackId]: feedbackReplies }));
    } catch (error) {
      logger.error('Failed to load replies', { error });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (subject.trim().length < 5 || subject.trim().length > 100) {
      showToast('Subject must be between 5 and 100 characters', 'error');
      return;
    }

    if (message.trim().length < 20 || message.trim().length > 1000) {
      showToast('Message must be between 20 and 1000 characters', 'error');
      return;
    }

    setIsSubmitting(true);

    const result = await userFeedbackService.submitFeedback({
      feedback_type: feedbackType,
      subject: subject.trim(),
      message: message.trim()
    });

    setIsSubmitting(false);

    if (result.success) {
      showToast('Feedback submitted successfully! Thank you for helping us improve.', 'success');
      setSubject('');
      setMessage('');
      setFeedbackType('general');
      if (activeTab === 'history') {
        loadUserFeedback();
      }
    } else {
      showToast(result.error || 'Failed to submit feedback', 'error');
    }
  };

  const handleAddReply = async (feedbackId: string) => {
    if (!replyMessage.trim()) return;

    setIsSubmittingReply(true);
    const result = await userFeedbackService.addReply(feedbackId, replyMessage.trim(), false);
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
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'new':
        return <span className="px-2 py-1 text-xs font-medium bg-yellow-500/20 text-yellow-400 rounded">New</span>;
      case 'reviewing':
        return <span className="px-2 py-1 text-xs font-medium bg-blue-500/20 text-blue-400 rounded">Reviewing</span>;
      case 'resolved':
        return <span className="px-2 py-1 text-xs font-medium bg-emerald-500/20 text-emerald-400 rounded">Resolved</span>;
      default:
        return null;
    }
  };

  const getFeedbackTypeIcon = (type: FeedbackType) => {
    const option = FEEDBACK_TYPE_OPTIONS.find(opt => opt.value === type);
    return option ? <span className={option.color}>{option.icon}</span> : null;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-r from-amber-500 to-orange-500 rounded-lg">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">Beta Feedback</h2>
              <p className="text-sm text-gray-400">Help us improve Pipnosis</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-700 rounded-lg transition-colors"
          >
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex border-b border-gray-700">
          <button
            onClick={() => setActiveTab('submit')}
            className={`flex-1 px-6 py-3 font-medium transition-colors ${
              activeTab === 'submit'
                ? 'text-emerald-400 border-b-2 border-emerald-400'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Send className="w-4 h-4" />
              Submit Feedback
            </div>
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 px-6 py-3 font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-emerald-400 border-b-2 border-emerald-400'
                : 'text-gray-400 hover:text-gray-300'
            }`}
          >
            <div className="flex items-center justify-center gap-2">
              <Clock className="w-4 h-4" />
              My Feedback
            </div>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'submit' ? (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Feedback Type
                </label>
                <div className="grid grid-cols-2 gap-3">
                  {FEEDBACK_TYPE_OPTIONS.map(option => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setFeedbackType(option.value)}
                      className={`flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
                        feedbackType === option.value
                          ? 'border-emerald-500 bg-emerald-500/10'
                          : 'border-gray-600 bg-gray-700/50 hover:border-gray-500'
                      }`}
                    >
                      <span className={option.color}>{option.icon}</span>
                      <span className="text-sm font-medium text-white">{option.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Subject <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Brief description of your feedback"
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-emerald-500"
                  required
                  minLength={5}
                  maxLength={100}
                />
                <div className="mt-1 text-xs text-gray-400">
                  {subject.length}/100 characters
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Message <span className="text-red-400">*</span>
                </label>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Please provide detailed information about your feedback..."
                  rows={6}
                  className="w-full px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:border-emerald-500 resize-none"
                  required
                  minLength={20}
                  maxLength={1000}
                />
                <div className="mt-1 text-xs text-gray-400">
                  {message.length}/1000 characters (minimum 20)
                </div>
              </div>

              <button
                type="submit"
                disabled={isSubmitting || subject.length < 5 || message.length < 20}
                className="w-full py-3 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white font-medium rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Submitting...
                  </>
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    Submit Feedback
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-4">
              {isLoadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                </div>
              ) : userFeedback.length === 0 ? (
                <div className="text-center py-12">
                  <MessageSquare className="w-16 h-16 text-gray-600 mx-auto mb-4" />
                  <p className="text-gray-400">No feedback submitted yet</p>
                  <button
                    onClick={() => setActiveTab('submit')}
                    className="mt-4 px-6 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors"
                  >
                    Submit Your First Feedback
                  </button>
                </div>
              ) : (
                userFeedback.map(feedback => (
                  <div
                    key={feedback.id}
                    className="bg-gray-700/50 rounded-lg border border-gray-600 overflow-hidden"
                  >
                    <div
                      onClick={() => toggleExpanded(feedback.id)}
                      className="p-4 cursor-pointer hover:bg-gray-700/70 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            {getFeedbackTypeIcon(feedback.feedback_type)}
                            <h3 className="font-semibold text-white">{feedback.subject}</h3>
                          </div>
                          <p className="text-sm text-gray-400 line-clamp-2">{feedback.message}</p>
                          <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                            <span>{new Date(feedback.created_at).toLocaleDateString()}</span>
                            {replies[feedback.id] && replies[feedback.id].length > 0 && (
                              <span className="flex items-center gap-1">
                                <MessageCircle className="w-3 h-3" />
                                {replies[feedback.id].length} {replies[feedback.id].length === 1 ? 'reply' : 'replies'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {getStatusBadge(feedback.status)}
                          <Eye className={`w-4 h-4 ${expandedFeedback === feedback.id ? 'text-emerald-400' : 'text-gray-500'}`} />
                        </div>
                      </div>
                    </div>

                    {expandedFeedback === feedback.id && (
                      <div className="border-t border-gray-600 p-4 bg-gray-800/50">
                        <div className="mb-4">
                          <h4 className="text-sm font-medium text-gray-300 mb-2">Full Message</h4>
                          <p className="text-sm text-gray-400 whitespace-pre-wrap">{feedback.message}</p>
                        </div>

                        {feedback.admin_notes && (
                          <div className="mb-4 p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                            <h4 className="text-sm font-medium text-blue-400 mb-1">Admin Notes</h4>
                            <p className="text-sm text-gray-300">{feedback.admin_notes}</p>
                          </div>
                        )}

                        {replies[feedback.id] && replies[feedback.id].length > 0 && (
                          <div className="mb-4 space-y-2">
                            <h4 className="text-sm font-medium text-gray-300 mb-2">Conversation</h4>
                            {replies[feedback.id].map(reply => (
                              <div
                                key={reply.id}
                                className={`p-3 rounded-lg ${
                                  reply.is_admin
                                    ? 'bg-emerald-500/10 border border-emerald-500/30'
                                    : 'bg-gray-700/50'
                                }`}
                              >
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-xs font-medium text-gray-400">
                                    {reply.is_admin ? 'Admin' : 'You'}
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

                        {feedback.status !== 'resolved' && (
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={replyMessage}
                              onChange={(e) => setReplyMessage(e.target.value)}
                              placeholder="Add a reply..."
                              className="flex-1 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm placeholder-gray-400 focus:outline-none focus:border-emerald-500"
                            />
                            <button
                              onClick={() => handleAddReply(feedback.id)}
                              disabled={!replyMessage.trim() || isSubmittingReply}
                              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <Send className="w-4 h-4" />
                            </button>
                          </div>
                        )}

                        {feedback.status === 'resolved' && feedback.resolved_at && (
                          <div className="flex items-center gap-2 text-sm text-emerald-400">
                            <CheckCircle2 className="w-4 h-4" />
                            Resolved on {new Date(feedback.resolved_at).toLocaleDateString()}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
