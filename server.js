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
// Accepts: { firstName, lastName, phone, email, businessName, website }
// Returns: { access_token }
app.post("/create-web-call", async (req, res) => {
  const { firstName, lastName, phone, email, businessName, website } = req.body;

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
      if (businessName && existing.companyName !== businessName) updates.companyName = businessName;
      if (website && existing.website !== website) updates.website = website;

      if (Object.keys(updates).length > 0) {
        console.log(`   🔄 Updating existing GHL contact with new info:`, JSON.stringify(updates));
        await fetchWithRetry(
          `https://services.leadconnectorhq.com/contacts/${ghlContactId}`,
          { method: "PUT", headers: GHL_HEADERS, body: JSON.stringify(updates) }
        );
        console.log(`   ✅ GHL contact updated (id: ${ghlContactId})`);
      }

      // Always ensure the "Retell Widget Lead" tag is present to trigger any immediate workflows
      await fetchWithRetry(
        `https://services.leadconnectorhq.com/contacts/${ghlContactId}/tags`,
        {
          method: "POST",
          headers: GHL_HEADERS,
          body: JSON.stringify({ tags: ["Retell Widget Lead"] }),
        }
      );
      console.log(`   🏷️ Tag 'Retell Widget Lead' synced for contact ${ghlContactId}`);
    } else {
      const createRes = await fetchWithRetry("https://services.leadconnectorhq.com/contacts/", {
        method: "POST",
        headers: GHL_HEADERS,
        body: JSON.stringify({
          firstName,
          lastName: lastName || "",
          email,
          phone,
          companyName: businessName || "",
          website: website || "",
          locationId: process.env.GHL_LOCATION_ID,
          source: "Retell Voice Widget",
          tags: ["Retell Widget Lead"],
        }),
      });
      const createData = createRes.ok ? await createRes.json() : null;
      ghlContactId = createData?.contact?.id;
      console.log(`   ✅ GHL contact created (id: ${ghlContactId})`);
    }
  } catch (err) {
    console.error("   ❌ GHL upsert error:", err.message);
  }

  // ── Step 2: Auto-Scraper (Smart Multi-Page Extraction) ──────────────────
  let scrapedKnowledge = "";
  if (website) {
    console.log(`   🌐 Requesting Smart Scrape for: ${website}`);

    // Create a Promise that rejects after 15 seconds
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Scrape timeout")), 15000)
    );

    try {
      // Run the entire scrape process with a 15-second cap
      await Promise.race([
        (async () => {
          // 1. Identify high-value sub-pages
          let targetUrls = [website];
          try {
            const mapRes = await fetch("https://api.firecrawl.dev/v1/map", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
              },
              body: JSON.stringify({ url: website, search: "services pricing about team products", limit: 5 }),
            });

            if (mapRes.ok) {
              const mapData = await mapRes.json();
              (mapData.links || []).forEach(link => {
                if (!targetUrls.includes(link) && targetUrls.length < 3) targetUrls.push(link);
              });
            }
          } catch (e) { console.log("   ⚠️ Map skipped."); }

          // 2. Scrape in parallel
          console.log(`   🔎 Scraping ${targetUrls.length} pages...`);
          const scrapePromises = targetUrls.map(async (url) => {
            try {
              const res = await fetch("https://api.firecrawl.dev/v1/scrape", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
                },
                body: JSON.stringify({
                  url,
                  formats: ["json"],
                  onlyMainContent: true,
                  jsonOptions: {
                    schema: {
                      type: "object",
                      properties: {
                        services: { type: "string" },
                        hours: { type: "string" },
                        pricing: { type: "string" }
                      }
                    }
                  }
                }),
              });
              return res.ok ? await res.json() : null;
            } catch (e) { return null; }
          });

          const results = await Promise.all(scrapePromises);

          let mergedServices = [];
          let mergedHours = [];

          results.forEach(r => {
            const d = r?.data?.json;
            if (d?.services) mergedServices.push(d.services);
            if (d?.hours) mergedHours.push(d.hours);
          });

          scrapedKnowledge = `
            BUSINESS CONTEXT:
            Services: ${mergedServices.join("\n") || "Refer to website"}
            Hours: ${mergedHours.join(" | ") || "Refer to website"}
          `.trim();
        })(),
        timeoutPromise
      ]);
      console.log(`   ✅ Extraction complete.`);
    } catch (err) {
      console.error("   ⚠️ Scrape failed or timed out:", err.message);
    }
  }

  // Fallback if no website or scraping failed
  if (!scrapedKnowledge) {
    scrapedKnowledge = `
      CONTEXT: We are currently reviewing the website ${website || "provided"}. 
      Please greet the caller warmly and tell them we are specialized in luxury services. 
      If they ask for specifics, offer to have a human follow up.
    `.trim();
    console.log("   ℹ️ Using generic fallback context");
  }

  // ── Step 3: Create Retell Web Call ─────────────────────────────────────────
  try {
    console.log("   📜 Final Context being sent to Retell:");
    console.log("-----------------------------------------");
    console.log(scrapedKnowledge);
    console.log("-----------------------------------------");

    const retellRes = await fetch("https://api.retellai.com/v2/create-web-call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_id: process.env.RETELL_AGENT_ID,
        // Pass GHL ID in metadata so we get it back in the webhook!
        metadata: {
          firstName,
          lastName,
          phone,
          email,
          businessName,
          website,
          ghl_contact_id: ghlContactId
        },
        retell_llm_dynamic_variables: {
          "contact.first_name": firstName,
          "contact.last_name": lastName || "",
          "contact.email": email,
          "contact.phone": phone,
          "contact.company_name": businessName || "",
          "contact.website": website || "",
          "contact.business_context": scrapedKnowledge,
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
    const updatedBusinessName = custom["company_name"] || custom["business_name"] || custom["Business Name"];
    const updatedWebsite = custom["website"] || custom["Website"];

    const contactUpdateBody = {
      customFields: [
        { key: 'contact.sentiment', value: userSentiment },
        { key: 'contact.call_outcome', value: callOutcome },
        { key: 'contact.call_summary', value: callSummary },
        { key: 'contact.call_successful', value: callSuccessful.toString() },
        { key: 'contact.call_recording_url', value: recordingUrl }
      ]
    };

    // If Retell analysis found a new name, email, or business info, add to update
    if (updatedFirstName) contactUpdateBody.firstName = updatedFirstName;
    if (updatedLastName) contactUpdateBody.lastName = updatedLastName;
    if (updatedEmail) contactUpdateBody.email = updatedEmail;
    if (updatedBusinessName) contactUpdateBody.companyName = updatedBusinessName;
    if (updatedWebsite) contactUpdateBody.website = updatedWebsite;

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

    // ── Add tags ──────────────────────────────────────────────────────────
    const tagsToAdd = ["Retell Call Completed"];

    // Auto-trigger booking email if AI requested it in summary
    if (callSummary.includes("BOOKING_REQUESTED: YES")) {
      console.log("   📧 Booking link requested by AI! Adding trigger tag...");
      tagsToAdd.push("send-booking-link");
    }

    await fetchWithRetry(
      `https://services.leadconnectorhq.com/contacts/${targetContactId}/tags`,
      {
        method: "POST",
        headers: GHL_HEADERS,
        body: JSON.stringify({ tags: tagsToAdd }),
      }
    );
    console.log(`   ✅ GHL tags added: ${tagsToAdd.join(", ")}`);

    return res.status(200).json({ received: true, success: true });

  } catch (err) {
    console.error("   ❌ Post-call processing error:", err.message);
    return res.status(200).json({ received: true, error: err.message });
  }
});

// ── New: POST /book-appointment ──────────────────────────────────────────────
// This endpoint is called by Retell's "Functions" tool.
// It handles checking availability and creating appointments in GHL.
app.post("/book-appointment", async (req, res) => {
  const { args } = req.body; // Retell sends arguments in the 'args' object
  const { date_time, email, first_name } = args || {};

  console.log(`\n📅 Booking Request received for ${first_name} (${email}) at ${date_time}`);

  if (!date_time || !email) {
    return res.status(400).json({ error: "date_time and email are required for booking." });
  }

  try {
    const GHL_HEADERS = {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    };

    // 1. Find the contact ID by email (to ensure we link the appointment correctly)
    const searchUrl = `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${process.env.GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`;
    const searchRes = await fetchWithRetry(searchUrl, { headers: GHL_HEADERS });
    const searchData = searchRes.ok ? await searchRes.json() : null;
    const contactId = searchData?.contact?.id;

    if (!contactId) {
      console.log("   ⚠️ Contact not found for booking, creating a temporary one...");
      // Optional: You could create them here, but we usually have them from the start of the call
    }

    // 2. Create the appointment in GHL
    // Note: process.env.GHL_CALENDAR_ID must be set in your .env
    const bookingUrl = `https://services.leadconnectorhq.com/calendars/events/`;
    const bookingBody = {
      calendarId: process.env.GHL_CALENDAR_ID,
      locationId: process.env.GHL_LOCATION_ID,
      contactId: contactId,
      startTime: date_time, // Expected format: ISO 8601 (e.g., 2024-05-20T14:00:00Z)
      title: `MedSpa Appt: ${first_name || 'Patient'}`,
      appointmentStatus: "confirmed"
    };

    const bookingRes = await fetchWithRetry(bookingUrl, {
      method: "POST",
      headers: GHL_HEADERS,
      body: JSON.stringify(bookingBody)
    });

    if (bookingRes.ok) {
      console.log("   ✅ Appointment successfully booked in GHL!");
      return res.json({ status: "success", message: "Appointment confirmed. We look forward to seeing you!" });
    } else {
      const errorData = await bookingRes.text();
      console.error("   ❌ GHL Booking Error:", errorData);
      return res.status(500).json({ status: "error", message: "That time slot is no longer available. Could we try another time?" });
    }

  } catch (err) {
    console.error("   ❌ Internal Booking Error:", err.message);
    return res.status(500).json({ error: "Server error during booking." });
  }
});

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Retell Voice Widget server running at http://localhost:${PORT}`);
});
