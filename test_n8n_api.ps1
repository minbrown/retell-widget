$n8nUrl = "https://app.echovoicelabs.co/api/v1"
$apiKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxOTkyNjE1ZC04YTJlLTRlMTUtYjdkYi1iY2ZlMmM0Nzc5NGYiLCJpc3MiOiJuOG4iLCJhdWQiOiJtY3Atc2VydmVyLWFwaSIsImp0aSI6ImM2ZjEyYTRiLTJjZGEtNGIyZi1hNDY4LTVkNTM0YWZlYWRjOSIsImlhdCI6MTc2OTYyNzk4Nn0.g43V_A93myWl9KzbyQX3rqZ_dq7ihvPRrtO2w5rD1_U"

$headers = @{
    "X-N8N-API-KEY" = $apiKey
    "Content-Type"  = "application/json"
}

Write-Host "Testing N8N API connectivity..."
try {
    $r = Invoke-RestMethod -Uri "$n8nUrl/workflows" -Method GET -Headers $headers
    Write-Host "SUCCESS - Workflows count: $($r.count)"
    Write-Host ($r | ConvertTo-Json -Depth 2)
}
catch {
    Write-Host "GET workflows ERROR: $($_.Exception.Message)"
    Write-Host "Status: $($_.Exception.Response.StatusCode)"
    $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
    $reader.BaseStream.Position = 0
    $reader.DiscardBufferedData()
    $responseBody = $reader.ReadToEnd()
    Write-Host "Response body: $responseBody"
}
