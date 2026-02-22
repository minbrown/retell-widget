$n8nUrl = "https://app.echovoicelabs.co/api/v1"
$apiKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxOTkyNjE1ZC04YTJlLTRlMTUtYjdkYi1iY2ZlMmM0Nzc5NGYiLCJpc3MiOiJuOG4iLCJhdWQiOiJtY3Atc2VydmVyLWFwaSIsImp0aSI6ImM2ZjEyYTRiLTJjZGEtNGIyZi1hNDY4LTVkNTM0YWZlYWRjOSIsImlhdCI6MTc2OTYyNzk4Nn0.g43V_A93myWl9KzbyQX3rqZ_dq7ihvPRrtO2w5rD1_U"

$ghlApiKey = "pit-299d2f18-4b5d-44ad-98fc-efdd5e64999e"
$ghlLocationId = "bYPFrgmhPQl0sOOvrQeV"

$headers = @{
    "X-N8N-API-KEY" = $apiKey
    "Content-Type"  = "application/json"
}

$workflow = @{
    name = "Retell Post-Call -> GoHighLevel"
    nodes = @(
        @{
            id = "node_webhook"
            name = "Webhook"
            type = "n8n-nodes-base.webhook"
            typeVersion = 2
            position = @(0, 0)
            parameters = @{
                httpMethod = "POST"
                path = "retell-post-call"
                responseMode = "onReceived"
                options = @{}
            }
        },
        @{
            id = "node_set"
            name = "Extract Fields"
            type = "n8n-nodes-base.set"
            typeVersion = 3
            position = @(220, 0)
            parameters = @{
                mode = "manual"
                assignments = @{
                    assignments = @(
                        @{ id = "a1"; name = "contactPhone"; type = "string"; value = '={{ $json.body.call.metadata.phone }}' },
                        @{ id = "a2"; name = "contactEmail"; type = "string"; value = '={{ $json.body.call.metadata.email }}' },
                        @{ id = "a3"; name = "contactName";  type = "string"; value = '={{ $json.body.call.metadata.firstName }}' },
                        @{ id = "a4"; name = "callOutcome";  type = "string"; value = '={{ $json.body.call_analysis.custom_analysis_data.call_outcome }}' },
                        @{ id = "a5"; name = "callSummary";  type = "string"; value = '={{ $json.body.call_analysis.call_summary }}' },
                        @{ id = "a6"; name = "callSentiment"; type = "string"; value = '={{ $json.body.call_analysis.user_sentiment }}' },
                        @{ id = "a7"; name = "callSuccessful"; type = "string"; value = '={{ $json.body.call_analysis.call_successful }}' },
                        @{ id = "a8"; name = "recordingUrl"; type = "string"; value = '={{ $json.body.recording_url }}' }
                    )
                }
                options = @{}
            }
        },
        @{
            id = "node_search_ghl"
            name = "Search GHL Contact"
            type = "n8n-nodes-base.httpRequest"
            typeVersion = 4
            position = @(440, 0)
            parameters = @{
                method = "GET"
                url = "=https://services.leadconnectorhq.com/contacts/search/duplicate?locationId=$ghlLocationId&phone={{ `$json.contactPhone }}"
                sendHeaders = $true
                headerParameters = @{
                    parameters = @(
                        @{ name = "Authorization"; value = "Bearer $ghlApiKey" },
                        @{ name = "Version"; value = "2021-07-28" }
                    )
                }
                options = @{}
            }
        },
        @{
            id = "node_if"
            name = "Contact Found?"
            type = "n8n-nodes-base.if"
            typeVersion = 2
            position = @(660, 0)
            parameters = @{
                conditions = @{
                    options = @{ caseSensitive = $true; typeValidation = "strict" }
                    combinator = "and"
                    conditions = @(
                        @{
                            id = "cond1"
                            leftValue = '={{ $json.contact.id }}'
                            operator = @{ type = "string"; operation = "notEmpty" }
                            rightValue = ""
                        }
                    )
                }
                options = @{}
            }
        },
        @{
            id = "node_add_note"
            name = "Add Call Note"
            type = "n8n-nodes-base.httpRequest"
            typeVersion = 4
            position = @(880, -80)
            parameters = @{
                method = "POST"
                url = "={{ 'https://services.leadconnectorhq.com/contacts/' + `$('Search GHL Contact').item.json.contact.id + '/notes' }}"
                sendHeaders = $true
                headerParameters = @{
                    parameters = @(
                        @{ name = "Authorization"; value = "Bearer $ghlApiKey" },
                        @{ name = "Version"; value = "2021-07-28" },
                        @{ name = "Content-Type"; value = "application/json" }
                    )
                }
                sendBody = $true
                contentType = "raw"
                rawContentType = "application/json"
                body = '={{ JSON.stringify({ body: "📞 Retell AI Call Summary\n\nOutcome: " + $("Extract Fields").item.json.callOutcome + "\nSentiment: " + $("Extract Fields").item.json.callSentiment + "\nCall Successful: " + $("Extract Fields").item.json.callSuccessful + "\n\nSummary:\n" + $("Extract Fields").item.json.callSummary + "\n\nRecording: " + $("Extract Fields").item.json.recordingUrl }) }}'
                options = @{}
            }
        },
        @{
            id = "node_add_tag"
            name = "Add Tag"
            type = "n8n-nodes-base.httpRequest"
            typeVersion = 4
            position = @(1100, -80)
            parameters = @{
                method = "POST"
                url = "={{ 'https://services.leadconnectorhq.com/contacts/' + `$('Search GHL Contact').item.json.contact.id + '/tags' }}"
                sendHeaders = $true
                headerParameters = @{
                    parameters = @(
                        @{ name = "Authorization"; value = "Bearer $ghlApiKey" },
                        @{ name = "Version"; value = "2021-07-28" },
                        @{ name = "Content-Type"; value = "application/json" }
                    )
                }
                sendBody = $true
                contentType = "raw"
                rawContentType = "application/json"
                body = '={ "tags": ["Retell Call Completed"] }'
                options = @{}
            }
        }
    )
    connections = @{
        "Webhook" = @{
            main = @(@(@{ node = "Extract Fields"; type = "main"; index = 0 }))
        }
        "Extract Fields" = @{
            main = @(@(@{ node = "Search GHL Contact"; type = "main"; index = 0 }))
        }
        "Search GHL Contact" = @{
            main = @(@(@{ node = "Contact Found?"; type = "main"; index = 0 }))
        }
        "Contact Found?" = @{
            main = @(
                @(@{ node = "Add Call Note"; type = "main"; index = 0 }),
                @()
            )
        }
        "Add Call Note" = @{
            main = @(@(@{ node = "Add Tag"; type = "main"; index = 0 }))
        }
    }
    settings = @{
        executionOrder = "v1"
    }
}

$body = $workflow | ConvertTo-Json -Depth 20

Write-Host "Creating workflow..."
try {
    $response = Invoke-RestMethod -Uri "$n8nUrl/workflows" -Method POST -Headers $headers -Body $body
    Write-Host "SUCCESS! Workflow created with ID: $($response.id)"
    Write-Host "Name: $($response.name)"
    Write-Host "Active: $($response.active)"
    
    # Now activate it
    Write-Host "`nActivating workflow..."
    $activateResponse = Invoke-RestMethod -Uri "$n8nUrl/workflows/$($response.id)/activate" -Method POST -Headers $headers
    Write-Host "Workflow activated! Active: $($activateResponse.active)"
    Write-Host "`nWebhook URL: https://app.echovoicelabs.co/webhook/retell-post-call"
} catch {
    Write-Host "ERROR: $($_.Exception.Message)"
    Write-Host "Response: $($_.ErrorDetails.Message)"
}
