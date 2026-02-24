import fetch from "node-fetch";
import "dotenv/config";

async function test() {
    const res = await fetch("https://services.leadconnectorhq.com/appointments/", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${process.env.GHL_API_KEY}`,
            "Content-Type": "application/json",
            Version: "2021-07-28"
        },
        body: JSON.stringify({
            calendarId: process.env.GHL_CALENDAR_ID,
            locationId: process.env.GHL_LOCATION_ID,
            contactId: "Ap2OiyiIRvmdwP1EWndy", // From previous log
            startTime: "2026-02-24T13:30:00-05:00",
            title: "PIT TEST"
        })
    });
    console.log("STATUS:", res.status);
    console.log("BODY:", await res.json());
}
test();
