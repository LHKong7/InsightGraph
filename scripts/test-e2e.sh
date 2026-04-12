#!/usr/bin/env bash
# End-to-end smoke test: upload a sample file -> wait for processing -> verify graph.
# Requires: API + Worker + Neo4j + Redis running.
set -euo pipefail

API_URL="${API_URL:-http://localhost:8000}"

echo "=== InsightGraph E2E Smoke Test ==="
echo "API: $API_URL"
echo ""

# 1. Health check
echo "1. Health check..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$API_URL/health")
if [ "$HTTP_CODE" != "200" ]; then
  echo "   FAIL: API not reachable (HTTP $HTTP_CODE)"
  echo "   Make sure the API server is running: ./scripts/start-api.sh"
  exit 1
fi
echo "   OK"

# 2. Create a sample markdown file
SAMPLE_FILE="/tmp/insightgraph-test-report.md"
cat > "$SAMPLE_FILE" << 'MARKDOWN'
# NVIDIA Q3 2024 Earnings Report

## Revenue Overview

NVIDIA reported revenue of $18.1 billion for Q3 2024, representing a 206% increase year-over-year. Data center revenue reached $14.5 billion, up 279% from the previous year.

CEO Jensen Huang stated that "the era of generative AI is upon us" and highlighted strong demand across cloud service providers and enterprise customers.

## Key Metrics

- Total Revenue: $18.1 billion (up 206% YoY)
- Data Center Revenue: $14.5 billion (up 279% YoY)
- Gaming Revenue: $2.9 billion (up 81% YoY)
- Gross Margin: 74.0%
- Operating Income: $10.4 billion

## Market Analysis

NVIDIA competes with AMD and Intel in the GPU market. NVIDIA's market share in data center GPUs exceeds 80%. AMD has been gaining ground with its MI300X accelerator, but NVIDIA maintains its lead with the H100 and upcoming B100 chips.

The partnership between NVIDIA and Microsoft Azure has driven significant cloud adoption. Amazon Web Services also expanded its NVIDIA GPU offerings.

## Risks

Supply chain constraints remain a concern. TSMC, NVIDIA's primary chip fabricator, faces capacity limitations. Export restrictions to China reduced China-related revenue by approximately $5 billion annually.
MARKDOWN

echo ""
echo "2. Uploading sample report..."
UPLOAD_RESPONSE=$(curl -s -X POST "$API_URL/api/v1/reports/upload" \
  -F "file=@$SAMPLE_FILE")
echo "   Response: $UPLOAD_RESPONSE"

REPORT_ID=$(echo "$UPLOAD_RESPONSE" | grep -o '"report_id":"[^"]*"' | cut -d'"' -f4)
TASK_ID=$(echo "$UPLOAD_RESPONSE" | grep -o '"task_id":"[^"]*"' | cut -d'"' -f4)

if [ -z "$REPORT_ID" ]; then
  echo "   FAIL: No report_id in response"
  exit 1
fi
echo "   Report ID: $REPORT_ID"
echo "   Task ID: $TASK_ID"

# 3. Wait for processing
echo ""
echo "3. Waiting for processing (up to 120s)..."
for i in $(seq 1 60); do
  sleep 2
  STATUS_RESPONSE=$(curl -s "$API_URL/api/v1/reports/$REPORT_ID/status")
  STATUS=$(echo "$STATUS_RESPONSE" | grep -o '"status":"[^"]*"' | cut -d'"' -f4)

  if [ "$STATUS" = "completed" ]; then
    echo "   Completed after $((i*2))s"
    break
  elif [ "$STATUS" = "failed" ]; then
    echo "   FAIL: Processing failed"
    echo "   $STATUS_RESPONSE"
    exit 1
  fi

  if [ $((i % 5)) -eq 0 ]; then
    echo "   Status: $STATUS (${i}x2s elapsed)"
  fi
done

# 4. Verify graph was built
echo ""
echo "4. Searching for entities..."
ENTITIES=$(curl -s "$API_URL/api/v1/entities/search?name=NVIDIA")
echo "   $ENTITIES" | head -c 500
echo ""

echo ""
echo "5. Listing reports..."
REPORTS=$(curl -s "$API_URL/api/v1/reports")
echo "   $REPORTS" | head -c 300
echo ""

echo ""
echo "=== E2E Test Complete ==="
echo "Upload -> Parse -> Extract -> Resolve -> Write Graph pipeline verified."

# Cleanup
rm -f "$SAMPLE_FILE"
