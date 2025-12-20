import { createClient } from 'npm:@supabase/supabase-js@2.53.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Client-Info, Apikey',
};

interface FeedbackNotification {
  feedbackId: string;
  userEmail: string;
  feedbackType: string;
  subject: string;
  messagePreview: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { feedbackId, userEmail, feedbackType, subject, messagePreview }: FeedbackNotification = await req.json();

    // Get all admin users
    const { data: adminUsers, error: adminError } = await supabaseClient
      .from('user_profiles')
      .select('id, email')
      .eq('is_admin', true);

    if (adminError) {
      console.error('Error fetching admin users:', adminError);
      return new Response(
        JSON.stringify({ error: 'Failed to fetch admin users' }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    if (!adminUsers || adminUsers.length === 0) {
      console.log('No admin users found');
      return new Response(
        JSON.stringify({ message: 'No admin users to notify' }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    // Create in-app notifications for each admin
    const notifications = adminUsers.map(admin => ({
      user_id: admin.id,
      type: 'feedback_new',
      title: `New ${feedbackType} from ${userEmail}`,
      message: `${subject}\n\n${messagePreview}`,
      metadata: {
        feedbackId,
        userEmail,
        feedbackType,
        subject
      },
      priority: 'normal'
    }));

    const { error: notificationError } = await supabaseClient
      .from('notifications')
      .insert(notifications);

    if (notificationError) {
      console.error('Error creating notifications:', notificationError);
    }

    console.log(`Created notifications for ${adminUsers.length} admins`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Notified ${adminUsers.length} admin(s)`,
        adminCount: adminUsers.length
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in send-feedback-notification:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'Internal server error' }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});