/**
 * Fires an event to the self-hosted n8n instance so it can run automation
 * (e.g. send an email via WF-01/WF-02). Backend never waits on n8n's result
 * for the main request/response cycle - this is fire-and-forget so a slow
 * or down n8n server never blocks core app functionality.
 *
 * webhookPath example: "student-registered", "enrollment-created"
 */
const triggerN8n = async (webhookPath, payload) => {
  const baseUrl = process.env.N8N_WEBHOOK_BASE_URL;
  const apiKey = process.env.N8N_API_KEY;

  if (!baseUrl) {
    console.warn('N8N_WEBHOOK_BASE_URL not configured - skipping automation trigger:', webhookPath);
    return;
  }

  try {
    await fetch(`${baseUrl}/${webhookPath}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-n8n-api-key': apiKey || '',
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    // Automation failures should never break the core app flow - just log it
    console.error(`n8n trigger failed for ${webhookPath}:`, error.message);
  }
};

module.exports = triggerN8n;
