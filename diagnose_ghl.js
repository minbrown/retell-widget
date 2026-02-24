import fetch from "node-fetch";
import "dotenv/config";

async function diagnose() {
    console.log("🔍 DIAGNOSING GHL CONNECTION...");
    console.log("--------------------------------");
    console.log("API KEY:", process.env.GHL_API_KEY ? "Present (Starts with " + process.env.GHL_API_KEY.substring(0, 10) + "...)" : "MISSING");
    console.log("CALENDAR ID:", process.env.GHL_CALENDAR_ID);
    console.log("LOCATION ID:", process.env.GHL_LOCATION_ID);
    console.log("--------------------------------\n");

    const GHL_HEADERS = {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        Version: "2021-07-28"
    };

    const now = new Date();
    const startDate = now.toISOString();
    const future = new Date(now.getTime() + (14 * 24 * 60 * 60 * 1000));
    const endDate = future.toISOString();

    const url = `https://services.leadconnectorhq.com/calendars/${process.env.GHL_CALENDAR_ID}/free-slots?startDate=${now.getTime()}&endDate=${future.getTime()}`;

    console.log("📡 Attempting to fetch slots...");
    try {
        const res = await fetch(url, { headers: GHL_HEADERS });
        const data = await res.json();

        if (res.ok) {
            console.log("✅ SUCCESS: GHL API Responded.");
            const slotsCount = Object.keys(data).reduce((acc, k) => acc + (data[k].slots?.length || 0), 0);
            console.log(`📊 FOUND ${slotsCount} SLOTS.`);
            if (slotsCount === 0) {
                console.log("⚠️ WARNING: The API returned 0 slots. This means your API key is working, but the calendar itself is reporting as empty.");
                console.log("JSON RESPONSE:", JSON.stringify(data, null, 2));
            }
        } else {
            console.log("❌ ERROR: API request failed.");
            console.log("STATUS:", res.status);
            console.log("RESPONSE:", JSON.stringify(data, null, 2));
        }
    } catch (err) {
        console.log("❌ CRITICAL ERROR during fetch:", err.message);
    }
}

diagnose();
