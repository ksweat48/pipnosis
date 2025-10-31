import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EmailPayload {
  userId: string;
  notificationId: string;
  sessionId: string;
  emailType: 'trade_signal' | 'goal_progress' | 'goal_completion' | 'session_start' | 'alert';
  data: any;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const payload: EmailPayload = await req.json();

    const { data: userSettings } = await supabase
      .rpc('get_user_email_settings', { p_user_id: payload.userId })
      .single();

    if (!userSettings || !userSettings.notifications_enabled) {
      return new Response(
        JSON.stringify({ success: false, reason: 'Email notifications disabled' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const canSendEmail = await supabase
      .rpc('check_email_rate_limit', {
        p_user_id: payload.userId,
        p_hours: 1,
        p_max_emails: 5
      });

    if (!canSendEmail.data) {
      return new Response(
        JSON.stringify({ success: false, reason: 'Rate limit exceeded' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const preferences = userSettings.preferences || {};
    if (payload.emailType === 'trade_signal') {
      if (!preferences.trade_signals) {
        return new Response(
          JSON.stringify({ success: false, reason: 'Trade signal emails disabled' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (preferences.high_confidence_only && payload.data.confidence < (preferences.min_confidence || 75)) {
        return new Response(
          JSON.stringify({ success: false, reason: 'Confidence below threshold' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    const { subject, htmlBody } = generateEmailContent(payload.emailType, payload.data, userSettings.email);

    console.log('Email would be sent:', {
      to: userSettings.email,
      subject,
      type: payload.emailType,
    });

    await supabase.from('email_notification_log').insert({
      user_id: payload.userId,
      goal_session_id: payload.sessionId,
      notification_id: payload.notificationId,
      email_type: payload.emailType,
      recipient_email: userSettings.email,
      subject,
      sent_at: new Date().toISOString(),
      delivery_status: 'sent',
      metadata: { payload: payload.data },
    });

    await supabase
      .from('goal_notifications')
      .update({
        email_sent: true,
        email_sent_at: new Date().toISOString(),
        email_status: 'sent',
      })
      .eq('id', payload.notificationId);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Email notification processed',
        recipient: userSettings.email,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in send-goal-email:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

function generateEmailContent(
  emailType: string,
  data: any,
  recipientEmail: string
): { subject: string; htmlBody: string } {
  let subject = '';
  let htmlBody = '';

  if (emailType === 'trade_signal') {
    subject = `High-Confidence Trade Signal: ${data.symbol || 'Market Opportunity'}`;
    htmlBody = `
<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #1a1a1a; color: #ffffff;">
  <div style="background: linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%); padding: 30px; border-radius: 10px; text-align: center; margin-bottom: 20px;">
    <h1 style="margin: 0; font-size: 24px; font-weight: bold;">High-Confidence Trade Signal</h1>
    <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">A quality trading opportunity has been identified</p>
  </div>
  <div style="background-color: #2d2d2d; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
    <h2 style="color: #3b82f6; font-size: 20px; margin-top: 0;">${data.symbol}</h2>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-top: 15px;">
      <div><p style="color: #9ca3af; font-size: 12px; margin: 0;">Direction</p><p style="color: #ffffff; font-size: 16px; font-weight: bold; margin: 5px 0 0 0; text-transform: uppercase;">${data.direction}</p></div>
      <div><p style="color: #9ca3af; font-size: 12px; margin: 0;">Confidence</p><p style="color: #10b981; font-size: 16px; font-weight: bold; margin: 5px 0 0 0;">${data.confidence}%</p></div>
      <div><p style="color: #9ca3af; font-size: 12px; margin: 0;">Entry Price</p><p style="color: #ffffff; font-size: 16px; font-weight: bold; margin: 5px 0 0 0;">${data.entryPrice?.toFixed(5)}</p></div>
      <div><p style="color: #9ca3af; font-size: 12px; margin: 0;">Expected Profit</p><p style="color: #10b981; font-size: 16px; font-weight: bold; margin: 5px 0 0 0;">$${data.expectedProfit?.toFixed(2)}</p></div>
    </div>
  </div>
  <div style="background-color: #2d2d2d; padding: 20px; border-radius: 10px; margin-bottom: 20px;">
    <h3 style="color: #ffffff; font-size: 16px; margin-top: 0;">Setup Details</h3>
    <p style="color: #9ca3af; font-size: 14px; line-height: 1.6;">${data.reasoning}</p>
  </div>
  <div style="text-align: center; margin-top: 30px;"><a href="https://pipnosis.com/dashboard" style="display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #06b6d4 100%); color: white; text-decoration: none; padding: 15px 40px; border-radius: 8px; font-weight: bold; font-size: 16px;">View on Dashboard</a></div>
</div>`;
  }

  return { subject, htmlBody };
}
