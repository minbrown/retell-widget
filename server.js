import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import "dotenv/config";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, "public")));

// --- HELPERS ---
async function fetchWithRetry(url, options, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, options);
      return res;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 1000));
    }
  }
}

// --- ENDPOINTS ---

/**
 * 1. Create Web Call
 * Handles Contact Upsert, Firecrawl Scrape, and Retell Call Initiation
 */
app.post("/create-web-call", async (req, res) => {
  const { firstName, lastName, phone, email, businessName, website } = req.body;
  console.log(`\n🚀 NEW CALL REQUEST: ${businessName} (${website})`);

  try {
    // A. Upsert GHL Contact (Simplified for speed)
    let ghlContactId = null;
    const GHL_HEADERS = {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      "Content-Type": "application/json",
      Version: "2021-07-28",
    };

    const searchUrl = `https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${process.env.GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`;
    const searchRes = await fetch(searchUrl, { headers: GHL_HEADERS });
    const searchData = searchRes.ok ? await searchRes.json() : null;

    if (searchData?.contact?.id) {
      ghlContactId = searchData.contact.id;
      console.log(`   ✅ Existing GHL Contact: ${ghlContactId}`);
    } else {
      const createRes = await fetch("https://services.leadconnectorhq.com/contacts/", {
        method: "POST",
        headers: GHL_HEADERS,
        body: JSON.stringify({
          firstName, lastName, email, phone,
          companyName: businessName, website,
          locationId: process.env.GHL_LOCATION_ID,
          tags: ["Universal Agent Lead"]
        })
      });
      const createData = createRes.ok ? await createRes.json() : null;
      ghlContactId = createData?.contact?.id;
      console.log(`   ✅ New GHL Contact Created: ${ghlContactId}`);
    }

    // B. Smart Scrape (Firecrawl)
    let scrapedContext = "General professional assistance.";
    if (website) {
      console.log(`   🔎 Scraping ${website}...`);
      try {
        const scrapeRes = await fetch("https://api.firecrawl.dev/v1/scrape", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            url: website,
            formats: ["json"],
            onlyMainContent: true,
            jsonOptions: {
              schema: {
                type: "object",
                properties: {
                  about: { type: "string" },
                  services: { type: "string" },
                  hours: { type: "string" }
                }
              }
            }
          })
        });
        const d = (await scrapeRes.json())?.data?.json;
        if (d) {
          scrapedContext = `About: ${d.about}\nServices: ${d.services}\nHours: ${d.hours}`;
        }
      } catch (e) { console.log("   ⚠️ Scrape failed, using fallback."); }
    }

    // C. Initiate Retell Call
    const retellRes = await fetch("https://api.retellai.com/v2/create-web-call", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.RETELL_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agent_id: process.env.RETELL_AGENT_ID,
        metadata: { ghl_contact_id: ghlContactId, phone, website },
        retell_llm_dynamic_variables: {
          "contact.first_name": firstName,
          "contact.company_name": businessName,
          "contact.business_context": scrapedContext
        }
      })
    });

    const retellData = await retellRes.json();
    return res.json({ access_token: retellData.access_token });

  } catch (err) {
    console.error("❌ Fatal Error:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 2. Check Availability
 */
app.post("/check-availability", async (req, res) => {
  console.log("\n🔍 Availability Check Initiated...");
  const GHL_HEADERS = {
    Authorization: `Bearer ${process.env.GHL_API_KEY}`,
    Version: "2021-07-28"
  };

  // Window: Now to 14 days from now, using ISO format for GHL v2
  const now = new Date();
  const startDate = now.toISOString();
  const end = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000));
  const endDate = end.toISOString();

  const url = `https://services.leadconnectorhq.com/calendars/free-slots?calendarId=${process.env.GHL_CALENDAR_ID}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;

  console.log(`   📡 Querying GHL (ISO): ${url}`);

  try {
    const response = await fetch(url, { headers: GHL_HEADERS });
    const data = await response.json();

    if (!response.ok) {
      console.error("   ❌ GHL API Error:", JSON.stringify(data));
      return res.status(response.status).json({ error: "GHL Sync Error", details: data });
    }

    // Flatten slots (keys are dates)
    let slots = [];
    if (data && typeof data === 'object') {
      Object.keys(data).forEach(day => {
        if (data[day] && Array.isArray(data[day].slots)) {
          data[day].slots.forEach(s => slots.push(s));
        }
      });
    }

    console.log(`   ✅ Found ${slots.length} total slots.`);
    if (slots.length === 0) {
      console.log("   ⚠️ GHL returned 0 slots. Raw Response:", JSON.stringify(data));
    }

    return res.json({
      available_slots: slots.slice(0, 12),
      message: slots.length > 0 ? "Success" : "No slots found. Check staff availability in GHL."
    });
  } catch (e) {
    console.error("   ❌ Server Error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 3. Book Appointment
 */
app.post("/book-appointment", async (req, res) => {
  const { args } = req.body;
  const { date_time, email, first_name } = args || {};
  console.log(`📅 Booking for ${first_name}...`);

  const GHL_HEADERS = { Authorization: `Bearer ${process.env.GHL_API_KEY}`, "Content-Type": "application/json", Version: "2021-07-28" };

  // Calculate end time
  const start = new Date(date_time);
  const end = new Date(start.getTime() + 30 * 60000);

  try {
    // Find contact ID by email first
    const searchRes = await fetch(`https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=${process.env.GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`, { headers: GHL_HEADERS });
    const contactId = (await searchRes.json())?.contact?.id;

    const bookRes = await fetch("https://services.leadconnectorhq.com/calendars/events/", {
      method: "POST",
      headers: GHL_HEADERS,
      body: JSON.stringify({
        calendarId: process.env.GHL_CALENDAR_ID,
        locationId: process.env.GHL_LOCATION_ID,
        contactId,
        startTime: date_time,
        endTime: end.toISOString(),
        title: `Universal Appt: ${first_name}`
      })
    });

    if (bookRes.ok) return res.json({ status: "success", message: "Confirmed!" });
    return res.status(400).json({ error: "Booking failed" });
  } catch (e) {
    res.status(500).json({ error: "Server error" });
  }
});

/**
 * 4. Post-Call Webhook
 */
app.post("/retell-post-call", async (req, res) => {
  const { event, call } = req.body;
  if (event !== "call_analyzed") return res.sendStatus(200);

  console.log(`🏁 Call Ended: ${call.call_id}`);
  const ghlId = call.metadata?.ghl_contact_id;
  const summary = call.call_analysis?.call_summary;

  if (ghlId && summary) {
    const GHL_HEADERS = { Authorization: `Bearer ${process.env.GHL_API_KEY}`, "Content-Type": "application/json", Version: "2021-07-28" };
    await fetch(`https://services.leadconnectorhq.com/contacts/${ghlId}/notes`, {
      method: "POST",
      headers: GHL_HEADERS,
      body: JSON.stringify({ body: `📞 Call Summary: ${summary}\nRecording: ${call.recording_url}` })
    });
  }
  res.sendStatus(200);
});

app.listen(PORT, () => console.log(`🌍 Universal Agent Server: http://localhost:${PORT}`));
