import fetch from "node-fetch";
import "dotenv/config";

async function diagnose() {
    console.log("🔍 DIAGNOSING GHL WITH NEW KEY...");
    const GHL_HEADERS_BASE = {
        Authorization: `Bearer ${process.env.GHL_API_KEY}`,
        "Content-Type": "application/json"
    };

    // 1. Get Slot
    const slotUrl = `https://services.leadconnectorhq.com/calendars/${process.env.GHL_CALENDAR_ID}/free-slots?startDate=${Date.now()}&endDate=${Date.now() + 864000000}`;
    const slotsRes = await fetch(slotUrl, { headers: { ...GHL_HEADERS_BASE, Version: "2021-07-28" } });
    const slotsData = await slotsRes.json();
    let firstSlot = null;
    Object.keys(slotsData).forEach(day => { if (slotsData[day]?.slots?.length > 0 && !firstSlot) firstSlot = slotsData[day].slots[0]; });

    if (!firstSlot) return console.log("❌ No slots found.");
    console.log("✅ Found slot:", firstSlot);

    // 2. Create Contact
    const createRes = await fetch("https://services.leadconnectorhq.com/contacts/", {
        method: "POST",
        headers: { ...GHL_HEADERS_BASE, Version: "2021-07-28" },
        body: JSON.stringify({ firstName: "VerifiedTest", email: "verified_" + Date.now() + "@example.com", locationId: process.env.GHL_LOCATION_ID })
    });
    const contactData = await createRes.json();
    const contactId = contactData?.contact?.id;
    console.log("✅ Contact ID:", contactId);

    if (!contactId) return console.log("❌ Contact creation failed:", JSON.stringify(contactData));

    // 3. Verified Booking Endpoint
    const bookingUrl = "https://services.leadconnectorhq.com/calendars/events/appointments";
    const end = new Date(new Date(firstSlot).getTime() + 30 * 60000).toISOString();

    console.log("📡 Attempting booking at /calendars/events/appointments...");
    const bookRes = await fetch(bookingUrl, {
        method: "POST",
        headers: { ...GHL_HEADERS_BASE, Version: "2021-04-15" },
        body: JSON.stringify({
            calendarId: process.env.GHL_CALENDAR_ID,
            locationId: process.env.GHL_LOCATION_ID,
            contactId,
            startTime: firstSlot,
            endTime: end,
            title: "VERIFIED FINAL TEST",
            appointmentStatus: "confirmed",
            assignedUserId: "4aMJQN6dJQHbu031eZ7F",
            ignoreFreeSlotValidation: true
        })
    });

    const bookData = await bookRes.json();
    console.log("STATUS:", bookRes.status);
    console.log("RESPONSE:", JSON.stringify(bookData, null, 2));
}
diagnose();
