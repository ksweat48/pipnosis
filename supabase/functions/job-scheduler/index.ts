import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'npm:@supabase/supabase-js@2.53.0';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    console.log('🕐 Job scheduler running at', new Date().toISOString());

    // Check database resource usage first
    const { data: resourceUsage, error: resourceError } = await supabase
      .rpc('check_database_resource_usage');

    if (resourceError) {
      console.error('Error checking resources:', resourceError);
    } else {
      console.log('📊 Resource usage:', resourceUsage);

      // If resources are critically high, skip this run
      if (resourceUsage.status === 'critical') {
        console.warn('⚠️ Database resources critical, skipping job processing');
        return new Response(
          JSON.stringify({
            message: 'Skipped due to critical resource usage',
            resourceUsage,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Count pending jobs
    const { count, error: countError } = await supabase
      .from('job_queue')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending')
      .lte('scheduled_for', new Date().toISOString());

    if (countError) {
      console.error('Error counting jobs:', countError);
      throw countError;
    }

    console.log(`📋 Found ${count || 0} pending jobs`);

    if (!count || count === 0) {
      return new Response(
        JSON.stringify({
          message: 'No pending jobs',
          timestamp: new Date().toISOString(),
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Trigger job processor
    const processorUrl = `${supabaseUrl}/functions/v1/job-processor?action=process`;
    console.log('🚀 Triggering job processor...');

    const response = await fetch(processorUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Content-Type': 'application/json',
      },
    });

    const result = await response.json();
    console.log('✅ Job processor response:', result);

    return new Response(
      JSON.stringify({
        message: 'Job processing triggered',
        pendingJobs: count,
        processorResult: result,
        timestamp: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ Error in job scheduler:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
