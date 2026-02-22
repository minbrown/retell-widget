// ─────────────────────────────────────────────────────────────────────────────
// server.js — Retell AI Voice Widget Backend
//
// Responsibilities:
//   1. Serve the frontend HTML from the /public directory
//   2. POST /create-web-call:
//      a. Upsert a GoHighLevel contact (search by phone → update or create)
//      b. Create a Retell web call  (server-side, key never sent to browser)
//      c. Return only the access_token to the frontend
// ─────────────────────────────────────────────────────────────────────────────

import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import "dotenv/config";

// Resolve __dirname for ESM (not available natively in ES modules)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(cors());                          // Allow cross-origin requests (dev)
app.use(express.json());                  // Parse JSON request bodies
app.use(express.static(join(__dirname, "public"))); // Serve frontend files

// ── Retry helper for transient network errors (socket hang up, etc.) ─────────
async function fetchWithRetry(url, options, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      console.error(`   ⚠️ Fetch attempt ${attempt}/${retries} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, attempt * 500)); // backoff: 500ms, 1s, 1.5s
    }
  }
}

// ── POST /create-web-call ─────────────────────────────────────────────────────
// Accepts: { firstName, lastName, phone, email }
// Returns: { access_token }
app.post("/create-web-call", async (req, res) => {
  const { firstName, lastName, phone, email } = req.body;

  // Validate required fields
  if (!firstName || !phone || !email) {
    return res.status(400).json({ error: "firstName, phone, and email are required." });
  }

  // ── Step 1: GoHighLevel Contact Upsert ────────────────────────────────────
  let ghlContactId = null;

  try {
    const GHL_HEADERS = {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    };

    // Normalize phone for search
    let normalizedPhone = phone.replace(/\D/g, "");
    if (normalizedPhone.length === 10) normalizedPhone = "1" + normalizedPhone;
    normalizedPhone = "+" + normalizedPhone;

    const searchUrl =
      `https://services.leadconnectorhq.com/contacts/search/duplicate?` +
      `locationId=${encodeURIComponent(process.env.GHL_LOCATION_ID)}&number=${encodeURIComponent(normalizedPhone)}`;

    const searchRes = await fetchWithRetry(searchUrl, { headers: GHL_HEADERS });
    const searchData = searchRes.ok ? await searchRes.json() : null;
    const existing = searchData?.contact ?? null;

    if (existing) {
      ghlContactId = existing.id;
      const updates = {};

      // Upsert: Overwrite if the new information is different from what's in GHL
      if (firstName && existing.firstName !== firstName) updates.firstName = firstName;
      if (lastName && existing.lastName !== lastName) updates.lastName = lastName;
      if (email && existing.email !== email) updates.email = email;

      if (Object.keys(updates).length > 0) {
        console.log(`   🔄 Updating existing GHL contact with new info:`, JSON.stringify(updates));
        await fetchWithRetry(
          `https://services.leadconnectorhq.com/contacts/${ghlContactId}`,
          { method: "PUT", headers: GHL_HEADERS, body: JSON.stringify(updates) }
        );
        console.log(`   ✅ GHL contact updated (id: ${ghlContactId})`);
      }
    } else {
      const createRes = await fetchWithRetry("https://services.leadconnectorhq.com/contacts/", {
        method: "POST",
        headers: GHL_HEADERS,
        body: JSON.stringify({
          firstName,
          lastName: lastName || "",
          email,
          phone,
          locationId: process.env.GHL_LOCATION_ID,
          source: "Retell Voice Widget",
        }),
      });
      const createData = createRes.ok ? await createRes.json() : null;
      ghlContactId = createData?.contact?.id;
      console.log(`   ✅ GHL contact created (id: ${ghlContactId})`);
    }
  } catch (err) {
    console.error("   ❌ GHL upsert error:", err.message);
  }

  // ── Step 2: Create Retell Web Call ─────────────────────────────────────────
  try {
    const retellRes = await fetch("https://api.retellai.com/v2/create-web-call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: process.env.RETELL_AGENT_ID,
        // Pass GHL ID in metadata so we get it back in the webhook!
        metadata: { firstName, lastName, phone, email, ghl_contact_id: ghlContactId },
        retell_llm_dynamic_variables: {
          "contact.first_name": firstName,
          "contact.last_name": lastName || "",
          "contact.email": email,
          "contact.phone": phone,
        },
      }),
    });

    if (!retellRes.ok) {
      const retellError = await retellRes.text();
      console.error("Retell API error:", retellError);
      return res.status(retellRes.status).json({ error: "Failed to create Retell web call." });
    }

    const retellData = await retellRes.json();
    return res.json({ access_token: retellData.access_token });

  } catch (err) {
    console.error("Retell fetch error:", err.message);
    return res.status(500).json({ error: "Server error creating voice call." });
  }
});

// ── POST /retell-post-call ───────────────────────────────────────────────────
// Receives Retell post-call webhooks (call_ended + call_analyzed events).
// Only processes "call_analyzed" events, which contain the AI-generated
// call summary, sentiment, outcome, and recording URL.
// Searches for the GHL contact by phone, then adds a note + tag.
app.post("/retell-post-call", async (req, res) => {
  const payload = req.body;
  const event = payload?.event || payload?.event_type;

  console.log(`\n📩 Retell webhook received: event=${event}`);

  // ── Only process call_analyzed events ──────────────────────────────────────
  if (event !== "call_analyzed") {
    console.log(`   ⏭️ Skipping "${event}" (waiting for analysis...)`);
    return res.status(200).json({ received: true, skipped: true });
  }

  console.log(`   🚀 Processing Post-Call Analysis for call: ${payload.call?.call_id}`);

  // ── Extract data from the webhook payload ─────────────────────────────────
  const call = payload.call || {};
  const analysis = call.call_analysis || {};
  const custom = analysis.custom_analysis_data || {};
  const dynamicVars = call.retell_llm_dynamic_variables || {};
  const metadata = call.metadata || {};

  // ── Debug logging ─────────────────────────────────────────────────────────
  console.log("   📦 Metadata:", JSON.stringify(metadata));
  if (call.call_analysis) {
    console.log("   📦 custom_analysis_data:", JSON.stringify(custom));
  }

  const contactPhone = dynamicVars["contact.phone"] || call.from_number || metadata.phone || "";
  const contactName = dynamicVars["contact.first_name"] || metadata.firstName || "";
  const ghlContactIdFromMetadata = metadata.ghl_contact_id;

  // ── Extract fields ────────────────────────────────────────────────────────
  const callSummary =
    custom["Call Summary"] || custom["call_summary"] || custom["detailed_call_summary"] ||
    analysis.call_summary || "No summary available";
  const userSentiment =
    custom["User Sentiment"] || custom["user_sentiment"] ||
    analysis.user_sentiment || "Unknown";
  const callSuccessful =
    custom["Call Successful"] ?? custom["call_successful"] ??
    analysis.call_successful ?? "Unknown";
  const callOutcome =
    custom["call_outcome"] || custom["Call Outcome"] || custom["Outcome"] || "Unknown";
  const recordingUrl =
    custom["call_recording_url"] || call.recording_url || "No recording";

  console.log(`   📞 Contact: ${contactName} (${contactPhone})`);
  console.log(`   ️ Recording: ${recordingUrl}`);

  // ── Link to GHL Contact ───────────────────────────────────────────────────
  try {
    const GHL_HEADERS = {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    };

    let targetContactId = ghlContactIdFromMetadata;

    // Fallback to phone search if ID is missing
    if (!targetContactId && contactPhone) {
      console.log("   ⚠️ No GHL ID in metadata, falling back to phone search...");
      let normalizedPhone = contactPhone.replace(/\D/g, "");
      if (normalizedPhone.length === 10) normalizedPhone = "1" + normalizedPhone;
      normalizedPhone = "+" + normalizedPhone;

      const searchUrl =
        `https://services.leadconnectorhq.com/contacts/search/duplicate?` +
        `locationId=${encodeURIComponent(process.env.GHL_LOCATION_ID)}&number=${encodeURIComponent(normalizedPhone)}`;

      const searchRes = await fetchWithRetry(searchUrl, { headers: GHL_HEADERS });
      const searchData = searchRes.ok ? await searchRes.json() : null;
      targetContactId = searchData?.contact?.id;
    }

    if (!targetContactId) {
      console.error(`   ❌ Could not identify GHL contact (Phone: ${contactPhone})`);
      return res.status(200).json({ received: true, error: "Contact not found" });
    }

    console.log(`   ✅ Target GHL contact ID: ${targetContactId}`);

    // ── Add call note ─────────────────────────────────────────────────────
    const noteBody =
      `📞 Retell AI Call Summary\n\n` +
      `Outcome: ${callOutcome}\n` +
      `Sentiment: ${userSentiment}\n` +
      `Call Successful: ${callSuccessful}\n\n` +
      `Summary:\n${callSummary}\n\n` +
      `Recording: ${recordingUrl}`;

    const noteRes = await fetchWithRetry(
      `https://services.leadconnectorhq.com/contacts/${targetContactId}/notes`,
      {
        method: "POST",
        headers: GHL_HEADERS,
        body: JSON.stringify({ body: noteBody }),
      }
    );

    if (noteRes.ok) {
      console.log("   ✅ Call note added to GHL.");
    } else {
      console.error("   ❌ Failed to add note:", await noteRes.text());
    }

    // ── Update GHL Contact (Identity + Custom Fields) ─────────────────────
    // This populates the main fields AND the sidebar fields.
    // 'sentiment', 'call_outcome' etc. must match your GHL Field Keys.

    // We try to pull any identity info that might have been gathered during the call
    const updatedFirstName = custom["first_name"] || custom["First Name"];
    const updatedLastName = custom["last_name"] || custom["Last Name"];
    const updatedEmail = custom["email"] || custom["Email"];

    const contactUpdateBody = {
      customFields: [
        { key: 'contact.sentiment', value: userSentiment },
        { key: 'contact.call_outcome', value: callOutcome },
        { key: 'contact.call_summary', value: callSummary },
        { key: 'contact.call_successful', value: callSuccessful.toString() },
        { key: 'contact.call_recording_url', value: recordingUrl }
      ]
    };

    // If Retell analysis found a new name or email, add to update
    if (updatedFirstName) contactUpdateBody.firstName = updatedFirstName;
    if (updatedLastName) contactUpdateBody.lastName = updatedLastName;
    if (updatedEmail) contactUpdateBody.email = updatedEmail;

    console.log(`   🔄 Syncing latest call data to GHL contact...`);
    const updateRes = await fetchWithRetry(
      `https://services.leadconnectorhq.com/contacts/${targetContactId}`,
      {
        method: "PUT",
        headers: GHL_HEADERS,
        body: JSON.stringify(contactUpdateBody),
      }
    );

    if (updateRes.ok) {
      console.log("   ✅ GHL contact record updated with latest analysis.");
    } else {
      console.log("   ⚠️ Contact update warning:", await updateRes.text());
    }

    // ── Add tag ───────────────────────────────────────────────────────────
    await fetchWithRetry(
      `https://services.leadconnectorhq.com/contacts/${targetContactId}/tags`,
      {
        method: "POST",
        headers: GHL_HEADERS,
        body: JSON.stringify({ tags: ["Retell Call Completed"] }),
      }
    );
    console.log("   ✅ Tag 'Retell Call Completed' added.");

    return res.status(200).json({ received: true, success: true });

  } catch (err) {
    console.error("   ❌ Post-call processing error:", err.message);
    return res.status(200).json({ received: true, error: err.message });
  }
});

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Retell Voice Widget server running at http://localhost:${PORT}`);
});
