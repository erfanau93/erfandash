import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const tenantId = Deno.env.get("MICROSOFT_TENANT_ID");
    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID");
    const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET");
    const userEmail = Deno.env.get("OUTLOOK_USER_EMAIL");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;

    if (!tenantId || !clientId || !clientSecret || !userEmail) {
      return new Response(
        JSON.stringify({ 
          error: "Missing Microsoft Graph credentials",
          required: ["MICROSOFT_TENANT_ID", "MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "OUTLOOK_USER_EMAIL"],
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get access token
    console.log(`[Setup Webhook] Getting access token for tenant: ${tenantId}`);
    const tokenResponse = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      }
    );

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error(`[Setup Webhook] Token error: ${errorText}`);
      return new Response(
        JSON.stringify({ error: "Failed to get access token", details: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const tokenData = await tokenResponse.json();
    const token = tokenData.access_token;
    console.log(`[Setup Webhook] Got access token successfully`);

    const body = req.method === "POST" ? await req.json() : {};
    const action = body.action || "list";

    // Handle different actions
    if (req.method === "DELETE" || action === "delete") {
      const subscriptionId = body.subscription_id;
      if (!subscriptionId) {
        return new Response(
          JSON.stringify({ error: "subscription_id required for delete action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const deleteResponse = await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
        {
          method: "DELETE",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      return new Response(
        JSON.stringify({ 
          success: deleteResponse.ok, 
          status: deleteResponse.status,
        }),
        { status: deleteResponse.ok ? 200 : deleteResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "list" || req.method === "GET") {
      // List existing subscriptions
      console.log(`[Setup Webhook] Listing subscriptions`);
      const listResponse = await fetch(
        "https://graph.microsoft.com/v1.0/subscriptions",
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!listResponse.ok) {
        const errorText = await listResponse.text();
        console.error(`[Setup Webhook] List error: ${errorText}`);
        return new Response(
          JSON.stringify({ error: "Failed to list subscriptions", status: listResponse.status, details: errorText }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const subscriptions = await listResponse.json();
      console.log(`[Setup Webhook] Found ${subscriptions.value?.length || 0} subscriptions`);
      return new Response(
        JSON.stringify(subscriptions),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "create") {
      // Create a new subscription
      // Webhook URL for the outlook-webhook function
      const webhookUrl = `${supabaseUrl}/functions/v1/outlook-webhook`;
      
      // Subscription expires in 4230 minutes (maximum for mail messages)
      const expirationDateTime = new Date();
      expirationDateTime.setMinutes(expirationDateTime.getMinutes() + 4230);

      const subscriptionPayload = {
        changeType: "created",
        notificationUrl: webhookUrl,
        resource: `users/${userEmail}/messages`,
        expirationDateTime: expirationDateTime.toISOString(),
        clientState: "outlook-email-subscription",
      };

      console.log(`[Setup Webhook] Creating subscription:`, JSON.stringify(subscriptionPayload, null, 2));

      const createResponse = await fetch(
        "https://graph.microsoft.com/v1.0/subscriptions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(subscriptionPayload),
        }
      );

      const responseText = await createResponse.text();
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

      if (!createResponse.ok) {
        console.error(`[Setup Webhook] Failed to create subscription:`, responseText);
        return new Response(
          JSON.stringify({ 
            error: "Failed to create subscription", 
            status: createResponse.status,
            details: responseData,
            webhookUrl,
            subscriptionPayload,
            troubleshooting: {
              note: "Make sure the webhook endpoint is publicly accessible and returns the validationToken correctly.",
              checkPermissions: "Verify Azure AD app has Mail.Read and Mail.ReadBasic.All application permissions with admin consent.",
              checkWebhook: `Test webhook validation: GET ${webhookUrl}?validationToken=test123`,
            },
          }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log(`[Setup Webhook] Subscription created successfully:`, responseText);
      return new Response(
        JSON.stringify({
          success: true,
          subscription: responseData,
          expiresAt: expirationDateTime.toISOString(),
          webhookUrl,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (action === "renew") {
      const subscriptionId = body.subscription_id;
      if (!subscriptionId) {
        return new Response(
          JSON.stringify({ error: "subscription_id required for renew action" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Extend expiration by 4230 minutes
      const expirationDateTime = new Date();
      expirationDateTime.setMinutes(expirationDateTime.getMinutes() + 4230);

      console.log(`[Setup Webhook] Renewing subscription: ${subscriptionId}`);
      const renewResponse = await fetch(
        `https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            expirationDateTime: expirationDateTime.toISOString(),
          }),
        }
      );

      const responseText = await renewResponse.text();
      let responseData;
      try {
        responseData = JSON.parse(responseText);
      } catch {
        responseData = { raw: responseText };
      }

      if (!renewResponse.ok) {
        console.error(`[Setup Webhook] Failed to renew subscription:`, responseText);
      }

      return new Response(
        JSON.stringify({
          success: renewResponse.ok,
          subscription: responseData,
          newExpiration: expirationDateTime.toISOString(),
        }),
        { status: renewResponse.ok ? 200 : renewResponse.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ 
        error: "Invalid action", 
        validActions: ["list", "create", "delete", "renew"],
        usage: {
          list: "GET or POST with action: 'list'",
          create: "POST with action: 'create'",
          delete: "DELETE or POST with action: 'delete', subscription_id: '...'",
          renew: "POST with action: 'renew', subscription_id: '...'",
        },
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error(`[Setup Webhook] Error:`, error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error.message, stack: error.stack }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});













