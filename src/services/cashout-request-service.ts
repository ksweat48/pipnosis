import { supabase } from '@/lib/supabase';

export interface CashoutRequest {
  id: string;
  userId: string;
  amountUsd: number;
  tokensDeducted: number;
  conversionRate: number;
  payoutMethod: 'ethereum' | 'bitcoin' | 'bank_transfer';
  walletAddress: string;
  status: 'pending' | 'under_review' | 'approved' | 'processing' | 'completed' | 'rejected' | 'cancelled';
  submittedAt: string;
  reviewedAt: string | null;
  completedAt: string | null;
  rejectionReason: string | null;
  blockchainTxHash: string | null;
}

export interface SubmitCashoutResult {
  success: boolean;
  requestId?: string;
  amountUsd?: number;
  tokensDeducted?: number;
  error?: string;
}

class CashoutRequestService {
  async submitRequest(
    userId: string,
    amountUsd: number,
    payoutMethod: string,
    walletAddress: string
  ): Promise<SubmitCashoutResult> {
    try {
      const { data, error } = await supabase.rpc('submit_cashout_request', {
        p_user_id: userId,
        p_amount_usd: amountUsd,
        p_payout_method: payoutMethod,
        p_wallet_address: walletAddress,
      });

      if (error) {
        return { success: false, error: error.message };
      }

      if (!data?.success) {
        return { success: false, error: data?.error || 'Unknown error' };
      }

      return {
        success: true,
        requestId: data.request_id,
        amountUsd: data.amount_usd,
        tokensDeducted: data.tokens_deducted,
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Internal error' };
    }
  }

  async getRequests(userId: string): Promise<CashoutRequest[]> {
    const { data, error } = await supabase
      .from('club_cashout_requests')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[CashoutRequestService] Error fetching requests:', error);
      return [];
    }

    return (data || []).map(this.mapFromDb);
  }

  async cancelRequest(requestId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    const { error } = await supabase
      .from('club_cashout_requests')
      .update({ status: 'cancelled' })
      .eq('id', requestId)
      .eq('user_id', userId)
      .eq('status', 'pending');

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  }

  private mapFromDb(row: any): CashoutRequest {
    return {
      id: row.id,
      userId: row.user_id,
      amountUsd: row.amount_usd,
      tokensDeducted: row.tokens_deducted,
      conversionRate: row.conversion_rate,
      payoutMethod: row.payout_method,
      walletAddress: row.wallet_address,
      status: row.status,
      submittedAt: row.submitted_at,
      reviewedAt: row.reviewed_at,
      completedAt: row.completed_at,
      rejectionReason: row.rejection_reason,
      blockchainTxHash: row.blockchain_tx_hash,
    };
  }
}

export const cashoutRequestService = new CashoutRequestService();
