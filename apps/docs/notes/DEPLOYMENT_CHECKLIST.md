# Unified Workflow Deployment Checklist

## ✅ Pre-Deployment Checklist

### Code Quality
- [x] All workflow steps implemented and tested
- [x] Route handler refactored (351 → 67 lines)
- [x] Integration tests passing (3/3)
- [x] No TypeScript errors
- [x] Code reviewed and approved

### Testing
- [x] Unit tests for workflow steps
- [x] Integration tests for workflow execution
- [x] Validation tests (page_id, media_attachments format)
- [x] Error handling tests
- [ ] Manual testing with real OAuth tokens (staging)
- [ ] E2E tests on staging environment

### Documentation
- [x] API documentation updated
- [x] Workflow architecture documented
- [x] Usage examples provided
- [x] Troubleshooting guide created
- [x] Deployment checklist created

### Security
- [ ] Encryption keys configured (if using encryption)
- [ ] No plaintext tokens in logs
- [ ] OAuth tokens stored securely
- [ ] API rate limits configured
- [ ] Error messages don't leak sensitive data

---

## 🚀 Staging Deployment

### 1. Pre-Deployment
```bash
# Backup database
pg_dump production_db > backup_$(date +%Y%m%d).sql

# Create staging branch
git checkout -b deploy/staging-unified-workflow
git push origin deploy/staging-unified-workflow
```

### 2. Deploy to Staging
```bash
# Deploy
git push staging deploy/staging-unified-workflow:main

# Wait for deployment
# Monitor logs
tail -f /var/log/medusa/staging.log
```

### 3. Verify Staging
- [ ] Server started successfully
- [ ] No errors in logs
- [ ] Health check passing
- [ ] Database migrations applied

### 4. Test on Staging
```bash
# Test Facebook publishing
curl -X POST https://staging.example.com/admin/social-posts/test_fb/publish \
  -H "Authorization: Bearer $STAGING_TOKEN" \
  -H "Content-Type: application/json"

# Test Instagram publishing
curl -X POST https://staging.example.com/admin/social-posts/test_ig/publish \
  -H "Authorization: Bearer $STAGING_TOKEN"

# Test Twitter publishing
curl -X POST https://staging.example.com/admin/social-posts/test_tw/publish \
  -H "Authorization: Bearer $STAGING_TOKEN"

# Test FBINSTA publishing
curl -X POST https://staging.example.com/admin/social-posts/test_both/publish \
  -H "Authorization: Bearer $STAGING_TOKEN"
```

### 5. Staging Test Results
- [ ] Facebook publishing works
- [ ] Instagram publishing works
- [ ] Twitter publishing works
- [ ] FBINSTA publishing works
- [ ] Smart retry works
- [ ] Error handling works
- [ ] Validation works
- [ ] No performance degradation

---

## 🎯 Production Deployment

### 1. Pre-Production Checks
- [ ] All staging tests passed
- [ ] No critical bugs found
- [ ] Performance metrics acceptable
- [ ] Rollback plan prepared
- [ ] Team notified of deployment
- [ ] Maintenance window scheduled (if needed)

### 2. Production Deployment
```bash
# Merge to main
git checkout main
git merge deploy/staging-unified-workflow
git push origin main

# Tag release
git tag -a v1.0.0-unified-workflow -m "Unified workflow deployment"
git push origin v1.0.0-unified-workflow

# Deploy to production
git push production main
```

### 3. Post-Deployment Monitoring (First Hour)
- [ ] Server started successfully
- [ ] No errors in logs
- [ ] Health check passing
- [ ] Response times normal
- [ ] Error rate normal
- [ ] CPU/Memory usage normal

### 4. Post-Deployment Monitoring (First 24 Hours)
- [ ] Success rate >= 95%
- [ ] Average response time < 2s
- [ ] Error rate < 5%
- [ ] No customer complaints
- [ ] All platforms working

---

## 📊 Monitoring Metrics

### Key Metrics to Track

**Success Metrics**:
- Total publish attempts
- Successful publishes
- Failed publishes
- Success rate (%)

**Performance Metrics**:
- Average response time
- P95 response time
- P99 response time

**Platform-Specific Metrics**:
- Facebook success rate
- Instagram success rate
- Twitter success rate
- FBINSTA success rate

**Error Metrics**:
- Invalid token errors
- Validation errors
- API errors
- Network errors

### Monitoring Setup

```typescript
// Example monitoring dashboard queries

// Success rate
SELECT 
  COUNT(*) as total,
  SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) as successful,
  (SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END) * 100.0 / COUNT(*)) as success_rate
FROM social_posts
WHERE posted_at > NOW() - INTERVAL '24 hours'

// Average response time
SELECT AVG(response_time_ms) as avg_response_time
FROM publish_logs
WHERE created_at > NOW() - INTERVAL '1 hour'

// Error breakdown
SELECT 
  error_type,
  COUNT(*) as count
FROM publish_errors
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY error_type
ORDER BY count DESC
```

---

## 🔄 Rollback Plan

### When to Rollback
- Critical bugs affecting > 10% of publishes
- Performance degradation > 50%
- Data corruption
- Security vulnerability

### Rollback Steps

```bash
# 1. Revert to previous version
git revert HEAD
git push production main

# 2. Verify rollback
curl https://api.example.com/health

# 3. Monitor metrics
# - Check error rate drops
# - Check success rate improves
# - Check response times normalize

# 4. Investigate issue
# - Review logs
# - Identify root cause
# - Create fix

# 5. Re-deploy with fix
# - Test fix on staging
# - Deploy to production
```

---

## 🐛 Known Issues & Workarounds

### Issue 1: Token Encryption Not Implemented
**Status**: Not implemented in platform creation  
**Impact**: Tokens stored as plaintext  
**Workaround**: Implement encryption in `createSocialPlatformWorkflow`  
**Priority**: High  
**Timeline**: Next sprint

### Issue 2: Validation Happens After API Call
**Status**: page_id validation happens too late  
**Impact**: Error message mentions OAuth instead of missing page_id  
**Workaround**: Move validation earlier in workflow  
**Priority**: Medium  
**Timeline**: Future enhancement

### Issue 3: Integration Tests Use Fake Tokens
**Status**: Tests expect Facebook API errors  
**Impact**: Can't test actual publishing in CI/CD  
**Workaround**: Use manual testing with real tokens  
**Priority**: Low  
**Timeline**: Future enhancement

---

## 📝 Post-Deployment Tasks

### Immediate (Day 1)
- [ ] Monitor error logs
- [ ] Check success rates
- [ ] Verify all platforms working
- [ ] Respond to any issues

### Short-term (Week 1)
- [ ] Analyze performance metrics
- [ ] Gather user feedback
- [ ] Document any issues
- [ ] Plan improvements

### Long-term (Month 1)
- [ ] Review success/failure patterns
- [ ] Optimize slow steps
- [ ] Implement token encryption
- [ ] Add more comprehensive tests

---

## 🎓 Team Training

### Required Knowledge
- [ ] Understanding of workflow architecture
- [ ] How to read workflow logs
- [ ] Common error messages and solutions
- [ ] How to retry failed publishes
- [ ] How to debug issues

### Training Materials
- [x] Workflow documentation
- [x] API documentation
- [x] Troubleshooting guide
- [ ] Video walkthrough (optional)
- [ ] FAQ document (optional)

---

## 📞 Support Plan

### On-Call Rotation
- Primary: [Name]
- Secondary: [Name]
- Escalation: [Name]

### Communication Channels
- Slack: #social-publishing
- Email: team@example.com
- Phone: [On-call number]

### Escalation Path
1. Check logs and metrics
2. Try common solutions
3. Contact primary on-call
4. Escalate to secondary if needed
5. Escalate to team lead if critical

---

## ✅ Sign-Off

### Deployment Approval

**Developer**: _________________ Date: _______  
**QA**: _________________ Date: _______  
**Product Manager**: _________________ Date: _______  
**DevOps**: _________________ Date: _______  

### Post-Deployment Verification

**Staging Tests Passed**: ☐ Yes ☐ No  
**Production Deployed**: ☐ Yes ☐ No  
**Monitoring Active**: ☐ Yes ☐ No  
**Team Notified**: ☐ Yes ☐ No  

---

**Deployment Date**: _________________  
**Deployed By**: _________________  
**Version**: v1.0.0-unified-workflow  
**Status**: ☐ Success ☐ Rolled Back ☐ In Progress
