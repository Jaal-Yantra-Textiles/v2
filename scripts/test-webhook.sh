#!/bin/bash

# Facebook Webhook Diagnostic Script
# Usage: ./scripts/test-webhook.sh

echo "🔍 Facebook Webhook Diagnostic Tool"
echo "===================================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
WEBHOOK_URL="${WEBHOOK_URL:-https://your-domain.com/webhooks/social/facebook}"
VERIFY_TOKEN="${FACEBOOK_WEBHOOK_VERIFY_TOKEN}"
APP_SECRET="${FACEBOOK_CLIENT_SECRET}"

# Test 1: Check environment variables
echo "📋 Test 1: Environment Variables"
echo "--------------------------------"
if [ -z "$VERIFY_TOKEN" ]; then
    echo -e "${RED}❌ FACEBOOK_WEBHOOK_VERIFY_TOKEN not set${NC}"
else
    echo -e "${GREEN}✅ FACEBOOK_WEBHOOK_VERIFY_TOKEN is set${NC}"
fi

if [ -z "$APP_SECRET" ]; then
    echo -e "${RED}❌ FACEBOOK_CLIENT_SECRET not set${NC}"
else
    echo -e "${GREEN}✅ FACEBOOK_CLIENT_SECRET is set${NC}"
fi
echo ""

# Test 2: Webhook verification (GET request)
echo "🔐 Test 2: Webhook Verification"
echo "--------------------------------"
if [ -n "$VERIFY_TOKEN" ]; then
    CHALLENGE="test_challenge_$(date +%s)"
    RESPONSE=$(curl -s "${WEBHOOK_URL}?hub.mode=subscribe&hub.challenge=${CHALLENGE}&hub.verify_token=${VERIFY_TOKEN}")
    
    if [ "$RESPONSE" = "$CHALLENGE" ]; then
        echo -e "${GREEN}✅ Webhook verification successful${NC}"
        echo "   Response: $RESPONSE"
    else
        echo -e "${RED}❌ Webhook verification failed${NC}"
        echo "   Expected: $CHALLENGE"
        echo "   Got: $RESPONSE"
    fi
else
    echo -e "${YELLOW}⚠️  Skipping (VERIFY_TOKEN not set)${NC}"
fi
echo ""

# Test 3: Webhook endpoint accessibility
echo "🌐 Test 3: Endpoint Accessibility"
echo "--------------------------------"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d '{}')

if [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✅ Endpoint is accessible (HTTP $HTTP_CODE)${NC}"
else
    echo -e "${RED}❌ Endpoint returned HTTP $HTTP_CODE${NC}"
fi
echo ""

# Test 4: Send test webhook event
echo "📨 Test 4: Send Test Webhook"
echo "--------------------------------"
if [ -n "$APP_SECRET" ]; then
    # Create test payload
    PAYLOAD='{"object":"page","entry":[{"id":"747917475065823","time":1234567890,"changes":[{"field":"reactions","value":{"post_id":"747917475065823_122116529792958834","reaction_type":"like"}}]}]}'
    
    # Calculate signature
    SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$APP_SECRET" | awk '{print $2}')
    
    # Send webhook
    RESPONSE=$(curl -s -X POST "$WEBHOOK_URL" \
        -H "Content-Type: application/json" \
        -H "X-Hub-Signature-256: sha256=$SIGNATURE" \
        -d "$PAYLOAD")
    
    if [ "$RESPONSE" = "EVENT_RECEIVED" ]; then
        echo -e "${GREEN}✅ Test webhook sent successfully${NC}"
        echo "   Response: $RESPONSE"
    else
        echo -e "${RED}❌ Test webhook failed${NC}"
        echo "   Response: $RESPONSE"
    fi
else
    echo -e "${YELLOW}⚠️  Skipping (APP_SECRET not set)${NC}"
fi
echo ""

# Test 5: Check database for post
echo "💾 Test 5: Database Check"
echo "--------------------------------"
if [ -n "$DATABASE_URL" ]; then
    POST_ID="747917475065823_122116529792958834"
    
    # Check if post exists
    RESULT=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM social_posts WHERE insights->>'facebook_post_id' = '$POST_ID';" 2>/dev/null)
    
    if [ $? -eq 0 ]; then
        COUNT=$(echo "$RESULT" | tr -d ' ')
        if [ "$COUNT" -gt 0 ]; then
            echo -e "${GREEN}✅ Post found in database${NC}"
            echo "   Post ID: $POST_ID"
            
            # Get insights
            INSIGHTS=$(psql "$DATABASE_URL" -t -c "SELECT insights FROM social_posts WHERE insights->>'facebook_post_id' = '$POST_ID' LIMIT 1;" 2>/dev/null)
            echo "   Insights: $INSIGHTS"
        else
            echo -e "${RED}❌ Post not found in database${NC}"
            echo "   Post ID: $POST_ID"
            echo ""
            echo "   This is the most common issue!"
            echo "   The post must exist in your database with the correct facebook_post_id"
        fi
    else
        echo -e "${RED}❌ Database connection failed${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Skipping (DATABASE_URL not set)${NC}"
fi
echo ""

# Summary
echo "📊 Summary"
echo "=========="
echo "Webhook URL: $WEBHOOK_URL"
echo "Post ID: 747917475065823_122116529792958834"
echo ""
echo "Next steps:"
echo "1. Fix any failed tests above"
echo "2. Check Facebook Developer Console → Webhooks"
echo "3. Verify webhook is subscribed to your page"
echo "4. Like the post and wait 30 seconds"
echo "5. Check server logs: railway logs --tail"
echo "6. Refresh admin UI to see insights"
echo ""
echo "For detailed diagnostics, see: docs/WEBHOOK_DIAGNOSTIC_GUIDE.md"
