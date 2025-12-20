import { supabase } from '../lib/supabase';
import { logger } from '../lib/logger';

export type FeedbackType = 'bug' | 'improvement' | 'feature_request' | 'general';
export type FeedbackStatus = 'new' | 'reviewing' | 'resolved';
export type FeedbackPriority = 'low' | 'medium' | 'high';

export interface UserFeedback {
  id: string;
  user_id: string;
  user_email: string;
  feedback_type: FeedbackType;
  subject: string;
  message: string;
  status: FeedbackStatus;
  priority: FeedbackPriority;
  admin_notes?: string;
  admin_user_id?: string;
  user_notified: boolean;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
}

export interface FeedbackReply {
  id: string;
  feedback_id: string;
  user_id: string;
  message: string;
  is_admin: boolean;
  created_at: string;
}

export interface FeedbackSubmission {
  feedback_type: FeedbackType;
  subject: string;
  message: string;
}

export interface FeedbackStats {
  total: number;
  new: number;
  reviewing: number;
  resolved: number;
}

class UserFeedbackService {
  async submitFeedback(submission: FeedbackSubmission): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        logger.error('Failed to get user for feedback submission', { error: userError });
        return { success: false, error: 'You must be logged in to submit feedback' };
      }

      const { error } = await supabase
        .from('user_feedback')
        .insert({
          user_id: user.id,
          user_email: user.email,
          feedback_type: submission.feedback_type,
          subject: submission.subject.trim(),
          message: submission.message.trim(),
          status: 'new',
          priority: 'medium',
          user_notified: false
        });

      if (error) {
        if (error.message.includes('Rate limit exceeded')) {
          return { success: false, error: 'You have reached the maximum of 10 feedback submissions per day. Please try again tomorrow.' };
        }
        logger.error('Failed to submit feedback', { error });
        return { success: false, error: 'Failed to submit feedback. Please try again.' };
      }

      logger.info('Feedback submitted successfully', {
        userId: user.id,
        type: submission.feedback_type
      });

      return { success: true };
    } catch (error) {
      logger.error('Error submitting feedback', { error });
      return { success: false, error: 'An unexpected error occurred' };
    }
  }

  async getUserFeedback(): Promise<UserFeedback[]> {
    try {
      const { data, error } = await supabase
        .from('user_feedback')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to fetch user feedback', { error });
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error fetching user feedback', { error });
      return [];
    }
  }

  async getAllFeedback(statusFilter?: FeedbackStatus, typeFilter?: FeedbackType): Promise<UserFeedback[]> {
    try {
      let query = supabase
        .from('user_feedback')
        .select('*');

      if (statusFilter) {
        query = query.eq('status', statusFilter);
      }

      if (typeFilter) {
        query = query.eq('feedback_type', typeFilter);
      }

      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to fetch all feedback', { error });
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error fetching all feedback', { error });
      return [];
    }
  }

  async getFeedbackStats(): Promise<FeedbackStats> {
    try {
      const { data, error } = await supabase
        .from('user_feedback')
        .select('status');

      if (error) {
        logger.error('Failed to fetch feedback stats', { error });
        return { total: 0, new: 0, reviewing: 0, resolved: 0 };
      }

      const stats: FeedbackStats = {
        total: data?.length || 0,
        new: data?.filter(f => f.status === 'new').length || 0,
        reviewing: data?.filter(f => f.status === 'reviewing').length || 0,
        resolved: data?.filter(f => f.status === 'resolved').length || 0
      };

      return stats;
    } catch (error) {
      logger.error('Error fetching feedback stats', { error });
      return { total: 0, new: 0, reviewing: 0, resolved: 0 };
    }
  }

  async updateFeedbackStatus(
    feedbackId: string,
    status: FeedbackStatus,
    adminNotes?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        return { success: false, error: 'Unauthorized' };
      }

      const updateData: any = {
        status,
        admin_user_id: user.id
      };

      if (adminNotes !== undefined) {
        updateData.admin_notes = adminNotes;
      }

      const { error } = await supabase
        .from('user_feedback')
        .update(updateData)
        .eq('id', feedbackId);

      if (error) {
        logger.error('Failed to update feedback status', { error, feedbackId });
        return { success: false, error: 'Failed to update status' };
      }

      logger.info('Feedback status updated', { feedbackId, status });
      return { success: true };
    } catch (error) {
      logger.error('Error updating feedback status', { error });
      return { success: false, error: 'An unexpected error occurred' };
    }
  }

  async updateFeedbackPriority(
    feedbackId: string,
    priority: FeedbackPriority
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { error } = await supabase
        .from('user_feedback')
        .update({ priority })
        .eq('id', feedbackId);

      if (error) {
        logger.error('Failed to update feedback priority', { error, feedbackId });
        return { success: false, error: 'Failed to update priority' };
      }

      logger.info('Feedback priority updated', { feedbackId, priority });
      return { success: true };
    } catch (error) {
      logger.error('Error updating feedback priority', { error });
      return { success: false, error: 'An unexpected error occurred' };
    }
  }

  async getFeedbackReplies(feedbackId: string): Promise<FeedbackReply[]> {
    try {
      const { data, error } = await supabase
        .from('user_feedback_replies')
        .select('*')
        .eq('feedback_id', feedbackId)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Failed to fetch feedback replies', { error, feedbackId });
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Error fetching feedback replies', { error });
      return [];
    }
  }

  async addReply(
    feedbackId: string,
    message: string,
    isAdmin: boolean = false
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        return { success: false, error: 'You must be logged in to reply' };
      }

      const { error } = await supabase
        .from('user_feedback_replies')
        .insert({
          feedback_id: feedbackId,
          user_id: user.id,
          message: message.trim(),
          is_admin: isAdmin
        });

      if (error) {
        logger.error('Failed to add reply', { error, feedbackId });
        return { success: false, error: 'Failed to add reply' };
      }

      logger.info('Reply added to feedback', { feedbackId, isAdmin });
      return { success: true };
    } catch (error) {
      logger.error('Error adding reply', { error });
      return { success: false, error: 'An unexpected error occurred' };
    }
  }

  async getNewFeedbackCount(): Promise<number> {
    try {
      const { count, error } = await supabase
        .from('user_feedback')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'new');

      if (error) {
        logger.error('Failed to get new feedback count', { error });
        return 0;
      }

      return count || 0;
    } catch (error) {
      logger.error('Error getting new feedback count', { error });
      return 0;
    }
  }

  subscribeToNewFeedback(callback: (feedback: UserFeedback) => void) {
    const channel = supabase
      .channel('new_feedback')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_feedback'
        },
        (payload) => {
          logger.info('New feedback received', { feedbackId: payload.new.id });
          callback(payload.new as UserFeedback);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  subscribeToFeedbackUpdates(feedbackId: string, callback: (feedback: UserFeedback) => void) {
    const channel = supabase
      .channel(`feedback_${feedbackId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'user_feedback',
          filter: `id=eq.${feedbackId}`
        },
        (payload) => {
          callback(payload.new as UserFeedback);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }

  subscribeToReplies(feedbackId: string, callback: (reply: FeedbackReply) => void) {
    const channel = supabase
      .channel(`replies_${feedbackId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'user_feedback_replies',
          filter: `feedback_id=eq.${feedbackId}`
        },
        (payload) => {
          callback(payload.new as FeedbackReply);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }
}

export const userFeedbackService = new UserFeedbackService();
