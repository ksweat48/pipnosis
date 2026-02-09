import { supabase } from '@/lib/supabase';

export interface ChatMessage {
  id: string;
  userId: string;
  displayName: string;
  messageType: 'text' | 'image' | 'system';
  content: string;
  membershipTier: number;
  membershipBadge: Record<string, unknown>;
  reactionCount: number;
  isDeleted: boolean;
  createdAt: string;
}

export interface ChatReaction {
  id: string;
  messageId: string;
  userId: string;
  emoji: string;
}

const PAGE_SIZE = 50;

class ClubChatService {
  private realtimeChannel: ReturnType<typeof supabase.channel> | null = null;

  async getMessages(beforeDate?: string): Promise<ChatMessage[]> {
    let query = supabase
      .from('club_chat_messages')
      .select('*')
      .eq('is_deleted', false)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE);

    if (beforeDate) {
      query = query.lt('created_at', beforeDate);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[ClubChat] Error fetching messages:', error);
      return [];
    }

    return (data || []).map(this.mapMessage).reverse();
  }

  async sendMessage(
    userId: string,
    content: string,
    displayName: string,
    membershipTier: number,
    membershipBadge: Record<string, unknown> = {}
  ): Promise<{ success: boolean; error?: string }> {
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 2000) {
      return { success: false, error: 'Message must be 1-2000 characters' };
    }

    const { error } = await supabase.from('club_chat_messages').insert({
      user_id: userId,
      display_name: displayName,
      message_type: 'text',
      content: trimmed,
      membership_tier: membershipTier,
      membership_badge: membershipBadge,
    });

    if (error) {
      console.error('[ClubChat] Error sending message:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  async deleteMessage(messageId: string, userId: string): Promise<boolean> {
    const { error } = await supabase
      .from('club_chat_messages')
      .update({
        is_deleted: true,
        deleted_at: new Date().toISOString(),
        deleted_by: userId,
        deletion_reason: 'user_deleted',
      })
      .eq('id', messageId)
      .eq('user_id', userId);

    if (error) {
      console.error('[ClubChat] Error deleting message:', error);
      return false;
    }
    return true;
  }

  async getReactionsForMessages(messageIds: string[]): Promise<Map<string, ChatReaction[]>> {
    if (messageIds.length === 0) return new Map();

    const { data, error } = await supabase
      .from('club_chat_reactions')
      .select('*')
      .in('message_id', messageIds);

    if (error) {
      console.error('[ClubChat] Error fetching reactions:', error);
      return new Map();
    }

    const map = new Map<string, ChatReaction[]>();
    for (const r of data || []) {
      const list = map.get(r.message_id) || [];
      list.push({ id: r.id, messageId: r.message_id, userId: r.user_id, emoji: r.emoji });
      map.set(r.message_id, list);
    }
    return map;
  }

  async toggleReaction(messageId: string, userId: string, emoji: string): Promise<boolean> {
    const { data: existing } = await supabase
      .from('club_chat_reactions')
      .select('id')
      .eq('message_id', messageId)
      .eq('user_id', userId)
      .eq('emoji', emoji)
      .maybeSingle();

    if (existing) {
      const { error } = await supabase
        .from('club_chat_reactions')
        .delete()
        .eq('id', existing.id);
      if (error) {
        console.error('[ClubChat] Error removing reaction:', error);
        return false;
      }
    } else {
      const { error } = await supabase.from('club_chat_reactions').insert({
        message_id: messageId,
        user_id: userId,
        emoji,
      });
      if (error) {
        console.error('[ClubChat] Error adding reaction:', error);
        return false;
      }
    }

    return true;
  }

  subscribeToMessages(onNewMessage: (msg: ChatMessage) => void): () => void {
    this.realtimeChannel = supabase
      .channel('club-chat-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'club_chat_messages',
        },
        (payload) => {
          const msg = this.mapMessage(payload.new);
          onNewMessage(msg);
        }
      )
      .subscribe();

    return () => {
      if (this.realtimeChannel) {
        supabase.removeChannel(this.realtimeChannel);
        this.realtimeChannel = null;
      }
    };
  }

  private mapMessage(data: any): ChatMessage {
    return {
      id: data.id,
      userId: data.user_id,
      displayName: data.display_name || 'Member',
      messageType: data.message_type || 'text',
      content: data.content,
      membershipTier: data.membership_tier || 1,
      membershipBadge: data.membership_badge || {},
      reactionCount: data.reaction_count || 0,
      isDeleted: data.is_deleted || false,
      createdAt: data.created_at,
    };
  }
}

export const clubChatService = new ClubChatService();
