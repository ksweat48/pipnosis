import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface AlertEmailPayload {
  alertType: string;
  severity: string;
  message: string;
  threshold: number;
  actualValue: number;
  metadata?: any;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const payload: AlertEmailPayload = await req.json();
    const adminEmail = Deno.env.get("ADMIN_EMAIL") || "admin@pipnosis.com";

    const subject = `[${payload.severity.toUpperCase()}] System Load Alert: ${payload.alertType}`;

    const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    .header { background: ${payload.severity === 'critical' ? '#dc2626' : payload.severity === 'warning' ? '#ea580c' : '#2563eb'};
              color: white; padding: 20px; border-radius: 8px 8px 0 0; }
    .content { background: #f9fafb; padding: 20px; border: 1px solid #e5e7eb; }
    .metric { background: white; padding: 15px; margin: 10px 0; border-radius: 4px; border-left: 4px solid ${
      payload.severity === 'critical' ? '#dc2626' : payload.severity === 'warning' ? '#ea580c' : '#2563eb'
    }; }
    .label { font-weight: bold; color: #6b7280; font-size: 12px; text-transform: uppercase; }
    .value { font-size: 24px; font-weight: bold; color: #111827; margin: 5px 0; }
    .footer { background: #111827; color: #9ca3af; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; font-size: 12px; }
    .button { display: inline-block; background: #059669; color: white; padding: 12px 24px;
              text-decoration: none; border-radius: 6px; margin: 10px 0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 style="margin: 0;">⚠️ System Load Alert</h1>
      <p style="margin: 10px 0 0 0; opacity: 0.9;">${payload.alertType.replace(/_/g, ' ').toUpperCase()}</p>
    </div>

    <div class="content">
      <h2 style="margin-top: 0;">Alert Details</h2>
      <p>${payload.message}</p>

      <div class="metric">
        <div class="label">Severity Level</div>
        <div class="value" style="color: ${
          payload.severity === 'critical' ? '#dc2626' : payload.severity === 'warning' ? '#ea580c' : '#2563eb'
        };">
          ${payload.severity.toUpperCase()}
        </div>
      </div>

      <div class="metric">
        <div class="label">Threshold Value</div>
        <div class="value">${payload.threshold}${payload.alertType.includes('usage') ? '%' : ''}</div>
      </div>

      <div class="metric">
        <div class="label">Actual Value</div>
        <div class="value">${payload.actualValue}${payload.alertType.includes('usage') ? '%' : ''}</div>
      </div>

      ${payload.metadata ? `
      <div class="metric">
        <div class="label">Additional Information</div>
        <div style="font-size: 14px; margin-top: 8px;">
          ${Object.entries(payload.metadata).map(([key, value]) =>
            `<div><strong>${key.replace(/_/g, ' ')}:</strong> ${value}</div>`
          ).join('')}
        </div>
      </div>
      ` : ''}

      <h3>Recommended Actions:</h3>
      <ul style="margin: 10px 0; padding-left: 20px;">
        ${payload.severity === 'critical' ? `
          <li>Immediately check the API Usage Monitor dashboard</li>
          <li>Consider temporarily pausing non-critical operations</li>
          <li>Verify MetaAPI service status</li>
          <li>Review recent system changes that may have increased load</li>
        ` : payload.severity === 'warning' ? `
          <li>Monitor the situation closely</li>
          <li>Review API Usage Monitor for trends</li>
          <li>Prepare to take action if load continues to increase</li>
        ` : `
          <li>Review API Usage Monitor when convenient</li>
          <li>No immediate action required</li>
        `}
      </ul>

      <div style="text-align: center; margin: 20px 0;">
        <a href="${Deno.env.get("APP_URL") || "https://pipnosis.com"}/admin" class="button">
          View Admin Dashboard
        </a>
      </div>
    </div>

    <div class="footer">
      <p style="margin: 5px 0;">Pipnosis Trading System - Automated Load Monitoring</p>
      <p style="margin: 5px 0;">This is an automated alert from your system monitoring service</p>
      <p style="margin: 5px 0; font-size: 10px;">Alert generated at ${new Date().toISOString()}</p>
    </div>
  </div>
</body>
</html>
    `;

    console.log(`[send-load-alert-email] Preparing to send alert email to ${adminEmail}`);
    console.log(`[send-load-alert-email] Alert type: ${payload.alertType}, Severity: ${payload.severity}`);

    const resendApiKey = Deno.env.get("RESEND_API_KEY");

    if (!resendApiKey) {
      console.warn("[send-load-alert-email] RESEND_API_KEY not configured, skipping email send");
      return new Response(
        JSON.stringify({
          success: false,
          error: "Email service not configured",
          details: "RESEND_API_KEY environment variable not set"
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const emailResponse = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Pipnosis Alerts <alerts@pipnosis.com>",
        to: [adminEmail],
        subject: subject,
        html: emailBody,
      }),
    });

    const emailResult = await emailResponse.json();

    if (!emailResponse.ok) {
      console.error("[send-load-alert-email] Failed to send email:", emailResult);
      return new Response(
        JSON.stringify({
          success: false,
          error: "Failed to send email",
          details: emailResult
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`[send-load-alert-email] Email sent successfully:`, emailResult);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Alert email sent successfully",
        emailId: emailResult.id
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );

  } catch (error) {
    console.error("[send-load-alert-email] Error:", error);

    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
